import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '../../shared/types';
import type { AgentCommandResult, AgentRunState, AgentRunSummary } from '../../shared/types';
import { config } from '../config';
import { resolveMcpCommandName } from '../../shared/mcpCommand';
import { BUILTIN_AGENT_COMMAND } from '../../shared/types';
import { findBuiltinConnector } from '../../shared/builtinConnectors';
import { loadLanguageData, t } from '../i18n';
import { cancelAllAgentConfirms } from '../chat/agentConfirmBridge';
import { executeAgentRun } from '../chat/agentCommand';
import { mergeConversationThread } from '../chat/conversationStore';
import { sendLog } from '../helpers';
import {
  abortRun,
  applyAnswer,
  deleteRunState,
  dropUnansweredAsk,
  listResumableRuns,
  loadRunState,
  pruneOldRuns,
  readRunConnectors,
} from '../flow/agent/agentRunStore';
import type { IpcContext } from './context';

interface DisclosedServers {
  ids: string[];
  /** Badge label for the turn: the connector's own command when it is the only one. */
  command: string;
}

/**
 * Resolve the connector ids the renderer asked to disclose against what the user actually
 * configured. Unknown or `agentEnabled: false` ids are DROPPED rather than fatal: the set is
 * sticky for a whole conversation, so a connector deleted or switched off in Settings halfway
 * through would otherwise make every later send in that conversation fail with an error naming
 * something the user can no longer see. Dropping every id of a non-empty request is still an
 * error — that one the user can act on.
 */
// Exported for the test suite.
export function resolveDisclosedServers(serverIds: readonly string[] | undefined): DisclosedServers {
  const wanted = [...new Set((serverIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const resolved = wanted
    .flatMap((id) => {
      // A built-in connector is not in config.mcpServers; its config flag is the user's
      // authoritative opt-in, so resolve it from there rather than dropping it.
      const builtin = findBuiltinConnector(id);
      if (builtin) {
        return config[builtin.flag] ? [builtin.descriptor()] : [];
      }
      const server = config.mcpServers.find((entry) => entry.id === id);
      return server && server.agentEnabled !== false ? [server] : [];
    });
  const command = resolved.length === 1
    ? resolveMcpCommandName(resolved[0])
    : BUILTIN_AGENT_COMMAND;
  return { ids: resolved.map((server) => server.id), command };
}

export function registerAgentHandlers(ctx: IpcContext): void {
  void pruneOldRuns(Date.now());

  const deps = { flowManager: ctx.flowManager, getMainWin: ctx.getMainWin };

  ipcMain.handle(
    IPC.AGENT_RUN,
    async (
      _event,
      rawGoal: string,
      targetUrl?: string,
      rawRunId?: string,
      conversationPath?: string,
      attachments?: string[],
      mcpServerIds?: string[],
      web?: boolean,
    ): Promise<AgentCommandResult> => {
      const goal = (rawGoal ?? '').trim();
      const strings = (await loadLanguageData(config.locale)) ?? {};
      if (!goal) return { success: false, error: t(strings, 'agent.error.empty') };
      if (!ctx.flowManager) return { success: false, error: t(strings, 'agent.error.unavailable') };

      // Resolve against config, never against what the renderer sent: the command name is only a
      // label, and every server id has to be one the user actually configured and left enabled.
      const scoped = resolveDisclosedServers(mcpServerIds);
      if ((mcpServerIds?.length ?? 0) > 0 && scoped.ids.length === 0) {
        return { success: false, error: t(strings, 'mcp.command.unknownServer') };
      }

      const now = new Date().toISOString();
      const state: AgentRunState = {
        runId: (rawRunId ?? '').trim() || randomUUID(),
        goal,
        providerUrl: (targetUrl ?? '').trim() || config.targetUrl,
        ...(conversationPath ? { conversationPath } : {}),
        ...(attachments?.length ? { attachments: attachments.filter(Boolean) } : {}),
        ...(scoped.ids.length > 0 ? { mcpServerIds: scoped.ids, mcpCommandName: scoped.command } : {}),
        // Only the off state is persisted. `undefined` means on, so a run written before the
        // toggle existed — and every default run since — reads as "web allowed" with no migration.
        ...(web === false ? { web: false } : {}),
        status: 'running',
        turns: [],
        createdAt: now,
        updatedAt: now,
      };
      return executeAgentRun(deps, { state, strings });
    },
  );

  ipcMain.handle(IPC.AGENT_RESUME, async (_event, runId: string, rawAnswer?: string): Promise<AgentCommandResult> => {
    const strings = (await loadLanguageData(config.locale)) ?? {};
    const id = (runId ?? '').trim();
    const state = id ? await loadRunState(id) : null;
    if (!state) return { success: false, error: t(strings, 'agent.error.notResumable') };
    if (state.status === 'done') return { success: false, error: t(strings, 'agent.error.notResumable') };
    // Re-validate the persisted disclosure: a week-old run can name a connector the user has
    // since deleted or switched off, and resuming it as if nothing were named would hand the
    // model a scope the user did not agree to.
    const persisted = readRunConnectors(state);
    if (persisted.length > 0) {
      const still = resolveDisclosedServers(persisted);
      if (still.ids.length === 0) return { success: false, error: t(strings, 'mcp.command.unknownServer') };
      state.mcpServerIds = still.ids;
      state.mcpCommandName = still.command;
    }
    const answer = (rawAnswer ?? '').trim();
    const resumeFrom = answer ? applyAnswer(state.turns, answer) : dropUnansweredAsk(state.turns);
    state.turns = resumeFrom;
    state.status = 'running';
    state.error = undefined;
    state.updatedAt = new Date().toISOString();
    return executeAgentRun(deps, {
      state,
      resumeFrom,
      strings,
      deliveredPrompt: answer || state.goal,
    });
  });

  ipcMain.handle(IPC.AGENT_CANCEL, async (_event, runId: string): Promise<boolean> => {
    const aborted = abortRun((runId ?? '').trim());
    // Cancelling a run that is parked on a confirmation dialog has to release the dialog too,
    // or Stop does nothing visible: the engine only re-reads `signal` between turns, and the
    // turn it is on is blocked on the user. Global rather than per-run because only one
    // external task can be in flight at a time, and denying is the safe direction regardless.
    if (aborted) cancelAllAgentConfirms('the run was cancelled');
    return aborted;
  });

  ipcMain.handle(IPC.AGENT_LIST_RESUMABLE, async (): Promise<AgentRunSummary[]> => {
    try {
      return await listResumableRuns();
    } catch {
      return [];
    }
  });

  /**
   * The saved trace behind one chat turn. Read-only and best-effort: a run older than the prune
   * window is simply gone, and the caller renders that as "no longer available" rather than an
   * error — the turn's answer is still perfectly readable without it.
   */
  ipcMain.handle(IPC.AGENT_GET_RUN, async (_event, runId: string): Promise<AgentRunState | null> => {
    try {
      return await loadRunState((runId ?? '').trim());
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.AGENT_DISCARD, async (_event, runId: string): Promise<boolean> => {
    try {
      await deleteRunState((runId ?? '').trim());
      return true;
    } catch {
      return false;
    }
  });

  /**
   * Remember which connectors a conversation has disclosed, so reopening it keeps disclosing
   * them. Merged into the thread marker rather than written over it: a command run landing at
   * the same moment owns `threadUrl` and `threadTurns`, and stamping a stale copy of those back
   * would silently drop native continuation to replay.
   */
  ipcMain.handle(
    IPC.AGENT_SET_CONNECTORS,
    async (_event, filePath: string, serverIds: string[], web?: boolean): Promise<boolean> => {
      const target = (filePath ?? '').trim();
      if (!target) return false;
      try {
        const { ids } = resolveDisclosedServers(serverIds);
        await mergeConversationThread(target, {
          ...(ids.length > 0 ? { mcp: ids } : { mcp: undefined }),
          // Written only when on, so the marker of a default conversation stays as it was.
          web: web === true ? true : undefined,
        });
        return true;
      } catch (err: unknown) {
        // Not fatal: the set still applies to this session, it just will not survive reopening.
        sendLog(`⚠️ Could not remember this conversation's connectors (${err instanceof Error ? err.message : String(err)})`);
        return false;
      }
    },
  );
}

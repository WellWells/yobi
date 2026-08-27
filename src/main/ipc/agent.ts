import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '../../shared/types';
import type { AgentCommandResult, AgentRunState, AgentRunSummary } from '../../shared/types';
import { config } from '../config';
import { loadLanguageData, t } from '../i18n';
import { executeAgentRun } from '../chat/agentCommand';
import {
  abortRun,
  applyAnswer,
  deleteRunState,
  dropUnansweredAsk,
  listResumableRuns,
  loadRunState,
  pruneOldRuns,
} from '../flow/agent/agentRunStore';
import type { IpcContext } from './context';

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
    ): Promise<AgentCommandResult> => {
      const goal = (rawGoal ?? '').trim();
      const strings = (await loadLanguageData(config.locale)) ?? {};
      if (!goal) return { success: false, error: t(strings, 'agent.error.empty') };
      if (!ctx.flowManager) return { success: false, error: t(strings, 'agent.error.unavailable') };

      const now = new Date().toISOString();
      const state: AgentRunState = {
        runId: (rawRunId ?? '').trim() || randomUUID(),
        goal,
        providerUrl: (targetUrl ?? '').trim() || config.targetUrl,
        ...(conversationPath ? { conversationPath } : {}),
        ...(attachments?.length ? { attachments: attachments.filter(Boolean) } : {}),
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
    return abortRun((runId ?? '').trim());
  });

  ipcMain.handle(IPC.AGENT_LIST_RESUMABLE, async (): Promise<AgentRunSummary[]> => {
    try {
      return await listResumableRuns();
    } catch {
      return [];
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
}

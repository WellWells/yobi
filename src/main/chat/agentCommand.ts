import type { BrowserWindow } from 'electron';
import { BUILTIN_AGENT_COMMAND, IPC } from '../../shared/types';
import type {
  AgentCommandResult,
  AgentRunState,
  AgentTraceEvent,
  AgentTracePayload,
  AgentTurnRecord,
} from '../../shared/types';
import { pickConversationTitle } from '../../shared/conversationTitle';
import { listOutputFiles } from '../files';
import { buildOutputMarkdown } from '../output';
import { saveCommandOutput } from './commandOutput';
import { runUrlShortcut } from './urlShortcut';
import { deliverTempChatResult, isTempChatMode } from '../tempChat';
import { sendLog, sendToRenderer } from '../helpers';
import { localizeUserFacingError, t } from '../i18n';
import { getProviderLabel } from '../providers';
import { runAgent } from '../flow/agent/agentEngine';
import { buildAgentConfirm } from './agentConfirm';
import { measureTokens } from '../tokenMeter';
import { tokenMetaFields } from '../../shared/tokenEstimate';
import type { TokenUsage } from '../../shared/tokenEstimate';
import type { AgentProgress } from '../flow/agent/agentEngine';
import { deleteRunState, registerRun, saveRunState, unregisterRun } from '../flow/agent/agentRunStore';
import type { CommandOrigin } from './commandOrigin';
import type { FlowManager } from '../flow';

type Strings = Record<string, string>;

export interface AgentRunDeps {
  flowManager?: FlowManager;
  getMainWin: () => BrowserWindow | null;
}

export interface AgentRunRequest {
  state: AgentRunState;
  resumeFrom?: AgentTurnRecord[];
  strings: Strings;
  /**
   * The prompt this run's output is filed under. It is the goal, except when the run was
   * resumed with an answer to its own question — then the conversation turn belongs to the
   * answer the user just typed, not to a goal they asked about several turns ago.
   */
  deliveredPrompt?: string;
  origin?: CommandOrigin;
  /**
   * Progress for a caller with no queue UI to read — a bot. Without it a run that is working
   * normally is indistinguishable from one that has hung, because the only message the user
   * has is the "queued" acknowledgement.
   */
  onProgressText?: (text: string) => void;
}

/** Adds the delivered text, which a bot needs in order to send the reply on. */
export interface AgentRunOutcome extends AgentCommandResult {
  answer?: string;
  title?: string;
}

function summarizeGoal(goal: string): string {
  const compact = goal.replace(/\s+/g, ' ').trim();
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact;
}

function progressText(progress: AgentProgress, strings: Strings): string {
  if (progress.stage === 'tool') {
    return t(strings, 'agent.progress.tool', {
      tool: progress.tool,
      index: String(progress.index),
      total: String(progress.total),
    });
  }
  return t(strings, 'agent.progress.thinking');
}

async function deliverResult(
  prompt: string,
  title: string,
  answer: string,
  resolvedTarget: string,
  strings: Strings,
  origin: CommandOrigin,
  conversationPath?: string,
  usage?: TokenUsage,
): Promise<AgentRunOutcome> {
  const conversationTitle = pickConversationTitle({ resolved: title, prompt });
  const markdownOptions = {
    prompt,
    turnMeta: { c: BUILTIN_AGENT_COMMAND },
    response: answer,
    title: conversationTitle,
    provider: getProviderLabel(resolvedTarget),
    providerLabel: strings['md.provider'] ?? 'Provider',
    promptLabel: strings['md.prompt'] ?? 'Prompt',
    responseLabel: strings['md.response'] ?? 'Response',
    timestampLabel: strings['md.timestamp'] ?? 'Time',
  };

  // A bot run must never land in the desktop's temporary chat: the two would overwrite each
  // other, and the requester would get nothing back on their phone.
  if (origin === 'app' && isTempChatMode()) {
    deliverTempChatResult({
      content: buildOutputMarkdown(markdownOptions),
      turn: {
        prompt,
        response: answer,
        meta: {
          p: markdownOptions.provider,
          t: new Date().toISOString(),
          m: 'replay',
          c: BUILTIN_AGENT_COMMAND,
          ...(usage ? tokenMetaFields(usage) : {}),
        },
      },
    });
    return { success: true, answer, title: conversationTitle };
  }

  const filePath = await saveCommandOutput({
    conversationPath,
    markdownOptions,
    prompt: markdownOptions.prompt,
    response: markdownOptions.response,
    providerLabel: markdownOptions.provider,
    command: BUILTIN_AGENT_COMMAND,
    usage,
  });
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
  return { success: true, filePath, answer, title: conversationTitle };
}

export function executeAgentRun(deps: AgentRunDeps, request: AgentRunRequest): Promise<AgentRunOutcome> {
  const { state, resumeFrom, strings } = request;
  const origin = request.origin ?? 'app';
  const deliveredPrompt = request.deliveredPrompt ?? state.goal;
  const flowManager = deps.flowManager;
  if (!flowManager) return Promise.resolve({ success: false, error: t(strings, 'agent.error.unavailable') });

  const { runId, goal, providerUrl } = state;
  const emit = (event: AgentTraceEvent): void =>
    sendToRenderer(IPC.AGENT_TRACE, { runId, event } satisfies AgentTracePayload);

  const controller = registerRun(runId);

  const run = async (taskId?: string): Promise<AgentRunOutcome> => {
    try {
      const report = (progress: AgentProgress): void => {
        const text = progressText(progress, strings);
        if (taskId) flowManager.setQueueTaskProgress(taskId, text);
        request.onProgressText?.(text);
      };
      const onProgress = taskId || request.onProgressText ? report : undefined;
      const onTurn = (turn: AgentTurnRecord): void => {
        state.turns.push(turn);
        state.updatedAt = new Date().toISOString();
        void saveRunState(state);
      };

      if (!resumeFrom?.length) {
        report({ stage: 'thinking' });
        const { result: shortcut, usage: shortcutUsage } = await measureTokens(
          () => runUrlShortcut(goal, providerUrl, flowManager.getExecutorDeps(), strings, controller.signal),
        );
        if (shortcut) {
          const shortcutAnswer = shortcut.answer.trim();
          if (!shortcutAnswer) {
            const error = t(strings, 'agent.error.incomplete');
            emit({ kind: 'failed', error });
            return { success: false, error };
          }
          const shortcutTitle = shortcut.title?.trim() ?? '';
          emit({ kind: 'done', title: shortcutTitle });
          return await deliverResult(
            deliveredPrompt, shortcutTitle, shortcutAnswer, shortcut.providerUrl, strings, origin,
            state.conversationPath, shortcutUsage,
          );
        }
      }

      await saveRunState(state);

      const { result: outcome, usage } = await measureTokens(() => runAgent(
        goal,
        providerUrl,
        flowManager.getExecutorDeps(),
        {
          onProgress,
          onTrace: emit,
          onTurn,
          resumeFrom,
          ...(state.conversationPath ? { conversationPath: state.conversationPath } : {}),
          signal: controller.signal,
          onConfirm: buildAgentConfirm(deps.getMainWin, strings, origin),
          onSaveFlow: (flow) => flowManager.saveGeneratedFlow(flow),
        },
      ));

      if (outcome.kind === 'question') {
        // The question is delivered exactly like an answer — it becomes this turn's reply in
        // the conversation — so the user answers by typing, with no second UI to discover.
        const delivered = await deliverResult(
          deliveredPrompt, '', outcome.question, providerUrl, strings, origin, state.conversationPath, usage,
        );
        state.status = 'awaiting';
        state.updatedAt = new Date().toISOString();
        // A run started from a blank chat had no conversation until this delivery created
        // one. Without adopting it, the reply would open a second conversation and the
        // gathered scratchpad would be stranded in the first.
        if (delivered.filePath) state.conversationPath = delivered.filePath;
        await saveRunState(state);
        emit({ kind: 'question', question: outcome.question });
        return { ...delivered, question: outcome.question, runId };
      }

      const answer = outcome.answer.trim();
      if (!answer) {
        state.status = 'failed';
        state.error = t(strings, 'agent.error.incomplete');
        state.updatedAt = new Date().toISOString();
        await saveRunState(state);
        emit({ kind: 'failed', error: state.error });
        return { success: false, error: state.error };
      }

      state.status = 'done';
      emit({ kind: 'done', title: outcome.title });
      await deleteRunState(runId);
      return await deliverResult(
        deliveredPrompt, outcome.title, answer, providerUrl, strings, origin, state.conversationPath, usage,
      );
    } catch (err: unknown) {
      const aborted = controller.signal.aborted;
      const message = aborted
        ? t(strings, 'agent.error.cancelled')
        : localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);
      state.status = aborted ? 'cancelled' : 'failed';
      state.error = message;
      state.updatedAt = new Date().toISOString();
      await saveRunState(state);
      emit(aborted ? { kind: 'cancelled' } : { kind: 'failed', error: message });
      sendLog(`❌ [Agent] ${message}`);
      return { success: false, error: message };
    } finally {
      unregisterRun(runId);
    }
  };

  return flowManager.enqueueExternalTask(
    `/${BUILTIN_AGENT_COMMAND} ${summarizeGoal(goal)}`,
    run,
    (err) => {
      unregisterRun(runId);
      return {
        success: false,
        error: localizeUserFacingError(err instanceof Error ? err.message : String(err), strings),
      };
    },
    runId,
  );
}

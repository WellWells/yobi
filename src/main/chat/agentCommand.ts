import type { BrowserWindow } from 'electron';
import { BUILTIN_AGENT_COMMAND, IPC } from '../../shared/types';
import type {
  AgentCommandResult,
  AgentRunState,
  AgentTraceEvent,
  AgentTracePayload,
  AgentTurnRecord,
  FlowBuildPayload,
} from '../../shared/types';
import { pickConversationTitle } from '../../shared/conversationTitle';
import { attachmentMetaNames } from '../../shared/conversationDoc';
import { compactPreview } from '../../shared/textBudget';
import { listOutputFiles } from '../files';
import { deliverCommandResultToTempChat, saveCommandOutput } from './commandOutput';
import { runUrlShortcut } from './urlShortcut';
import { isTempChatMode } from '../tempChat';
import { sendLog, sendToRenderer } from '../helpers';
import { localizeUserFacingError, t } from '../i18n';
import { getProviderLabel } from '../providers';
import { runAgent } from '../flow/agent/agentEngine';
// Straight from the pure module, not through the engine's barrel: delivery needs the fact, not
// the loop, and routing it through `agentEngine` makes every test that stubs the engine drop it.
import { withWriteFailureNotice, writesAllFailed } from '../flow/agent/writeOutcome';
import { buildActionFooter, withActionFooter } from '../flow/agent/actionOutcome';
import { mergeSnapshots } from '../flow/agent/evidenceLedger';
import type { ActionRecord, EvidenceSnapshot } from '../flow/agent/evidenceLedger';
import type { GoalIntent } from '../flow/agent/actionGate';
import type { Fact } from '../flow/agent/toolContracts';
import { loadConversation } from './conversationStore';
// Imported from agentTools, not through the engine's re-export: a test that mocks the engine
// would otherwise lose it and take an unrelated error path down with it.
import { AgentScopeError, BOT_TOOL_SCOPE, FULL_TOOL_SCOPE, withWebCapability } from '../flow/agent/agentTools';
import type { AgentToolScope } from '../flow/agent/agentTools';
import type { AgentScopeFailure } from '../flow/agent/agentTools';
import { buildAgentConfirm } from './agentConfirm';
import { measureTokens } from '../tokenMeter';
import type { TokenUsage } from '../../shared/tokenEstimate';
import type { AgentProgress } from '../flow/agent/agentEngine';
import {
  deleteRunState, loadRunState, readRunConnectors, registerRun, saveRunState, unregisterRun,
} from '../flow/agent/agentRunStore';
import type { CommandOrigin } from './commandOrigin';
import type { FlowManager } from '../flow';
import type { MemoryNote } from '../../shared/userMemory';
import type { MemoryAccessContext } from '../memory';
import { agentMemoryBlock, resolveAgentMemory, settleAgentMemory } from './agentMemory';

type Strings = Record<string, string>;

const SCOPE_ERROR_KEYS: Record<AgentScopeFailure, string> = {
  'not-connected': 'mcp.command.notConnected',
  'no-room': 'mcp.command.noRoom',
};

export interface AgentRunDeps {
  flowManager?: FlowManager;
  getMainWin: () => BrowserWindow | null;
}

export interface AgentRunRequest {
  state: AgentRunState;
  resumeFrom?: AgentTurnRecord[];
  strings: Strings;
  deliveredPrompt?: string;
  origin?: CommandOrigin;
  onProgressText?: (text: string) => void;
  /** Narrower than this origin's default. Widening it here is not possible — `withWebCapability`
   * still applies on top, so the composer's switch cannot be talked around by a caller. */
  toolScope?: AgentToolScope;
  /** Who is asking, for the memory: a bot caller says whether this is the user's own private chat. */
  memory?: MemoryAccessContext;
}

export interface AgentRunOutcome extends AgentCommandResult {
  answer?: string;
  title?: string;
  /** What the answer changed in the user's memory; a bot appends these to its message. */
  memoryNotes?: MemoryNote[];
}

function summarizeGoal(goal: string): string {
  return compactPreview(goal, 96);
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

/** How far back a conversation's earlier runs are read for what they really did. */
const PRIOR_RUNS_LIMIT = 8;

function snapshotOf(run: AgentRunState, withObservations: boolean): EvidenceSnapshot {
  return {
    facts: (run.evidence?.facts ?? []) as Fact[],
    actions: (run.evidence?.actions ?? []) as unknown as ActionRecord[],
    ...(withObservations
      ? {
          observations: run.turns
            .filter((turn) => turn.status === 'ok' && turn.observation)
            .map((turn) => `${JSON.stringify(turn.config)}\n${turn.observation}`),
        }
      : {}),
  };
}

/**
 * The evidence of earlier runs in this conversation, read from their run files rather than from the
 * answers written about them. A temporary chat keeps no run files, so it has none to offer.
 */
async function loadPriorEvidence(state: AgentRunState, resuming: boolean): Promise<EvidenceSnapshot | undefined> {
  const snapshots: EvidenceSnapshot[] = [];
  if (state.conversationPath && !isTempChatMode()) {
    const doc = (await loadConversation(state.conversationPath))?.doc;
    const runIds = [...new Set((doc?.turns ?? [])
      .map((turn) => turn.meta.r)
      .filter((id): id is string => Boolean(id) && id !== state.runId))].slice(-PRIOR_RUNS_LIMIT);
    const runs = await Promise.all(runIds.map((id) => loadRunState(id).catch(() => null)));
    for (const run of runs) if (run) snapshots.push(snapshotOf(run, true));
    const userWords = (doc?.turns ?? []).map((turn) => turn.prompt).join('\n');
    if (userWords) snapshots.push({ facts: [], actions: [], userWords });
  }
  if (resuming && state.evidence) snapshots.push(snapshotOf(state, false));
  return snapshots.length > 0 ? mergeSnapshots(snapshots) : undefined;
}

interface DeliverArgs {
  prompt: string;
  title: string;
  answer: string;
  resolvedTarget: string;
  strings: Strings;
  origin: CommandOrigin;
  /** The slash command the turn is badged with — `agent`, or the MCP server's own command. */
  command: string;
  conversationPath?: string;
  usage?: TokenUsage;
  attachments?: string[];
  /** Links the saved turn back to its run file, so the chat can reopen the trace on demand. */
  runId?: string;
  choices?: string[];
  memoryNotes?: MemoryNote[];
}

/**
 * Temporary chat promises the turn is not written down. That has to cover the run file too:
 * keeping finished runs for their trace is right for an ordinary conversation and wrong here,
 * where it would leave a week of goals and observations on disk for a chat the user asked not
 * to keep. One definition, used by both the delivery path and the run's own bookkeeping.
 */
function isEphemeralDelivery(origin: CommandOrigin): boolean {
  return origin === 'app' && isTempChatMode();
}

async function deliverResult(args: DeliverArgs): Promise<AgentRunOutcome> {
  const {
    prompt, title, answer, resolvedTarget, strings, origin, command,
    conversationPath, usage, attachments, runId, choices, memoryNotes,
  } = args;
  const conversationTitle = pickConversationTitle({ resolved: title, prompt });
  const attached = attachmentMetaNames(attachments ?? []);
  const markdownOptions = {
    prompt,
    turnMeta: {
      c: command,
      ...(attached.length > 0 ? { a: attached } : {}),
      ...(runId ? { r: runId } : {}),
      ...(choices?.length ? { ch: choices.map((choice) => choice.replace(/-->/g, '--')) } : {}),
      ...(memoryNotes?.length ? { mem: memoryNotes } : {}),
    },
    response: answer,
    title: conversationTitle,
    provider: getProviderLabel(resolvedTarget),
    providerLabel: strings['md.provider'] ?? 'Provider',
    promptLabel: strings['md.prompt'] ?? 'Prompt',
    responseLabel: strings['md.response'] ?? 'Response',
    timestampLabel: strings['md.timestamp'] ?? 'Time',
  };

  if (isEphemeralDelivery(origin)) {
    deliverCommandResultToTempChat({
      markdownOptions,
      prompt,
      response: answer,
      providerLabel: markdownOptions.provider,
      command,
      ...(attachments?.length ? { attachments } : {}),
      ...(usage ? { usage } : {}),
      ...(runId ? { runId } : {}),
      ...(choices?.length ? { choices } : {}),
      ...(memoryNotes?.length ? { memoryNotes } : {}),
    });
    return { success: true, answer, title: conversationTitle, ...(memoryNotes?.length ? { memoryNotes } : {}) };
  }

  const filePath = await saveCommandOutput({
    conversationPath,
    markdownOptions,
    prompt: markdownOptions.prompt,
    response: markdownOptions.response,
    providerLabel: markdownOptions.provider,
    command,
    ...(attachments?.length ? { attachments } : {}),
    ...(runId ? { runId } : {}),
    ...(choices?.length ? { choices } : {}),
    ...(memoryNotes?.length ? { memoryNotes } : {}),
    usage,
  });
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
  return { success: true, filePath, answer, title: conversationTitle, ...(memoryNotes?.length ? { memoryNotes } : {}) };
}

export function executeAgentRun(deps: AgentRunDeps, request: AgentRunRequest): Promise<AgentRunOutcome> {
  const { state, resumeFrom, strings } = request;
  const origin = request.origin ?? 'app';
  const deliveredPrompt = request.deliveredPrompt ?? state.goal;
  const flowManager = deps.flowManager;
  if (!flowManager) return Promise.resolve({ success: false, error: t(strings, 'agent.error.unavailable') });

  const { runId, goal, providerUrl } = state;
  const connectors = readRunConnectors(state);
  const command = state.mcpCommandName?.trim() || BUILTIN_AGENT_COMMAND;
  const emit = (event: AgentTraceEvent): void => {
    if (event.kind === 'plan') {
      state.plan = { steps: [...event.steps], done: [...event.done] };
      state.updatedAt = new Date().toISOString();
      void saveRunState(state);
    }
    sendToRenderer(IPC.AGENT_TRACE, { runId, event } satisfies AgentTracePayload);
  };

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
      const turnAttachments = resumeFrom?.length ? undefined : state.attachments;

      // Naming a connector is the user saying which server should answer, so the "goal is just
      // a URL" shortcut — which fetches a web page instead — would quietly answer a different
      // question. `web === false` rules it out for the same reason it removes `browser`:
      // fetching the page IS going online, whoever typed the URL.
      if (state.web !== false && connectors.length === 0 && !resumeFrom?.length && !state.attachments?.length) {
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
          return await deliverResult({
            prompt: deliveredPrompt,
            title: shortcutTitle,
            answer: shortcutAnswer,
            resolvedTarget: shortcut.providerUrl,
            strings,
            origin,
            command,
            conversationPath: state.conversationPath,
            usage: shortcutUsage,
          });
        }
      }

      await saveRunState(state);

      const resuming = Boolean(resumeFrom?.length);
      const priorEvidence = await loadPriorEvidence(state, resuming).catch(() => undefined);
      const previousActions = resuming ? state.evidence?.actions ?? [] : [];
      const persistEvidence = (evidence: EvidenceSnapshot, actions: readonly ActionRecord[]): void => {
        state.evidence = { facts: evidence.facts, actions: [...previousActions, ...actions] };
      };
      const memory = await resolveAgentMemory(origin, request.memory);
      const userMemory = agentMemoryBlock(memory);

      const { result: outcome, usage } = await measureTokens(() => runAgent(
        goal,
        providerUrl,
        flowManager.getExecutorDeps(),
        {
          onProgress,
          onTrace: emit,
          onTurn,
          resumeFrom,
          resumePlan: state.plan,
          runId,
          ...(origin === 'bot' ? { unattended: true } : {}),
          ...(userMemory ? { userMemory } : {}),
          ...(priorEvidence ? { priorEvidence } : {}),
          ...(state.intent ? { intent: state.intent as GoalIntent } : {}),
          onIntent: (declared) => {
            state.intent = { change: [...declared.change], content: declared.content };
            void saveRunState(state);
          },
          ...(state.maxTurns ? { maxTurns: state.maxTurns } : {}),
          ...(state.conversationPath ? { conversationPath: state.conversationPath } : {}),
          ...(state.attachments?.length ? { attachments: state.attachments } : {}),
          signal: controller.signal,
          onConfirm: buildAgentConfirm(deps.getMainWin, strings, origin),
          onStepBudget: (ceiling) => {
            state.maxTurns = ceiling;
            void saveRunState(state);
          },
          // Two narrowings, both applied here. A bot run can never answer a confirmation dialog —
          // both bot entry points pass `getMainWin: () => null` — so the tools that need one are
          // removed from its vocabulary rather than offered and then refused, which would burn a
          // turn and a queue slot per attempt. On top of that, `state.web === false` is the
          // composer's "web" checkbox, which takes the three online tools out of every scope.
          toolScope: withWebCapability(
            request.toolScope ?? (origin === 'bot' ? BOT_TOOL_SCOPE : FULL_TOOL_SCOPE),
            state.web !== false,
          ),
          onSaveFlow: (flow) => flowManager.saveGeneratedFlow(flow),
          // Keyed by the run id so the chat turn and the Flow Builder panel read the same stream.
          onFlowBuild: (event) => sendToRenderer(
            IPC.FLOW_BUILD_PROGRESS,
            { buildId: runId, event } satisfies FlowBuildPayload,
          ),
          // Disclosure, not restriction: the built-in tools stay in scope so the model can
          // decide the connector is not the right instrument for this turn. Never `[]` — an
          // empty array filters every server out and, with built-ins still present, produces a
          // silent zero-connector run instead of an error.
          ...(connectors.length > 0 ? { mcpServerIds: connectors } : {}),
        },
      ));

      const actions = outcome.actions ?? [];
      persistEvidence(outcome.evidence ?? { facts: [], actions: [] }, actions);

      if (outcome.kind === 'question') {
        const choices = outcome.choices ?? [];
        // Numbered in the text as well as offered as buttons: a bot user can only type, and "2" is
        // expanded back to the choice when the answer arrives.
        const questionText = choices.length > 0
          ? `${outcome.question}\n\n${choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n')}`
          : outcome.question;
        const delivered = await deliverResult({
          prompt: deliveredPrompt,
          title: '',
          answer: questionText,
          resolvedTarget: providerUrl,
          strings,
          origin,
          command,
          conversationPath: state.conversationPath,
          usage,
          attachments: turnAttachments,
          ...(isEphemeralDelivery(origin) ? {} : { runId }),
          ...(choices.length > 0 ? { choices } : {}),
        });
        state.status = 'awaiting';
        state.updatedAt = new Date().toISOString();
        if (delivered.filePath) state.conversationPath = delivered.filePath;
        await saveRunState(state);
        emit({ kind: 'question', question: outcome.question, ...(choices.length > 0 ? { choices } : {}) });
        return {
          ...delivered,
          question: outcome.question,
          ...(choices.length > 0 ? { choices } : {}),
          runId,
          ...(state.mcpServerIds?.length ? { mcpServerIds: [...state.mcpServerIds] } : {}),
        };
      }

      const { text: answer, notes: memoryNotes } = await settleAgentMemory(
        outcome.answer.trim(),
        memory,
        state,
        origin,
        (key) => t(strings, key),
      );
      if (!answer) {
        state.status = 'failed';
        state.error = t(strings, 'agent.error.incomplete');
        state.updatedAt = new Date().toISOString();
        await saveRunState(state);
        emit({ kind: 'failed', error: state.error });
        return { success: false, error: state.error };
      }

      // The model was asked to own a failed write; this makes it true whatever it wrote. The
      // notice is appended, not substituted — its own text usually still names the page and the
      // error, it just must not be allowed to end on a success it did not achieve.
      // The footer is written from what each change really did, so it replaces the blanket notice
      // whenever it has something to say; the notice still covers writes no footer line describes.
      const footer = buildActionFooter(actions, (key, vars) => t(strings, key, vars));
      const finalAnswer = writesAllFailed(outcome.writes) && !footer
        ? withWriteFailureNotice(
          answer,
          outcome.writes,
          t(strings, 'agent.writes.allFailed', { count: String(outcome.writes.attempted) }),
        )
        : withActionFooter(answer, footer);

      const ephemeral = isEphemeralDelivery(origin);
      state.status = 'done';
      state.result = { title: outcome.title, content: finalAnswer };
      state.updatedAt = new Date().toISOString();
      emit({ kind: 'done', title: outcome.title });
      // Kept, not deleted: a finished run is exactly the one worth reopening when the answer and
      // the page disagree, and it was the only status that left nothing behind. `pruneOldRuns`
      // still reclaims it once stale, and `shouldOfferOnRestart` never offers a done run.
      if (ephemeral) await deleteRunState(runId);
      else await saveRunState(state);
      return await deliverResult({
        prompt: deliveredPrompt,
        title: outcome.title,
        answer: finalAnswer,
        resolvedTarget: providerUrl,
        strings,
        origin,
        command,
        conversationPath: state.conversationPath,
        usage,
        attachments: turnAttachments,
        // No id on an ephemeral turn: the run file it would point at has just been removed.
        // None on a turn that called no tool either. Every ordinary chat message is an agent run
        // now, and a "show the reasoning" toggle under each one that opens onto an empty list is
        // noise on the common case — there is nothing to reopen when nothing was looked up.
        ...(ephemeral || state.turns.length === 0 ? {} : { runId }),
        ...(memoryNotes.length > 0 ? { memoryNotes } : {}),
      });
    } catch (err: unknown) {
      const aborted = controller.signal.aborted;
      const message = aborted
        ? t(strings, 'agent.error.cancelled')
        : err instanceof AgentScopeError
          ? t(strings, SCOPE_ERROR_KEYS[err.reason], { command })
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
    `/${command} ${summarizeGoal(goal)}`,
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

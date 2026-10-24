import type { BrowserWindow } from 'electron';
import { BUILTIN_AGENT_COMMAND, IPC } from '../../shared/types';
import type {
  AgentCommandResult,
  AgentPendingFlow,
  AgentRunState,
  BotPlatform,
  AgentTraceEvent,
  AgentTracePayload,
  AgentTurnRecord,
  FlowDefinition,
} from '../../shared/types';
import { conversationFlowRefs } from '../flow/flowEdit';
import { pickConversationTitle } from '../../shared/conversationTitle';
import { attachmentMetaNames } from '../../shared/conversationDoc';
import { compactPreview } from '../../shared/textBudget';
import { listOutputFiles } from '../files';
import { deliverCommandResultToTempChat, saveCommandOutput } from './commandOutput';
import { runUrlShortcut } from './urlShortcut';
import { getTempChatConversation, isTempChatMode } from '../tempChat';
import { sendLog, sendToRenderer } from '../helpers';
import { buildCombinedPromptFromPrefs, localizeUserFacingError, t } from '../i18n';
import { agentPromptPrefs, agentRunIsOwner, renderAgentPrefsBlock } from './agentPrefs';
import { getProviderLabel } from '../providers';
import { runAgent } from '../flow/agent/agentEngine';
import { sendBuildEvent } from '../flow/flowBuildBroadcast';
// Straight from the pure module, not the engine's barrel: delivery needs the fact, not the loop.
import { withWriteFailureNotice, writesAllFailed } from '../flow/agent/writeOutcome';
import { buildActionFooter, withActionFooter } from '../flow/agent/actionOutcome';
import { completionNotice, withCompletionNotice } from '../flow/agent/completion';
import { extractRecapLine } from './recapLine';
import { agentRecapBlock } from './recapPrompt';
import { currentRecap } from '../../shared/recap';
import { mergeSnapshots } from '../flow/agent/evidenceLedger';
import type { ActionRecord, EvidenceSnapshot } from '../flow/agent/evidenceLedger';
import type { GoalIntent } from '../flow/agent/actionGate';
import type { Fact } from '../flow/agent/toolContracts';
import { loadConversation } from './conversationStore';
import {
  AgentRunError, AgentScopeError, BOT_TOOL_SCOPE, FULL_TOOL_SCOPE, isAllowedTool, isWebTool, withPictureCapability,
  withWebCapability,
} from '../flow/agent/agentTools';
import { isBuiltinTool } from '../flow/agent/agentBuiltins';
import type { AgentBuiltinTool, FlowSaveRequest } from '../flow/agent/agentBuiltins';
import type { AgentToolScope } from '../flow/agent/agentTools';
import type { AgentRunFailure, AgentScopeFailure } from '../flow/agent/agentTools';
import { buildAgentConfirm, connectorApprovalText, shellApprovalText } from './agentConfirm';
import { flowApprovalText } from './flowApprovalText';
import { loadRecipientDirectory } from '../flow/botRecipientDirectory';
import { directorySeenBy, EMPTY_RECIPIENT_DIRECTORY } from '../../shared/botRecipients';
import { numberedQuestion } from '../flow/agent/shellApproval';
import { measureTokens } from '../tokenMeter';
import type { TokenUsage } from '../../shared/tokenEstimate';
import type { AgentProgress, McpConfirmRequest, ShellConfirmRequest } from '../flow/agent/agentEngine';
import {
  deleteRunState, isBotRun, loadRunState, readRunConnectors, registerRun, saveRunState, unregisterRun,
} from '../flow/agent/agentRunStore';
import { publicWebOnlyIf } from '../net/publicWebScope';
import type { CommandOrigin } from './commandOrigin';
import type { FlowManager } from '../flow';
import type { MemoryNote } from '../../shared/userMemory';
import type { AgentMemoryContext } from './agentMemory';
import { agentMemoryBlock, resolveAgentMemory, settleAgentMemory } from './agentMemory';
import { noteRunOutcome, runInMetricDomain } from '../llmMeter';
import { agentRunMetricOutcome } from './agentRunMetrics';
import { busyUntilSettled, markConversationBusy } from '../conversationBusy';
import { conversationIdAt, resolveConversationPath } from '../conversationIndex';
import { config } from '../config';
import { agentPictureDrawer, agentPictureKeeper, runPictures } from './agentPictures';

type Strings = Record<string, string>;

const SCOPE_ERROR_KEYS: Record<AgentScopeFailure, string> = {
  'not-connected': 'mcp.command.notConnected',
  'no-room': 'mcp.command.noRoom',
};

/** The model's rejected JSON is not something a person can act on, so it never reaches one. */
const RUN_ERROR_KEYS: Record<AgentRunFailure, string> = {
  invalid_output: 'agent.error.incomplete',
  step_limit: 'agent.error.stepLimit',
  stale_provider: 'agent.error.staleProvider',
};

/**
 * What a failed run tells the user — the chat toast, the trace and bot replies alike. The engine's
 * English stays in the log line and in the run file's `errorDetail`.
 */
function agentFailureText(err: unknown, strings: Strings, command: string, providerUrl: string): string {
  if (err instanceof AgentScopeError) return t(strings, SCOPE_ERROR_KEYS[err.reason], { command });
  if (err instanceof AgentRunError) {
    return t(strings, RUN_ERROR_KEYS[err.reason], { provider: err.provider || getProviderLabel(providerUrl) });
  }
  return localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);
}

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
  memory?: AgentMemoryContext;
  /** A Maps link with a question is answered from its reviews, not the tool loop. Only for a caller
   * whose tools are read-only lookups, so the words around the link cannot be a task. */
  linkQuestions?: boolean;
  /** Only these MCP servers exist for the run (a bot account's per-connector grants). */
  allowedMcpServerIds?: readonly string[];
  /**
   * A bot account holding the shell grant: each shell command is put to it as a question in the
   * chat and runs when the answer approves it. Without this a bot run never runs one.
   */
  shellInChat?: boolean;
  /**
   * The owner in their own private bot chat: a connector change is put to them as a question in the
   * chat and made when the answer approves it. Without this a bot run's changes are refused.
   */
  connectorChangesInChat?: boolean;
  /**
   * A bot admin in their own private chat (the owner, or a Telegram admin-grant holder): the scope
   * carries the flow builders, and a flow they build or change is put to them as a question in the
   * chat and saved when the answer approves it. "Me" in a recipient is `requester`.
   */
  flowsInChat?: { owner: boolean; requester: { platform: BotPlatform; userId: string } };
  /** Name prefix for the file the answer starts when there is no conversation yet (a bot chat's). */
  fileLabel?: string;
}

export interface AgentRunOutcome extends AgentCommandResult {
  answer?: string;
  title?: string;
  /** What the answer changed in the user's memory; a bot appends these to its message. */
  memoryNotes?: MemoryNote[];
  /** The question asks to approve a shell command or a connector change: a bot sends it word for word (see `BotBuiltinRunResult.verbatim`). */
  shellApproval?: boolean;
  /** Pictures `draw_image` drew for the answer, in the chat media folder; a bot sends them as photos. */
  files?: string[];
}

function summarizeGoal(goal: string): string {
  return compactPreview(goal, 96);
}

const BUILTIN_PROGRESS_KEYS: Record<AgentBuiltinTool, string> = {
  assess_flow: 'agent.progress.assessFlow',
  build_flow: 'agent.progress.buildFlow',
  edit_flow: 'agent.progress.editFlow',
  delegate: 'agent.progress.delegate',
  draw_image: 'agent.progress.drawImage',
};

/**
 * The line a bot's progress message and the app's queue show. It names what the user would call
 * the tool — the skill's translated name, the connector's own name — never an id like `research`
 * or `mcp:notion-search`.
 */
export function progressText(progress: AgentProgress, strings: Strings): string {
  if (progress.stage === 'connecting') return t(strings, 'agent.progress.connecting', { server: progress.server });
  if (progress.stage !== 'tool') return t(strings, 'agent.progress.thinking');
  if (progress.server) return t(strings, 'agent.progress.tool', { tool: progress.server });
  if (isBuiltinTool(progress.tool)) return t(strings, BUILTIN_PROGRESS_KEYS[progress.tool]);
  if (!isAllowedTool(progress.tool)) return t(strings, 'agent.progress.connector');
  return t(strings, 'agent.progress.tool', { tool: t(strings, `flow.skill.${progress.tool}`) });
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

interface PriorRuns {
  runs: AgentRunState[];
  userWords: string;
}

/**
 * The earlier runs of this conversation, read from their run files rather than from the answers
 * written about them. A temporary chat keeps no run files, so it has none to offer.
 */
async function loadPriorRuns(state: AgentRunState): Promise<PriorRuns> {
  if (!state.conversationPath || isTempChatMode()) return { runs: [], userWords: '' };
  const doc = (await loadConversation(state.conversationPath))?.doc;
  const runIds = [...new Set((doc?.turns ?? [])
    .map((turn) => turn.meta.r)
    .filter((id): id is string => Boolean(id) && id !== state.runId))].slice(-PRIOR_RUNS_LIMIT);
  const runs = await Promise.all(runIds.map((id) => loadRunState(id).catch(() => null)));
  return {
    runs: runs.filter((run): run is AgentRunState => run !== null),
    userWords: (doc?.turns ?? []).map((turn) => turn.prompt).join('\n'),
  };
}

/** Where the conversation stood before this run, for the recap rule; a temporary chat is read from memory. */
async function conversationRecap(state: AgentRunState, origin: CommandOrigin): Promise<string | undefined> {
  const doc = isEphemeralDelivery(origin)
    ? await getTempChatConversation()
    : state.conversationPath ? (await loadConversation(state.conversationPath))?.doc : null;
  return doc ? currentRecap(doc)?.text : undefined;
}

function priorEvidenceOf(prior: PriorRuns, state: AgentRunState, resuming: boolean): EvidenceSnapshot | undefined {
  const snapshots: EvidenceSnapshot[] = prior.runs.map((run) => snapshotOf(run, true));
  if (prior.userWords) snapshots.push({ facts: [], actions: [], userWords: prior.userWords });
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
  /** The turn's recap line as `recapFor` resolves it; undefined keeps the previous recap. */
  recap?: string;
  fileLabel?: string;
  /** `Date.now()` when this run (or its resumption) started, for the turn's duration. */
  startedAt?: number;
  /** Pictures shown under the answer (the turn's `mv`) and returned for a bot to send. */
  pictures?: string[];
}

/**
 * Temporary chat writes nothing down, run files included; shared by delivery and the run's bookkeeping.
 */
function isEphemeralDelivery(origin: CommandOrigin): boolean {
  return origin === 'app' && isTempChatMode();
}

async function deliverResult(args: DeliverArgs): Promise<AgentRunOutcome> {
  const {
    prompt, title, answer, resolvedTarget, strings, origin, command,
    conversationPath, usage, attachments, runId, choices, memoryNotes, recap, fileLabel, startedAt, pictures,
  } = args;
  const conversationTitle = pickConversationTitle({ resolved: title, prompt });
  const drawn = pictures?.length ? { chatMedia: pictures } : {};
  const sent = pictures?.length ? { files: pictures } : {};
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
      ...(recap !== undefined ? { recap } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...drawn,
    });
    return { success: true, answer, title: conversationTitle, ...(memoryNotes?.length ? { memoryNotes } : {}), ...sent };
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
    ...(recap !== undefined ? { recap } : {}),
    ...(fileLabel ? { fileLabel } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...drawn,
    usage,
  });
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
  return { success: true, filePath, answer, title: conversationTitle, ...(memoryNotes?.length ? { memoryNotes } : {}), ...sent };
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
  // Reset when the run leaves the queue, so the turn's duration is the run, not the wait.
  let startedAt = Date.now();
  const deliver = (args: DeliverArgs): Promise<AgentRunOutcome> => deliverResult({
    ...args,
    startedAt,
    ...(request.fileLabel ? { fileLabel: request.fileLabel } : {}),
  });

  // The app's chat keeps a recap, written by the model with the answer; with no line the previous one stays.
  // A bot run in the same conversation leaves a stop instead: it was never asked for one.
  const recapFor = (line: string | null | undefined): string | undefined => (
    origin === 'app' ? (line || undefined) : ''
  );

  const attempt = async (taskId?: string): Promise<AgentRunOutcome> => {
    startedAt = Date.now();
    let releaseFound = (): void => {};
    try {
      // A conversation moved since the run was saved (an answer days later) is found by its id.
      const before = state.conversationPath;
      await adoptRunConversation(state);
      if (state.conversationPath && state.conversationPath !== before) {
        releaseFound = markConversationBusy(state.conversationPath, 'agent');
      }
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
      // The "AI responses" settings, for the URL shortcut's single send and for the agent's answer.
      const answerPrefs = agentPromptPrefs(await agentRunIsOwner(origin, request.memory));

      // Naming a connector is the user saying which server should answer, so the "goal is just
      // a URL" shortcut — which fetches a web page instead — would quietly answer a different
      // question. `web === false` rules it out for the same reason it removes `browser`:
      // fetching the page IS going online, whoever typed the URL.
      // A message replied to is part of the question, so a link typed under it is not the whole of it.
      if (state.web !== false && connectors.length === 0 && !resumeFrom?.length && !state.attachments?.length && !state.replyTo) {
        report({ stage: 'thinking' });
        const { result: shortcut, usage: shortcutUsage } = await measureTokens(
          () => runUrlShortcut(goal, providerUrl, flowManager.getExecutorDeps(), strings, controller.signal, {
            mapQuestions: request.linkQuestions === true,
            ...(answerPrefs ? { instruction: buildCombinedPromptFromPrefs(answerPrefs, strings) } : {}),
          }),
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
          // Fetching the pasted page IS going online, so the composer is told as for a web tool.
          const delivered = await deliver({
            prompt: deliveredPrompt,
            title: shortcutTitle,
            answer: shortcutAnswer,
            resolvedTarget: shortcut.providerUrl,
            strings,
            origin,
            command,
            conversationPath: state.conversationPath,
            usage: shortcutUsage,
            // The shortcut writes no recap line; `recapFor` decides what the turn keeps.
            recap: recapFor(null),
          });
          return { ...delivered, usedWeb: true };
        }
      }

      await saveRunState(state);

      const resuming = Boolean(resumeFrom?.length);
      const prior = await loadPriorRuns(state).catch((): PriorRuns => ({ runs: [], userWords: '' }));
      const priorEvidence = priorEvidenceOf(prior, state, resuming);
      // Earlier runs first, then what this run itself saved before it paused for a question.
      const conversationFlows = conversationFlowRefs([...prior.runs, ...(resuming ? [state] : [])], () => flowManager.getAll());
      const recordFlow = (saved: FlowDefinition): FlowDefinition => {
        state.flows = [...(state.flows ?? []).filter((ref) => ref.id !== saved.id), { id: saved.id, name: saved.name }];
        void saveRunState(state);
        return saved;
      };
      const previousActions = resuming ? state.evidence?.actions ?? [] : [];
      const persistEvidence = (evidence: EvidenceSnapshot, actions: readonly ActionRecord[]): void => {
        state.evidence = { facts: evidence.facts, actions: [...previousActions, ...actions] };
      };
      const flowsInChat = origin === 'bot' ? request.flowsInChat : undefined;
      // Read once for the run: whom "me" and a name in a flow the admin builds resolve to.
      const flowRecipients = flowsInChat
        ? directorySeenBy(
          await loadRecipientDirectory().catch(() => EMPTY_RECIPIENT_DIRECTORY),
          flowsInChat.requester.platform,
          flowsInChat.requester.userId,
        )
        : undefined;
      const memory = await resolveAgentMemory(origin, request.memory);
      const userMemory = agentMemoryBlock(memory);
      const prefsBlock = answerPrefs ? renderAgentPrefsBlock(answerPrefs) : '';
      // An unreadable conversation costs the recap its history, never the run.
      const recapRule = origin === 'app'
        ? agentRecapBlock(await conversationRecap(state, origin).catch(() => undefined))
        : '';

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
          ...(prefsBlock ? { answerPrefs: prefsBlock } : {}),
          ...(userMemory ? { userMemory } : {}),
          ...(recapRule ? { recapRule } : {}),
          ...(priorEvidence ? { priorEvidence } : {}),
          ...(state.intent ? { intent: state.intent as GoalIntent } : {}),
          onIntent: (declared) => {
            state.intent = { change: [...declared.change], content: declared.content };
            void saveRunState(state);
          },
          ...(state.maxTurns ? { maxTurns: state.maxTurns } : {}),
          ...(state.conversationPath ? { conversationPath: state.conversationPath } : {}),
          // Only the desktop composer's run is the temporary chat; a bot run never reads it.
          ...(isEphemeralDelivery(origin) ? { temporaryChat: true } : {}),
          ...(state.attachments?.length ? { attachments: state.attachments } : {}),
          ...(state.replyTo ? { replyTo: state.replyTo } : {}),
          ...(state.recentChat?.length ? { recentChat: state.recentChat } : {}),
          ...(state.chatRecap ? { chatRecap: true as const } : {}),
          signal: controller.signal,
          onConfirm: buildAgentConfirm(deps.getMainWin, strings, origin),
          ...(origin === 'bot' && request.shellInChat
            ? { shellApproval: (req: ShellConfirmRequest) => shellApprovalText(req, strings) }
            : {}),
          ...(origin === 'bot' && request.connectorChangesInChat
            ? { connectorApproval: (req: McpConfirmRequest) => connectorApprovalText(req, strings) }
            : {}),
          ...(flowsInChat
            ? {
              flowApproval: { hold: { owner: flowsInChat.owner }, text: (req: FlowSaveRequest) => flowApprovalText(req, strings) },
              ...(flowRecipients ? { recipients: flowRecipients } : {}),
              onEnableFlow: (flowId: string) => flowManager.enableFlowFromAgent(flowId),
            }
            : {}),
          // Every bot run gets these, admin or not now: an answer to a held flow clears it either way.
          ...(origin === 'bot'
            ? {
              ...(state.pendingFlow ? { pendingFlow: state.pendingFlow } : {}),
              onPendingFlow: (pending: AgentPendingFlow | undefined) => {
                if (pending) state.pendingFlow = pending;
                else delete state.pendingFlow;
                void saveRunState(state);
              },
            }
            : {}),
          onStepBudget: (ceiling) => {
            state.maxTurns = ceiling;
            void saveRunState(state);
          },
          // Two narrowings, both applied here. A bot run can never answer a confirmation dialog —
          // both bot entry points pass `getMainWin: () => null` — so the tools that need one are
          // removed from its vocabulary rather than offered and then refused, which would burn a
          // turn and a queue slot per attempt. On top of that, `state.web === false` is the
          // composer's "web" checkbox, which takes the three online tools out of every scope.
          // `draw_image` goes wherever a picture can reach the user — the desktop chat; a bot's
          // scope says whether this account may draw — never on the wording: the model reads what
          // was meant (2026-10-22, two picture requests the patterns missed met "no image tool").
          toolScope: withPictureCapability(
            withWebCapability(
              request.toolScope ?? (origin === 'bot' ? BOT_TOOL_SCOPE : FULL_TOOL_SCOPE),
              state.web !== false,
            ),
            request.toolScope ? request.toolScope.pictures === true : origin !== 'bot',
          ),
          // ChatGPT draws only in a normal chat, deleted afterwards as the image command does.
          drawImage: agentPictureDrawer(state, config.oneShotTemporaryChat || isEphemeralDelivery(origin)),
          keepPictures: agentPictureKeeper(state),
          onSaveFlow: async (flow) => recordFlow(await flowManager.saveGeneratedFlow(flow)),
          onReplaceFlow: async (flow) => recordFlow(await flowManager.replaceFlowFromAgent(flow)),
          listFlows: () => flowManager.getAll(),
          ...(conversationFlows.length > 0 ? { conversationFlows } : {}),
          // Keyed by the run id so the chat turn and the Flow Builder panel read the same stream.
          onFlowBuild: (event) => sendBuildEvent(runId, event, strings),
          // Disclosure, not restriction: the built-in tools stay in scope so the model can
          // decide the connector is not the right instrument for this turn. Never `[]` — an
          // empty array filters every server out and, with built-ins still present, produces a
          // silent zero-connector run instead of an error.
          ...(connectors.length > 0 ? { mcpServerIds: connectors } : {}),
          // The restriction the run was started with, read off the saved state so a resume keeps it.
          ...(state.connectors === 'none' ? { noConnectors: true } : {}),
          ...(request.allowedMcpServerIds ? { allowedMcpServerIds: request.allowedMcpServerIds } : {}),
        },
      ));

      const actions = outcome.actions ?? [];
      persistEvidence(outcome.evidence ?? { facts: [], actions: [] }, actions);
      const usedWeb = state.turns.some((turn) => isWebTool(turn.tool));

      if (outcome.kind === 'question') {
        const choices = outcome.choices ?? [];
        const questionText = numberedQuestion(outcome.question, choices);
        const delivered = await deliver({
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
          // A question is not an answer: the recap the conversation had still holds.
          recap: recapFor(null),
        });
        state.status = 'awaiting';
        state.updatedAt = new Date().toISOString();
        if (delivered.filePath) {
          state.conversationPath = delivered.filePath;
          await adoptRunConversation(state);
        }
        await saveRunState(state);
        emit({ kind: 'question', question: outcome.question, ...(choices.length > 0 ? { choices } : {}) });
        return {
          ...delivered,
          question: outcome.question,
          ...(choices.length > 0 ? { choices } : {}),
          ...(outcome.shellApproval ? { shellApproval: true } : {}),
          ...(usedWeb ? { usedWeb } : {}),
          runId,
          ...(state.mcpServerIds?.length ? { mcpServerIds: [...state.mcpServerIds] } : {}),
        };
      }

      // Out before the memory reads the answer, as in chat; taken from any run, so a bot never shows one.
      const { recap: recapLine, body: recapStripped } = extractRecapLine(outcome.answer.trim());
      const { text: answer, notes: memoryNotes } = await settleAgentMemory(
        recapStripped,
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

      // When every write failed and there is no per-change footer, a failure notice is appended so the
      // answer never ends on a success it did not achieve; otherwise the footer is appended.
      const footer = buildActionFooter(actions, (key, vars) => t(strings, key, vars));
      // Same guarantee for the goal as a whole: an answer the run knows is partial says so in a line
      // the model did not write, ahead of the footer about what each change really did.
      const answered = withCompletionNotice(answer, completionNotice(outcome.completion, (key, vars) => t(strings, key, vars)));
      const finalAnswer = writesAllFailed(outcome.writes) && !footer
        ? withWriteFailureNotice(
          answered,
          outcome.writes,
          t(strings, 'agent.writes.allFailed', { count: String(outcome.writes.attempted) }),
        )
        : withActionFooter(answered, footer);

      const ephemeral = isEphemeralDelivery(origin);
      state.status = 'done';
      state.result = { title: outcome.title, content: finalAnswer, completion: outcome.completion };
      state.updatedAt = new Date().toISOString();
      emit({ kind: 'done', title: outcome.title });
      // A finished run is kept so its trace can be reopened; `pruneOldRuns` reclaims it once stale
      // and `shouldOfferOnRestart` never offers a done run. Ephemeral runs leave no file.
      if (ephemeral) await deleteRunState(runId);
      else await saveRunState(state);
      const delivered = await deliver({
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
        // No run id when ephemeral (the file was just removed) or when no tool ran (an empty trace is noise).
        ...(ephemeral || state.turns.length === 0 ? {} : { runId }),
        ...(memoryNotes.length > 0 ? { memoryNotes } : {}),
        recap: recapFor(recapLine),
        pictures: runPictures(state),
      });
      return usedWeb ? { ...delivered, usedWeb } : delivered;
    } catch (err: unknown) {
      const aborted = controller.signal.aborted;
      const message = aborted
        ? t(strings, 'agent.error.cancelled')
        : agentFailureText(err, strings, command, providerUrl);
      const raw = err instanceof Error ? err.message : String(err);
      const detail = !aborted && raw !== message ? raw : undefined;
      state.status = aborted ? 'cancelled' : 'failed';
      state.error = message;
      // The run file keeps the English the user's sentence replaced, so a copied trace still says why.
      state.errorDetail = detail;
      state.updatedAt = new Date().toISOString();
      await saveRunState(state);
      emit(aborted ? { kind: 'cancelled' } : { kind: 'failed', error: message });
      sendLog(`❌ [Agent] ${message}${detail ? ` — ${detail}` : ''}`);
      return { success: false, error: message };
    } finally {
      releaseFound();
      unregisterRun(runId);
    }
  };

  // One agent run on the stats page, whichever path answered it (the link shortcut included), and
  // every model request inside it — delegated helpers too — attributed to it. A resume is the same
  // run continuing, so only the call that finishes it records an outcome — and a failed run the user
  // resumes was already counted when it failed, so its resume adds nothing.
  //
  // A bot run reads the public web only, the link shortcut included; `isBotRun` as well as the
  // origin, so a bot run's state can never be resumed into the open web by another entry point.
  const run = (taskId?: string): Promise<AgentRunOutcome> => publicWebOnlyIf(origin === 'bot' || isBotRun(state), () => runInMetricDomain('agent', async () => {
    const alreadyCounted = state.metricCounted === true;
    const result = await attempt(taskId);
    const outcome = alreadyCounted ? null : agentRunMetricOutcome(result, state);
    if (outcome) noteRunOutcome('agent', outcome);
    // Only a failure is marked: a finished run cannot be resumed, and an ephemeral one's file is gone.
    if (outcome && outcome !== 'success') {
      state.metricCounted = true;
      await saveRunState(state);
    }
    return result;
  }));

  // Busy from queued to delivered: the answer (or the question) is written into this conversation.
  return busyUntilSettled(state.conversationPath, 'agent', flowManager.enqueueExternalTask(
    `/${command} ${summarizeGoal(goal)}`,
    run,
    (err) => {
      unregisterRun(runId);
      return { success: false, error: agentFailureText(err, strings, command, providerUrl) };
    },
    runId,
  ));
}

/** Where the run's conversation is now, and its id, so a later answer finds it after a move. */
async function adoptRunConversation(state: AgentRunState): Promise<void> {
  if (!state.conversationPath) return;
  const found = await resolveConversationPath({ path: state.conversationPath, id: state.conversationId });
  if (!found) return;
  state.conversationPath = found;
  const id = await conversationIdAt(found);
  if (id) state.conversationId = id;
}

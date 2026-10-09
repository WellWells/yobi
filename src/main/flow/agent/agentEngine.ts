import type {
  SkillType, AgentTraceEvent, AgentTurnRecord, FlowBuildEvent, FlowDefinition,
} from '../../../shared/types';
import { AGENT_ASK_TOOL, isByokTargetUrl } from '../../../shared/types';
import { isDeliverableSkill } from '../../../shared/flowSkillSchema';
import type { ResearchProgress } from '../../../shared/researchProgress';
import { asksForDeepResearch } from '../../../shared/researchIntent';
import type { FlowExecutorDeps } from '../types';
import { FlowAbortError } from '../runtime';
import { sendLog } from '../../helpers';
import { currentScopeTokens } from '../../tokenMeter';
import { askJson, createProviderSession, rejectedReplyPreview } from './structuredLlm';
import type { AskJsonResult, ProviderSession, Validation } from './structuredLlm';
import {
  AGENT_FIELD_DEFAULTS, AGENT_HELP_TOOL, AgentRunError, AgentScopeError, buildToolCatalog, describeToolSpec, FULL_TOOL_SCOPE,
  isHelpTool, OPTS_MARKER, readOnlyScope, scopeHasFlowTools, scopeHasTools, validateAgentAction, validateFinalAnswer,
} from './agentTools';
import type { AgentAction, AgentToolScope, FinalAnswer } from './agentTools';
import {
  applyPlanUpdate, buildActionRepair, buildDeltaPrompt, buildFinishPrompt, buildHeldDelta, buildRepairPrompt,
  RECAP_HOOK, hasRecapSection,
  buildTurnPrompt, emptyPlan, historyThatFits, planComplete, scratchFitFor, SCRATCH_IN_PROMPT,
  SCRATCH_IN_PROMPT_MCP, SCRATCH_IN_PROMPT_MCP_CAPPED, SCRATCH_TOTAL_BUDGET,
  capGoalForProvider, CHANGE_RULES_EST, INSTRUCTION_EST, MAX_SELF_ASSESSED_STEPS, SYNTH_SCRATCH_BUDGET_LEAN,
  SYNTH_SCRATCH_SLOTS_LEAN,
} from './agentPrompts';
import { promptCapFor } from '../../chat/conversationContext';
import type { AgentPlan, HeldFinish, PromptFit, ScratchEntry, TurnPromptOptions } from './agentPrompts';
import { COMPLETE, finishCompletion, synthesisCompletion } from './completion';
import type { AgentCompletion } from '../../../shared/types';
import { agentWorkspaceDir, getAgentFileRoots } from './agentSandbox';
import { maskSecrets } from './secretMask';
import { getProviderLabel } from '../../providers';
import { getMcpRegistry } from '../../mcp';
import {
  buildMcpCatalog, buildMcpIndex, buildMcpSummary, describeMcpServer, describeMcpTool, findMcpServer, hasMcpTools,
  mcpCatalogBudgetChars, MCP_SCRATCH_RESERVE_SLOTS, mcpScratchReserveChars,
  validateMcpAction,
} from './mcpTools';
import type { McpAction } from './mcpTools';
import { NO_WRITES, writesAllFailed } from './writeOutcome';
import type { AgentWriteOutcome } from './writeOutcome';
import type { BuiltinDeps, BuiltinOutcome } from './agentBuiltins';
import type { FlowRef } from '../flowEdit';
import type { RecipientDirectory } from '../../../shared/botRecipients';
import { runCall } from './agentCall';
import type { AgentConfirmRequest, CallContext, ShellConfirmRequest } from './agentCall';
import {
  SHELL_NO_LONGER_ALLOWED, declinedShellObservation, isModelQuestion, isShellApproved, shellApprovalConfig, shellApprovalOf,
} from './shellApproval';
import type { ShellApprovalText } from './shellApproval';
import { batchResource, llmConcurrency, runScheduled, validateBatchAction } from './agentBatch';
import type { BatchAction, BatchCall } from './agentBatch';
import { createLedger } from './evidenceLedger';
import type { ActionRecord, EvidenceSnapshot } from './evidenceLedger';
import type { GoalIntent } from './actionGate';
import { renderActionLines } from './actionOutcome';
import { connectorNotes, renderRuntimeContext, resolveToolContract } from './contractRegistry';

export {
  buildActionRepair, buildDeltaPrompt, buildFinishPrompt, buildTurnPrompt, historyThatFits,
  observationFit, renderScratch, scratchFitFor, SCRATCH_IN_PROMPT, SCRATCH_IN_PROMPT_MCP,
  SCRATCH_TOTAL_BUDGET,
} from './agentPrompts';
export type { AgentPlan, PromptFit, ScratchEntry, TurnPromptOptions } from './agentPrompts';
export { AgentRunError, AgentScopeError, FULL_TOOL_SCOPE, MCP_ONLY_TOOL_SCOPE } from './agentTools';
export type { AgentWriteOutcome } from './writeOutcome';
export type { AgentRunFailure, AgentToolScope } from './agentTools';
export type { McpConfirmRequest } from './mcpAction';
export type { AgentConfirmRequest, ShellConfirmRequest } from './agentCall';

type AgentDecision = AgentAction | McpAction | BatchAction;

/** What one call left behind, before it is filed as a scratch step. */
interface CallResult {
  label: string;
  config: Record<string, string>;
  /** The model's reasoning, carried by the first call of a batch only — the rest share it. */
  thought: string;
  observation: string;
  status: 'ok' | 'error';
  startedAt: number;
  ms: number;
  research?: ResearchProgress;
  /** A shell command that did not run: it waits for the user's answer (`shellApproval`). */
  deferred?: ShellConfirmRequest;
}

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_REASONING_TIMEOUT_MS = 120_000;
/**
 * Sized so a browser run (~10 s per round trip plus the tool call) can reach the self-assessed
 * step ceiling. A soft bound: `runTool`, the turn timeout and synthesis all floor themselves above
 * it, so the true overrun is this plus one synthesis.
 */
const DEFAULT_TOTAL_BUDGET_MS = 30 * 60_000;
const MIN_TURN_BUDGET_MS = 30_000;
/** Total think-time credited back across a whole run, however many confirmations it shows. */
const MAX_CONFIRM_REFUND_MS = 10 * 60_000;
const BYOK_OBSERVATION_LIMIT = 16_000;
const BROWSER_OBSERVATION_LIMIT = 3_500;
const BROWSER_DELTA_OBSERVATION_LIMIT = 24_000;

/**
 * How much of a capped prompt has to survive the instructions and the catalog for the run to be
 * worth making: one full observation, so the model decides the next action having actually read
 * what the last tool returned. Below it the catalog drops to tier-1 briefs
 * (`buildToolCatalog(scope, true)`) rather than the evidence being dropped silently.
 */
const MIN_EVIDENCE_ROOM = BROWSER_OBSERVATION_LIMIT;

/** Whether the provider's cap leaves room for the full tool catalog; BYOK always does. */
export function catalogFitsInFull(providerUrl: string, scope: AgentToolScope): boolean {
  if (isByokTargetUrl(providerUrl)) return true;
  const room = promptCapFor(providerUrl) - INSTRUCTION_EST - MIN_EVIDENCE_ROOM;
  return buildToolCatalog(scope).length <= room;
}
// BYOK re-sends the whole prompt every turn (no delta, no caching), so tokens, not steps, are
// what stops a long BYOK run; sized so a self-assessed 40-step run is not cut off early.
export const AGENT_BYOK_TOKEN_BUDGET = 400_000;
const AGENT_BYOK_TOKEN_CEILING = 600_000;
const SYNTH_MIN_TIMEOUT_MS = 45_000;
const STALL_THRESHOLD = 2;
const MAX_STALE_READS = 2;
/** A run that has asked twice and still cannot proceed should say what is missing, not ask a third time. */
const MAX_ASKS_PER_RUN = 2;
const RUNTIME_CONTEXT_MAX = 600;
/** The headings and fences around the two evidence blocks, charged to the budgets that yield to them. */
const EVIDENCE_HEADING_CHARS = 220;
/**
 * Above this many connected tools, an undeclared run is shown its servers instead of its tools:
 * a per-tool listing scales with what is connected, not with what the goal needs, and squeezes the
 * history and observations. A declared run (the user named the server) always gets its tools.
 */
const MCP_SUMMARY_THRESHOLD = 20;

/**
 * Free `tool_help` look-ups per run: discovery should not cost a step, and the cap stops the
 * model paging through catalogs.
 */
const MAX_HELP_CALLS_PER_RUN = 3;

const SUBTASK_MAX_TURNS = 8;
const SUBTASK_BUDGET_MS = 8 * 60_000;
const PLAN_TURN_BASE = 2;
const PLAN_TURNS_PER_STEP = 2;

/**
 * The floor a plan alone earns. A plan is a checklist capped at 4 items, not a budget, so it only
 * justifies a modest ceiling; a run that needs more says so through `steps_needed`.
 */
export function planTurnCeiling(steps: number): number {
  if (steps <= 0) return DEFAULT_MAX_TURNS;
  return Math.min(MAX_SELF_ASSESSED_STEPS, Math.max(DEFAULT_MAX_TURNS, PLAN_TURN_BASE + PLAN_TURNS_PER_STEP * steps));
}

/**
 * What the run is doing, for a progress line. No "step n of max": the max is a ceiling the run
 * rarely reaches, and "2/8" reads as a plan of eight steps. `server` names the connector a
 * connector call goes to; `tool` is then the connector tool's own id, never shown to the user.
 */
export type AgentProgress =
  | { stage: 'thinking' }
  | { stage: 'tool'; tool: string; server?: string };

export interface AgentRunOptions {
  onProgress?: (progress: AgentProgress) => void;
  onTrace?: (event: AgentTraceEvent) => void;
  /**
   * The flow build's own phases. Separate from `onTrace` because it is the same stream the Flow
   * Builder panel renders — one component draws it in both places rather than two that drift.
   */
  onFlowBuild?: (event: FlowBuildEvent) => void;
  onTurn?: (turn: AgentTurnRecord) => void;
  resumeFrom?: AgentTurnRecord[];
  resumePlan?: AgentPlan;
  conversationPath?: string;
  attachments?: string[];
  signal?: AbortSignal;
  maxTurns?: number;
  totalBudgetMs?: number;
  onConfirm?: (request: AgentConfirmRequest) => Promise<boolean>;
  /**
   * Fired whenever the run's step ceiling changes. Persist it: a resume re-enters `runAgent`
   * from scratch, and without the ceiling a run that self-assessed 30 steps and paused at
   * turn 25 comes back against the default 8 — the loop body never runs and it drops straight
   * into synthesis with whatever the last few observations were.
   */
  onStepBudget?: (maxTurns: number) => void;
  onSaveFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  /** Saves a changed flow over the saved one with the same id — what `edit_flow` writes through. */
  onReplaceFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  /** The saved flows `edit_flow` chooses among. */
  listFlows?: () => readonly FlowDefinition[];
  /** Flows earlier runs of this conversation made or changed, oldest first. */
  conversationFlows?: readonly FlowRef[];
  /** The paired chats a bot step can reach; read live when omitted. */
  recipients?: RecipientDirectory;
  /**
   * Disclose only these MCP servers. This is what a connector command (`/notion`) sets, and what
   * the conversation keeps disclosing afterwards. It is a DISCLOSURE, not a restriction: the run
   * keeps its built-in tools and the prompt says the user named these servers, so the model can
   * judge whether one of them actually fits the request.
   *
   * Never pass an empty array — it filters every server out and, with built-in tools still in
   * scope, produces a silent zero-connector run instead of an error. Pass undefined instead.
   */
  mcpServerIds?: readonly string[];
  /**
   * A RESTRICTION, unlike `mcpServerIds`: this run reaches no MCP server at all — no catalog, no
   * `call_mcp`, and the same for any helper it delegates to. Decided by the caller (a bot requester
   * who is not the user's own account in a private chat), never by the model.
   */
  noConnectors?: boolean;
  /**
   * A RESTRICTION too: only these MCP servers exist for this run (and any helper it delegates to).
   * Unlike `mcpServerIds` it declares nothing — the catalog stays the undeclared one and a server
   * that is not connected is simply absent, not an error. Set by the caller from a bot account's
   * per-connector grants, never by the model. An empty list reaches no server.
   */
  allowedMcpServerIds?: readonly string[];
  toolScope?: AgentToolScope;
  /**
   * A delegated helper: read-only tools, no questions, no further delegation. Every change stays
   * with the run the user is watching, behind its gate and its confirmations.
   */
  readOnly?: boolean;
  /** What earlier runs in this conversation read and changed, so this run checks instead of trusting prose. */
  priorEvidence?: EvidenceSnapshot;
  /** The intent a paused run had declared; its first action after resuming may restate it. */
  intent?: GoalIntent;
  onIntent?: (intent: GoalIntent) => void;
  runId?: string;
  /**
   * Nobody is watching this run (a bot message). Changes that are normally trusted to the review
   * window they open still go through confirmation, which an unattended run can only refuse.
   */
  unattended?: boolean;
  /**
   * Set only for a bot run whose account holds the shell grant, with the question's words in the
   * user's language. Nobody is at the desk to answer a dialog, so a shell call pauses the run with
   * this question instead, and the command it shows — never one written after the answer — runs
   * when the user approves it.
   */
  shellApproval?: (request: ShellConfirmRequest) => ShellApprovalText;
  /**
   * The user's saved memory and the rule for changing it, pre-rendered by the caller that decided
   * this run may use it. A helper never gets it: it cannot answer the user, so it has nothing to
   * remember and no reason to see what the user told Yobi about themself.
   */
  userMemory?: string;
  /**
   * The chat's recap rule (and the current recap), pre-rendered by a caller that keeps one. Rides
   * with the memory block — same place in the prompt, same actual-length reserve — and, like it,
   * never reaches a helper, whose text is not an answer.
   */
  recapRule?: string;
  /**
   * The user's answer preferences (tone, length, and for the user themself the nickname and custom
   * instructions), pre-rendered by the caller. Shares the memory block's slot and reserve; a helper
   * never gets it, since its text is an observation, not the answer.
   */
  answerPrefs?: string;
}

interface RunEvidence {
  /** The changes this run proposed, with what became of each. */
  actions: ActionRecord[];
  evidence: EvidenceSnapshot;
}

export type AgentRunResult =
  | ({
    kind: 'answer'; title: string; answer: string; toolCalls: number; turns: number; writes: AgentWriteOutcome;
    /** Whether the answer covers the whole goal — decided by the model's own claim and how the run ended. */
    completion: AgentCompletion;
  } & RunEvidence)
  | ({ kind: 'question'; question: string; choices?: string[]; toolCalls: number; turns: number } & RunEvidence);

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`;
}

interface PlannedCall {
  label: string;
  config: Record<string, string>;
}

/**
 * `deepResearch`: the user's own words asked for depth, so every research call of this run is
 * standard whatever the model wrote.
 */
function planCall(action: BatchCall, providerUrl: string, deepResearch: boolean): PlannedCall {
  if (action.action === 'call_mcp') {
    return {
      label: `mcp:${action.name}`,
      config: { server: action.server, arguments: JSON.stringify(action.arguments) },
    };
  }
  const config = action.config ?? {};
  const tool = action.tool as SkillType;
  if ((tool === 'llm' || tool === 'research') && !(config.provider ?? '').trim()) {
    config.provider = providerUrl;
  }
  for (const [key, value] of Object.entries(AGENT_FIELD_DEFAULTS[tool] ?? {})) {
    if (!(config[key] ?? '').trim()) config[key] = value;
  }
  if (tool === 'research' && deepResearch) config.depth = 'standard';
  return { label: tool, config };
}

export function callSignature(tool: string, config: Record<string, string>): string {
  const parts = Object.entries(config)
    .map(([key, value]) => [key, (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()] as const)
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`);
  return JSON.stringify([tool.toLowerCase(), ...parts]);
}

export function repeatObservation(tool: string, step: number): string {
  return [
    `ERROR: You already called ${tool} with these exact arguments in step ${step} —`,
    'its result is in the steps above and calling it again cannot change it.',
    'Do not repeat a call: change the arguments substantially, use a different tool, or finish',
    'with what you already have.',
  ].join(' ');
}

async function synthesizeFinal(
  goal: string,
  scratch: ScratchEntry[],
  providerUrl: string,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  lean: boolean,
  scratchSlots: number,
  session: ProviderSession,
  history: string,
  plan: AgentPlan,
  noWriteLanded: boolean,
  actions: string,
  userMemory: string,
  signal?: AbortSignal,
): Promise<FinalAnswer> {
  const ceiling = lean ? SYNTH_SCRATCH_BUDGET_LEAN : SCRATCH_TOTAL_BUDGET;
  const assemble = (over: { history?: string; scratch?: ScratchEntry[]; fit?: PromptFit } = {}): string =>
    buildFinishPrompt({
      goal,
      scratch: over.scratch ?? scratch,
      lean,
      scratchSlots: lean ? Math.max(scratchSlots, SYNTH_SCRATCH_SLOTS_LEAN) : scratchSlots,
      totalBudget: ceiling,
      history: over.history ?? '',
      plan,
      writesAllFailed: noWriteLanded,
      actions,
      userMemory,
      ...(over.fit ? { scratchFit: over.fit } : {}),
    });
  // History first, then the observations against whatever the history decision left — the same
  // order the turn prompt uses, so the two cannot disagree about who yields to whom.
  const assembleFinish = (h: string): string => assemble({ history: h });
  const finishHistory = historyThatFits(assembleFinish, history, providerUrl);
  const fitFor = (wrap: (prompt: string) => string, h: string): PromptFit =>
    scratchFitFor(providerUrl, wrap(assemble({ history: h, scratch: [] })), ceiling);

  const result = await askJson<FinalAnswer>({
    basePrompt: assemble({ history: finishHistory, fit: fitFor((prompt) => prompt, finishHistory) }),
    session,
    providerUrl,
    deps,
    timeoutMs,
    validate: validateFinalAnswer,
    buildRepair: (prevRaw, error) => {
      const wrap = (prompt: string): string => buildRepairPrompt(prevRaw, error, prompt);
      const build = (h: string): string => wrap(assemble({ history: h }));
      const h = historyThatFits(build, history, providerUrl);
      return wrap(assemble({ history: h, fit: fitFor(wrap, h) }));
    },
    signal,
  });
  if (!result.ok || !result.value) {
    throw new AgentRunError(
      result.reason ?? 'invalid_output',
      result.error ?? 'The agent could not synthesize a valid answer',
    );
  }
  return result.value;
}

export async function runAgent(
  goal: string,
  providerUrl: string,
  deps: FlowExecutorDeps,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) throw new Error('Empty goal');

  const pinnedMaxTurns = options.maxTurns === undefined ? undefined : Math.max(1, options.maxTurns);
  let maxTurns = pinnedMaxTurns ?? DEFAULT_MAX_TURNS;
  const readOnly = options.readOnly === true;
  const baseScope = options.toolScope ?? FULL_TOOL_SCOPE;
  // A helper never delegates again.
  const toolScope: AgentToolScope = readOnly
    ? readOnlyScope(baseScope)
    : { ...baseScope, delegate: baseScope.builtins };
  const catalog = buildToolCatalog(toolScope, !catalogFitsInFull(providerUrl, toolScope));
  // The web switch off removes these from the catalog; the prose and the worked examples follow it.
  const webTools = toolScope.skills.includes('research');
  // The answer preferences and the recap rule share the memory block's slot: all shape the final
  // answer, and the reserve below charges whatever is really sent.
  const userMemory = readOnly
    ? ''
    : [options.answerPrefs, options.userMemory, options.recapRule]
      .map((block) => (block ?? '').trim()).filter(Boolean).join('\n');
  const recapHook = hasRecapSection(userMemory);
  // Capped once, here, so every budget computed below sees the length that will really be sent;
  // everything else competing for a capped prompt yields to the cap.
  const promptGoal = capGoalForProvider(providerUrl, trimmedGoal, buildTurnPrompt({
    goal: '', catalog, scratch: [], mustFinish: false, lean: isByokTargetUrl(providerUrl), allowAsk: true,
    // Measured WITH the own-data rule although the MCP index is not built yet: the baseline may
    // never come out shorter than the prompt this run really sends, or the goal is handed room the
    // provider's cap does not have and the tail — the action instruction — comes off the end.
    userDataSources: true,
    userMemory,
    // Same reason: a run the user watches may be shown the batch shape, so the baseline carries it.
    batchGrammar: !readOnly,
  }));
  const fileRoots = await getAgentFileRoots();
  const workspaceDir = await agentWorkspaceDir();
  const lean = isByokTargetUrl(providerUrl);
  const providerLabel = getProviderLabel(providerUrl);
  const observationLimit = lean ? BYOK_OBSERVATION_LIMIT : BROWSER_OBSERVATION_LIMIT;
  const deltaObservationLimit = lean ? BYOK_OBSERVATION_LIMIT : BROWSER_DELTA_OBSERVATION_LIMIT;

  const mcpRegistry = getMcpRegistry();
  const scopedIds = options.mcpServerIds;
  // Filter BEFORE buildMcpIndex: handles are slugified with -2/-3 collision suffixes, so filtering
  // afterwards can leave a `notion-2` with no `notion` and a validator error listing a phantom set.
  const noConnectors = options.noConnectors === true;
  const allowedIds = options.allowedMcpServerIds;
  const mcpServers = (noConnectors ? [] : mcpRegistry?.getAgentTools() ?? [])
    .filter((server) => !allowedIds || allowedIds.includes(server.serverId))
    .filter((server) => !scopedIds || scopedIds.includes(server.serverId))
    // A helper is shown the reads only, so a change is not even a shape it can propose.
    .map((server) => (readOnly
      ? { ...server, tools: server.tools.filter((tool) => resolveToolContract(server.serverId, tool).risk({}) === 'read') }
      : server));
  const mcpIndex = buildMcpIndex(mcpServers);
  const mcpCandidate = mcpRegistry !== null && hasMcpTools(mcpIndex);
  const toolsOnly = scopeHasTools(toolScope);
  // Declared = the user named these connectors themselves (a `/notion`-style disclosure that then
  // sticks to the conversation), as opposed to plain `/agent` sweeping up everything connected.
  const declared = (scopedIds?.length ?? 0) > 0;
  // Read off the index, not the scope: an undeclared `/agent` run sweeps up every connected server,
  // and those are exactly the runs where nothing else tells the model its own data is reachable.
  const userDataSources = mcpIndex.handles.some((server) => server.userData);
  // A declared connector that cannot answer is an error even though the run has other tools to
  // fall back on. Falling back silently would let the user watch the agent solve their Notion
  // question by searching the web, with nothing anywhere saying Notion was never reachable.
  if (!mcpCandidate && (!toolsOnly || declared)) {
    throw new AgentScopeError('not-connected');
  }
  const mcpScratchSlots = lean ? SCRATCH_IN_PROMPT_MCP : SCRATCH_IN_PROMPT_MCP_CAPPED;

  // What the user said is the one source a gate may treat as the user's own words; the answers to
  // earlier questions in this run count, the model's prose about them does not. Approving a shell
  // command is not one of them: "1. Run" says nothing about what else the user wants done.
  const askAnswers = (options.resumeFrom ?? [])
    .filter((entry) => isModelQuestion(entry) && entry.observation)
    .map((entry) => entry.observation);
  const runWords = [trimmedGoal, ...askAnswers].join('\n');
  // A helper's goal is the model's own wording, so it never decides depth on the user's behalf.
  const deepResearch = !readOnly && asksForDeepResearch(runWords);
  const ledger = createLedger(runWords, options.priorEvidence);
  const evidenceOut = (): RunEvidence => ({ actions: [...ledger.actions], evidence: ledger.snapshot(true) });
  const earlierActions = readOnly ? '' : renderActionLines(ledger.priorActions);
  const changeTools = !readOnly && mcpCandidate && mcpIndex.handles
    .some((server) => server.tools.some((tool) => resolveToolContract(server.serverId, tool).risk({}) !== 'read'));
  // The notes explain the change tools; a helper is shown none, so they would only name tools it lacks.
  const notes = mcpCandidate && !readOnly ? connectorNotes(mcpIndex.handles).join('\n') : '';
  // Charged like the goal: these blocks sit in every turn prompt and none can be trimmed later. The
  // memory is its real length, not an estimate — it is known before the first turn and never grows.
  const evidenceReserve = (earlierActions ? earlierActions.length + EVIDENCE_HEADING_CHARS : 0)
    + (changeTools ? CHANGE_RULES_EST + RUNTIME_CONTEXT_MAX + EVIDENCE_HEADING_CHARS : 0)
    + (userMemory ? userMemory.length + 2 : 0)
    // The recap reminder repeated where the finish shape is described, charged like its section.
    + (recapHook ? RECAP_HOOK.length + 4 : 0);

  const { buildAgentHistory, historyPromptCost, MCP_CATALOG_RESERVE } = await import('./agentContext');
  // A scoped run drops the built-in catalog to buy connector room, so history is charged the
  // UNSCOPED length: both budgets subtract catalogLen, and handing history the zero would let it
  // spend the reclaimed chars before the MCP budget could.
  const historyCatalogLen = toolsOnly ? catalog.length : buildToolCatalog(FULL_TOOL_SCOPE).length;
  const history = await buildAgentHistory({
    ...(options.conversationPath ? { conversationPath: options.conversationPath } : {}),
    providerUrl,
    catalogLen: historyCatalogLen,
    goalLen: promptGoal.length + evidenceReserve,
    // The reserve, not the window: `renderScratch` prints the last `mcpScratchSlots`
    // observations, but a browser run sends the full prompt only on turn 1 (empty scratchpad)
    // and on a thread-loss rebuild; every other turn is a delta carrying one observation.
    mcpReserve: mcpCandidate
      ? mcpScratchReserveChars(MCP_SCRATCH_RESERVE_SLOTS, observationLimit) + MCP_CATALOG_RESERVE
      : 0,
  });
  const historyCost = historyPromptCost(history, providerUrl);

  // Both budgets must charge the SAME reserve as the history above. Whichever is computed second
  // is otherwise handed a negative and drops silently to zero — and for the MCP catalog that
  // means every connector disappearing from the prompt with nothing reporting it.
  const mcpBudget = mcpCandidate
    ? mcpCatalogBudgetChars(providerUrl, catalog.length, promptGoal.length + evidenceReserve, MCP_SCRATCH_RESERVE_SLOTS, observationLimit, historyCost)
    : 0;
  // The heading says the connectors were declared, because that is the whole signal the user is
  // sending: they are not ordering a tool call, they are telling the model which servers are on
  // the table and leaving the judgement of whether to use one to the model.
  const mcpHeading = declared
    ? 'MCP TOOLS — the user connected these servers for this conversation, so prefer one of them when it fits the request; if none fits, use your other tools. Call with "call_mcp":'
    : mcpIndex.handles.length === 1 && !toolsOnly
      ? 'MCP TOOLS (every tool below belongs to your connected server; call with "call_mcp"):'
      : 'MCP TOOLS (external tools from your connected servers; call with "call_mcp"):';
  // Every string that tells the model to call `tool_help` has to know whether this run has it:
  // MCP_ONLY_TOOL_SCOPE — what a connector slash-command gets — sets `help: false`, and an
  // instruction to call a tool it was never offered reads as a working escape hatch right up
  // until the validator rejects it.
  const canHelp = toolScope.help;
  const mcpBriefFooter = canHelp
    ? `A line marked ${OPTS_MARKER} lists only its REQUIRED arguments; call "${AGENT_HELP_TOOL}" with "<server>:<tool>" for that tool's full entry and input schema.`
    : `A line marked ${OPTS_MARKER} lists only its REQUIRED arguments.`;
  const mcpToolTotal = mcpIndex.handles.reduce((sum, server) => sum + server.tools.length, 0);
  // `canHelp` is not a preference here, it is the way back: a handle only becomes a tool list
  // through `tool_help`, so without it a summary shows the model doors and no keys.
  const summarise = mcpCandidate && !declared && canHelp && mcpToolTotal > MCP_SUMMARY_THRESHOLD;
  const mcpSectionHeading = summarise
    ? `MCP TOOLS (your connected servers — open one with "${AGENT_HELP_TOOL}", then call with "call_mcp"):`
    : mcpHeading;
  const mcpSectionFooter = summarise ? '' : mcpBriefFooter;
  // The heading and footer are charged here, not left to SAFETY_MARGIN: the heading is long
  // enough to matter.
  const mcpOverhead = mcpSectionHeading.length + mcpSectionFooter.length + 2 + (notes ? notes.length + 1 : 0);
  const summaryText = summarise ? buildMcpSummary(mcpIndex, canHelp) : '';
  // A summary is not an omission: every tool behind these handles stays reachable through
  // `tool_help`, and `resolveMcpTool` matches the runtime index rather than the rendered text.
  const mcpSection = summarise
    ? mcpBudget > mcpOverhead + summaryText.length
      ? { text: summaryText, includedCount: mcpToolTotal, omitted: 0, brief: false }
      : { text: '', includedCount: 0, omitted: 0, brief: false }
    : mcpBudget > mcpOverhead
      ? buildMcpCatalog(mcpIndex, mcpBudget - mcpOverhead, canHelp)
      : { text: '', includedCount: 0, omitted: 0, brief: false };
  const mcpEnabled = mcpSection.includedCount > 0;
  if (summarise && mcpEnabled) {
    sendLog(`🗂️ [Agent] ${mcpIndex.handles.length} connector(s) summarised — ${mcpToolTotal} tool(s) behind "${AGENT_HELP_TOOL}"`);
  }
  if (mcpCandidate && !mcpEnabled) {
    const total = mcpIndex.handles.reduce((sum, server) => sum + server.tools.length, 0);
    sendLog(`⚠️ [Agent] ${total} MCP tool(s) hidden — ${providerLabel}'s input limit leaves no room for the catalog`);
  } else if (mcpEnabled && mcpSection.omitted > 0) {
    sendLog(`⚠️ [Agent] ${mcpSection.omitted} MCP tool(s) omitted — ${providerLabel}'s input limit fits only ${mcpSection.includedCount}`);
  }
  if (!mcpEnabled && (!toolsOnly || declared)) throw new AgentScopeError('no-room');
  const catalogForPrompt = mcpEnabled
    ? [
        ...(toolsOnly ? [catalog, ''] : []),
        mcpSectionHeading,
        mcpSection.text,
        ...(mcpSection.brief ? [mcpSectionFooter] : []),
        ...(notes ? [notes] : []),
      ].join('\n')
    : catalog;
  const scratchSlots = mcpEnabled ? mcpScratchSlots : SCRATCH_IN_PROMPT;
  // Offered to the run the user is watching, never to a helper: fan-out below fan-out multiplies
  // every rate limit, and a helper exists to do one reading job.
  const batchGrammar = !readOnly && (toolsOnly || mcpEnabled);
  const validateDecision = (allowAsk: boolean) => (json: unknown): Validation<AgentDecision> => {
    const obj = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : null;
    if (batchGrammar && obj?.action === 'call_tools') {
      return validateBatchAction(obj, { scope: toolScope, mcpIndex: mcpEnabled ? mcpIndex : null });
    }
    if (mcpEnabled && obj?.action === 'call_mcp') return validateMcpAction(obj, mcpIndex);
    return validateAgentAction(json, allowAsk, toolScope, [...deliverables.keys()], batchGrammar);
  };

  const reasoningTimeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_REASONING_TIMEOUT_MS;
  const budgetMs = Math.max(MIN_TURN_BUDGET_MS, options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS);
  const startedAt = Date.now();
  // Time spent waiting for the USER is not time the agent spent working. Without this, clicking
  // Allow on a shell confirmation can immediately trip `mustFinish` on the turn it approved.
  let pausedMs = 0;
  const remainingMs = (): number => budgetMs - (Date.now() - startedAt - pausedMs);
  const askUser = async (request: AgentConfirmRequest): Promise<boolean> => {
    if (!options.onConfirm) return false;
    // Every confirmation, not only a connector's: the bubble must say the run is waiting on the user.
    options.onTrace?.({ kind: 'stage', turn: activeStep, label: 'confirming' });
    const at = Date.now();
    try {
      return await options.onConfirm(request);
    } finally {
      // Capped, because a refund cannot tell "the user was thinking" from "nobody was there": each
      // unanswered dialog denies itself after 10 minutes, and uncapped refunds let an abandoned run
      // hold the external queue slot indefinitely.
      pausedMs = Math.min(MAX_CONFIRM_REFUND_MS, pausedMs + (Date.now() - at));
    }
  };
  const scratch: ScratchEntry[] = (options.resumeFrom ?? []).map((entry) => ({
    thought: entry.thought,
    tool: entry.tool,
    config: entry.config,
    observation: entry.observation,
  }));
  const signatures = new Map<string, number>();
  /** Reads made since the last change landed, connector reads from a resumed run included. */
  const readsBeforeChange = new Set<string>();
  (options.resumeFrom ?? []).forEach((entry, index) => {
    if (entry.status === 'ok') signatures.set(callSignature(entry.tool, entry.config), index + 1);
  });
  for (const entry of options.resumeFrom ?? []) {
    if (entry.status !== 'ok' || entry.tool === AGENT_ASK_TOOL) continue;
    ledger.addObservation(`${JSON.stringify(entry.config)}\n${entry.observation}`);
    const handle = entry.tool.startsWith('mcp:') ? mcpIndex.byHandle.get(entry.config.server ?? '') : undefined;
    const tool = handle?.tools.find((candidate) => candidate.name === entry.tool.slice('mcp:'.length));
    if (!handle || !tool) continue;
    try {
      const args = JSON.parse(entry.config.arguments ?? '{}') as Record<string, unknown>;
      const contract = resolveToolContract(handle.serverId, tool);
      ledger.add(contract.extractFacts?.(args, entry.observation) ?? []);
      // A fetch before the question is what checks a change made after the answer.
      if (contract.risk(args) === 'read') readsBeforeChange.add(callSignature(entry.tool, entry.config));
    } catch {
      // A resumed step whose arguments no longer parse contributes its text, not its facts.
    }
  }
  /**
   * Step number → the FULL observation of a step that already holds a finished answer.
   *
   * Full, not the truncated copy the prompt showed: the model judges deliverability from what it
   * can see, but what the user receives should be the whole cited answer `research` produced.
   * Resumed steps are absent on purpose — their untruncated text did not survive the pause.
   */
  const deliverables = new Map<number, string>();
  /**
   * The step whose trace row a confirmation or a flow build reports on. Only calls that run alone
   * can confirm or build — a batch holds reads — so one variable is enough.
   */
  let activeStep = 0;
  let intent: GoalIntent | null = options.intent ?? null;
  let intentOpen = true;
  const gate = { blocked: 0, autoContext: 0 };

  /**
   * The main agent hands a reading job to a helper with a clean context, and gets back findings
   * plus the evidence the helper actually read — so an id the helper found satisfies this run's
   * gate, but nothing the helper merely wrote does.
   */
  const runSubtask = async (task: string, step: number): Promise<BuiltinOutcome> => {
    const used: string[] = [];
    try {
      const helper = await runAgent(task, providerUrl, deps, {
        readOnly: true,
        maxTurns: SUBTASK_MAX_TURNS,
        totalBudgetMs: Math.max(MIN_TURN_BUDGET_MS, Math.min(remainingMs(), SUBTASK_BUDGET_MS)),
        toolScope: baseScope,
        ...(scopedIds ? { mcpServerIds: scopedIds } : {}),
        ...(noConnectors ? { noConnectors } : {}),
        ...(allowedIds ? { allowedMcpServerIds: allowedIds } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onTrace: (event) => {
          if (event.kind !== 'tool') return;
          used.push(event.tool);
          options.onTrace?.({ kind: 'stage', turn: step, label: 'delegating', detail: event.tool });
        },
      });
      ledger.absorb(helper.evidence);
      if (helper.kind !== 'answer') return { observation: 'ERROR: The helper stopped without findings.', status: 'error' };
      sendLog(`🤝 [Agent] helper finished after ${helper.toolCalls} tool call(s)`);
      const tools = used.length > 0 ? ` (read with: ${[...new Set(used)].join(', ')})` : '';
      // Said by the code, not left to the helper's prose: a helper cut off by its 8 turns writes a
      // confident summary like any other, and the main run would build on it as the whole picture.
      const gap = helper.completion.status === 'partial'
        ? `\nINCOMPLETE — ${helper.completion.missing ?? 'the helper stopped at its step limit'}.`
        : '';
      return { observation: `Helper findings${tools}:\n${helper.title ? `${helper.title}\n` : ''}${helper.answer}${gap}`, status: 'ok' };
    } catch (err) {
      if (err instanceof FlowAbortError) throw err;
      return { observation: `ERROR: The helper failed: ${err instanceof Error ? err.message : String(err)}`, status: 'error' };
    }
  };

  const builtinCtx: BuiltinDeps = {
    deps,
    providerUrl,
    assessed: null,
    remainingMs,
    // `activeStep` is read at call time, not captured: the context outlives any one call.
    onStage: (label, detail) => options.onTrace?.({
      kind: 'stage', turn: activeStep, label, ...(detail ? { detail } : {}),
    }),
    ...(options.onFlowBuild ? { onBuild: options.onFlowBuild } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onSaveFlow ? { saveFlow: options.onSaveFlow } : {}),
    ...(options.onReplaceFlow ? { replaceFlow: options.onReplaceFlow } : {}),
    ...(options.listFlows ? { listFlows: options.listFlows } : {}),
    ...(options.recipients ? { recipients: options.recipients } : {}),
    recentFlows: [...(options.conversationFlows ?? [])],
    // This run's words only. The ledger also holds every earlier prompt of the conversation, and
    // a "tell me…" three questions ago is not the user saying this flow is for them.
    userWords: () => runWords,
    // Through `askUser`, like the other two confirm sites — otherwise the time a user spends
    // reading a generated flow is the only think-time still billed to the agent's wall clock.
    ...(options.onConfirm ? { confirm: askUser } : {}),
    ...(toolScope.delegate ? { runSubtask } : {}),
  };
  const callCtx: CallContext = {
    deps,
    mcpIndex,
    mcpRegistry,
    ledger,
    runId: options.runId ?? '',
    intent: () => intent,
    askAnswers,
    gate,
    unattended: options.unattended === true,
    askUser,
    ...(options.shellApproval ? { deferShell: true } : {}),
    builtins: builtinCtx,
    fileRoots,
    workspaceDir,
    remainingMs,
    ...(options.onTrace ? { onTrace: options.onTrace } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  let lastRawDecision = '';
  let staleReads = 0;
  let budgetSettled = false;

  let toolCalls = scratch.length;
  let helpCalls = 0;
  let consecutiveErrors = 0;
  /**
   * The last observation did not fit its slot. The model cannot see this for itself — the cut
   * happens after it chose what to read — so the run would otherwise keep reading pages into a
   * prompt that is already dropping them. Recomputed every turn, never latched: the hint has to
   * stop being true the moment it stops being true.
   */
  let observationCut = false;
  /**
   * A `finish` whose own `done` said the goal is not achieved, sent back once for another try while
   * steps remain. `pending` is true for the single turn that has to be told so; `steps` is the
   * scratch length at the hold, so a run that gathers nothing more delivers this answer as it was
   * instead of paying a synthesis round trip to rewrite it from the same evidence.
   */
  let heldFinish: { title: string; content: string; missing: string; steps: number; pending: boolean } | null = null;
  const plan: AgentPlan = emptyPlan();
  if (options.resumePlan) applyPlanUpdate(plan, options.resumePlan.steps, options.resumePlan.done);
  const session = createProviderSession(lean ? undefined : options.attachments);
  let budgetWarned = false;
  const spentTokens = (): number | null => {
    if (!lean) return null;
    const spent = currentScopeTokens();
    return spent ? spent.input + spent.output : null;
  };
  const overTokenBudget = (): boolean => {
    const total = spentTokens();
    if (total === null || total < AGENT_BYOK_TOKEN_BUDGET) return false;
    if (!budgetWarned) {
      budgetWarned = true;
      sendLog(`⚠️ /agent reached its ${AGENT_BYOK_TOKEN_BUDGET} token budget (${total} spent) — answering with what it has`);
    }
    return true;
  };
  const overTokenCeiling = (): boolean => {
    const total = spentTokens();
    return total !== null && total >= AGENT_BYOK_TOKEN_CEILING;
  };

  const writes: AgentWriteOutcome = { ...NO_WRITES };
  /** How many scratch entries the previous turn added: one call, or a whole batch for the delta. */
  let lastBatchSize = 1;
  /**
   * A TURN is one decision by the model; a STEP is one scratch entry. A batch makes one turn several
   * steps, so the step ceiling counts turns while everything the model or the UI numbers counts
   * steps. Old records carry no `turn` and were written one step per turn, so their index is it.
   */
  const resumedTurns = (options.resumeFrom ?? []).reduce((max, entry) => Math.max(max, entry.turn ?? entry.index), 0);
  let turnsUsed = resumedTurns;
  const answered = (title: string, answer: string, turns: number, completion: AgentCompletion): AgentRunResult => {
    if (completion.status === 'partial') {
      sendLog(`🏁 [Agent] answered as partial (${completion.reason})${completion.missing ? ` — missing: ${completion.missing}` : ''}`);
    }
    return { kind: 'answer', title, answer, toolCalls, turns, writes, completion, ...evidenceOut() };
  };

  // A shell command put to the user in the chat runs here, before the model is asked anything:
  // the answer approved the string stored on the question, and that string is the one that runs.
  const lastResumed = scratch[scratch.length - 1];
  const pendingShell = lastResumed?.observation ? shellApprovalOf(lastResumed) : null;
  if (lastResumed && pendingShell) {
    if (!isShellApproved(lastResumed)) {
      sendLog('🔒 [Agent] the user did not approve the shell command');
      lastResumed.observation = declinedShellObservation(lastResumed.observation);
    } else if (!toolScope.skills.includes('shell')) {
      sendLog('🔒 [Agent] an approved shell command did not run: shell is no longer in this run\'s scope');
      lastResumed.observation = `${lastResumed.observation}\n${SHELL_NO_LONGER_ALLOWED}`;
    } else {
      const step = scratch.length + 1;
      activeStep = step;
      const config = { command: pendingShell.command, ...(pendingShell.shell ? { shell: pendingShell.shell } : {}) };
      const signature = callSignature('shell', config);
      const startedAt = Date.now();
      toolCalls++;
      options.onProgress?.({ stage: 'tool', tool: 'shell' });
      options.onTrace?.({ kind: 'tool', turn: step, tool: 'shell', config });
      sendLog(`🤖 [Agent] running the approved shell command ${maskSecrets(JSON.stringify(config), true)}`);
      // The answer was the approval, so nothing is asked again. A run resumed on the desktop has
      // no chat question behind it in this sense: it gets the dialog, as any shell call there does.
      const approvedCtx: CallContext = options.shellApproval
        ? { ...callCtx, deferShell: false, askUser: async () => true }
        : callCtx;
      const result = await runCall(approvedCtx, { thought: '', action: 'call_tool', tool: 'shell', config }, config, step, signature);
      if (result.write) {
        writes.attempted += 1;
        if (result.landed) writes.succeeded += 1;
      }
      if (result.status === 'ok') signatures.set(signature, step);
      options.onTrace?.({ kind: 'observation', turn: step, tool: 'shell', status: result.status, preview: truncate(result.observation, 200) });
      const stored = truncate(result.observation, observationLimit);
      const forDelta = truncate(result.observation, deltaObservationLimit);
      scratch.push({ thought: '', tool: 'shell', config, observation: stored, ...(forDelta === stored ? {} : { deltaObservation: forDelta }) });
      options.onTurn?.({
        index: step,
        turn: resumedTurns,
        thought: '',
        tool: 'shell',
        config,
        observation: stored,
        status: result.status,
        at: new Date(startedAt).toISOString(),
        toolMs: Date.now() - startedAt,
      });
    }
  }

  for (let turn = resumedTurns + 1; turn <= maxTurns; turn++) {
    const nextStep = scratch.length + 1;
    activeStep = nextStep;
    if (options.signal?.aborted) throw new FlowAbortError();
    if (remainingMs() <= 0) break;
    if (scratch.length > 0 && overTokenCeiling()) break;

    const mustFinish = turn === maxTurns || remainingMs() < MIN_TURN_BUDGET_MS || overTokenBudget();
    const canAsk = !mustFinish && !readOnly
      && scratch.filter(isModelQuestion).length < MAX_ASKS_PER_RUN;
    const turnTimeoutMs = Math.max(10_000, Math.min(reasoningTimeoutMs, remainingMs()));
    const held: HeldFinish | undefined = heldFinish?.pending && !mustFinish
      ? { missing: heldFinish.missing, stepsLeft: maxTurns - turn + 1, ...(summarise && mcpEnabled ? { connectorHelp: true } : {}) }
      : undefined;
    const turnOptions: TurnPromptOptions = {
      goal: promptGoal,
      catalog: catalogForPrompt,
      scratch,
      mustFinish,
      lean,
      mcpGrammar: mcpEnabled,
      toolGrammar: toolsOnly,
      ...(mcpIndex.handles[0] ? { mcpExampleServer: mcpIndex.handles[0].handle } : {}),
      scratchSlots,
      stalled: consecutiveErrors >= STALL_THRESHOLD,
      // Only worth saying when there is somewhere to put the work: pointing at `delegate` in a
      // run that cannot call it is an instruction the validator will reject.
      offload: observationCut && toolScope.delegate === true,
      allowAsk: canAsk,
      changeRules: mcpEnabled && changeTools,
      runtimeContext: changeTools ? renderRuntimeContext(ledger, RUNTIME_CONTEXT_MAX) : '',
      earlierActions,
      writesAllFailed: writesAllFailed(writes),
      userDataSources: mcpEnabled && userDataSources,
      plan,
      deliverable: [...deliverables.keys()],
      userMemory,
      batchGrammar,
      flowTools: scopeHasFlowTools(toolScope),
      webTools,
      ...(held ? { held } : {}),
    };
    const buildTurn = (h: string): string => buildTurnPrompt({ ...turnOptions, history: h });
    const turnHistory = historyThatFits(buildTurn, history, providerUrl);
    // Fit the observations to what the cap has left AFTER the history decision above. They are
    // the only block that grows every turn, so they are the only one that can walk a prompt
    // that fitted on turn 1 off the end of the cap by turn 4.
    const scratchFit = scratchFitFor(providerUrl, buildTurnPrompt({ ...turnOptions, scratch: [], history: turnHistory }));
    const basePrompt = buildTurnPrompt({ ...turnOptions, history: turnHistory, scratchFit });
    const previous = scratch.slice(-Math.min(lastBatchSize, scratch.length));
    // After a hold the live thread has already read the last observations — its reply to them was
    // the finish that was held — so it is sent the notice alone, not those observations again.
    const sessionPrompt: string | undefined = held
      ? buildHeldDelta(held, canAsk, plan, writesAllFailed(writes), recapHook)
      : previous.length > 0
        ? buildDeltaPrompt(previous, scratch.length, mustFinish, turnOptions.stalled, plan, writesAllFailed(writes), providerUrl, recapHook)
        : undefined;
    options.onProgress?.({ stage: 'thinking' });
    options.onTrace?.({ kind: 'thinking', turn: nextStep, provider: providerLabel });

    const decisionStartedAt = Date.now();
    const decision: AskJsonResult<AgentDecision> = await askJson<AgentDecision>({
      basePrompt,
      sessionPrompt,
      session,
      providerUrl,
      deps,
      timeoutMs: turnTimeoutMs,
      validate: validateDecision(canAsk),
      buildRepair: buildActionRepair({ ...turnOptions, history }, providerUrl),
      onReject: (error, attempt, preview) => {
        sendLog(`↻ [Agent] turn ${turn}: response rejected (${error}) — asking again (${attempt}); reply: "${preview}"`);
        options.onTrace?.({ kind: 'stage', turn: nextStep, label: 'repairing', detail: String(attempt) });
      },
      signal: options.signal,
    });
    const modelMs = Date.now() - decisionStartedAt;

    // Not after a hold: a model told "finish again if nothing can get it" may send the very finish
    // it sent before, and that is its answer, not a stale page. Were it stale, the held answer is
    // the same text either way.
    if (!lean && !heldFinish?.pending && decision.raw && decision.raw === lastRawDecision) {
      staleReads++;
      // Scaled with the ceiling, so a stray stale read late in a long run does not abort it and
      // discard everything gathered so far.
      if (staleReads > Math.max(MAX_STALE_READS, Math.ceil(maxTurns / 4))) {
        throw new AgentRunError(
          'stale_provider',
          'The provider kept returning its previous answer — the conversation could not be advanced',
          providerLabel,
        );
      }
      session.threadUrl = null;
      session.lost = false;
      sendLog(`♻️ [Agent] turn ${turn}: ${providerLabel} returned the previous answer verbatim — dropping the thread and retrying`);
      // Its own stage, so the trace does not show it as a numbered repair attempt.
      options.onTrace?.({ kind: 'stage', turn: nextStep, label: 'repeated' });
      turn--;
      continue;
    }
    lastRawDecision = decision.raw;
    turnsUsed = turn;
    // Told once. Cleared only past the stale-read retry above, which re-asks the same turn.
    if (heldFinish) heldFinish.pending = false;

    if (!decision.ok || !decision.value) {
      // The last rejected reply never reaches `onReject`, and it is the one that ends the run — the
      // reply worth reading when a provider keeps answering in prose.
      if (decision.raw) sendLog(`✖ [Agent] turn ${turn}: gave up on the reply (${decision.error ?? 'invalid'}); reply: "${rejectedReplyPreview(decision.raw)}"`);
      // A held answer is still an answer: the exit below delivers it rather than failing the run.
      if (scratch.length === 0 && !heldFinish) {
        throw new AgentRunError(
          decision.reason ?? 'invalid_output',
          decision.error ?? 'The agent could not produce a valid action',
        );
      }
      break;
    }

    const action = decision.value;
    const planWasEmpty = plan.steps.length === 0;
    const bornComplete = planWasEmpty && scratch.length === 0;
    applyPlanUpdate(plan, action.plan, bornComplete ? undefined : action.planDone);
    if (plan.steps.length > 0) {
      options.onTrace?.({ kind: 'plan', steps: [...plan.steps], done: [...plan.done] });
    }
    if (planWasEmpty && plan.steps.length > 0) {
      sendLog(`🗂️ [Agent] plan: ${plan.steps.map((step, i) => `${i + 1}. ${step}`).join(' | ')}`);
    }
    // Read once, from the first action of this invocation: before any tool result is in the
    // prompt, and — on a resume — right after the user's own answer.
    if (intentOpen) {
      intentOpen = false;
      if (action.intent) {
        intent = action.intent;
        options.onIntent?.(action.intent);
        sendLog(`🎯 [Agent] intent: change [${action.intent.change.join(', ')}], content ${action.intent.content}`);
      }
    }
    // The ceiling is negotiated once, on the first action, and only upward. An explicit `maxTurns`
    // (`pinnedMaxTurns`) disables it: a caller that asked for N steps gets N. A later
    // `steps_needed` is ignored: a run that can raise its own limit mid-flight has no limit.
    if (budgetSettled === false && !mustFinish) {
      budgetSettled = true;
      if (pinnedMaxTurns === undefined) {
        const grown = Math.max(planTurnCeiling(plan.steps.length), action.stepsNeeded ?? 0);
        if (grown > maxTurns) {
          const why = (action.stepsNeeded ?? 0) >= grown ? 'self-assessed' : `${plan.steps.length}-step plan`;
          sendLog(`🗂️ [Agent] ${why} — step limit raised ${maxTurns} → ${grown}`);
          maxTurns = Math.min(grown, MAX_SELF_ASSESSED_STEPS);
          options.onStepBudget?.(maxTurns);
        }
      }
    }

    if (action.action === 'deliver') {
      const answer = deliverables.get(action.from ?? 0) ?? '';
      // The validator only lets through a step that was in the map, so an empty answer here can
      // only mean a bug. Falling through to synthesis is better than shipping a blank reply.
      if (answer) {
        sendLog(`📤 [Agent] delivering step ${action.from} verbatim (${answer.length} chars)`);
        // "deliver" is only legal when that step already answers the goal, so it is complete by definition.
        return answered(action.title ?? '', answer, turn, COMPLETE);
      }
      // Leave the loop for synthesis; carrying on would run "deliver" below as a tool call.
      sendLog(`⚠️ [Agent] deliver named step ${action.from} but no text was kept — synthesizing instead`);
      break;
    }

    if (action.action === 'finish') {
      // Held only while there is room to act on it: this turn plus at least one more that is not
      // the forced last one. Never for a helper — its parent judges the findings and is told below
      // when they are incomplete. Once per run: a second "not done" was said on purpose.
      const canHold = !readOnly && !mustFinish && maxTurns - turn >= 2 && heldFinish === null;
      if (action.done === false && canHold) {
        heldFinish = {
          title: action.title ?? '', content: action.content ?? '', missing: action.missing ?? '', steps: scratch.length, pending: true,
        };
        sendLog(`⏸️ [Agent] turn ${turn}: finish held — the model says the goal is not done${action.missing ? ` (${action.missing})` : ''}`);
        // No detail: `missing` is often absent, and the row must read whole without it. What is
        // missing reaches the user in the answer's own notice if the run still ends short.
        options.onTrace?.({ kind: 'stage', turn: nextStep, label: 'held' });
        continue;
      }
      return answered(action.title ?? '', action.content ?? '', turn, finishCompletion(action.done, action.missing, mustFinish));
    }

    if (action.action === 'ask_user') {
      const question = action.question ?? '';
      const choices = action.choices;
      sendLog(`❓ [Agent] pausing to ask the user: ${question}${choices ? ` [${choices.join(' | ')}]` : ''}`);
      options.onTurn?.({
        index: nextStep,
        turn,
        thought: action.thought,
        tool: AGENT_ASK_TOOL,
        config: { question, ...(choices ? { choices: JSON.stringify(choices) } : {}) },
        observation: '',
        status: 'ok',
        at: new Date().toISOString(),
        modelMs,
      });
      options.onTrace?.({ kind: 'question', question, ...(choices ? { choices } : {}) });
      return { kind: 'question', question, ...(choices ? { choices } : {}), toolCalls, turns: turn, ...evidenceOut() };
    }

    const calls: BatchCall[] = action.action === 'call_tools' ? action.calls : [action];
    const batched = calls.length > 1;
    const firstStep = scratch.length + 1;
    if (batched) {
      sendLog(`🧺 [Agent] turn ${turn}: ${calls.length} calls at once — ${calls.map((call) => planCall(call, providerUrl, deepResearch).label).join(', ')}`);
    }

    /**
     * One call, from the repeat guard to its observation. Everything the model or the UI numbers
     * uses `step` — the scratch entry the result is filed under — so the calls of a batch each get
     * their own row, their own repeat-guard reference and their own `deliver` number.
     */
    const executeCall = async (call: BatchCall, step: number): Promise<CallResult> => {
      const { label: toolLabel, config: recordConfig } = planCall(call, providerUrl, deepResearch);
      const signature = callSignature(toolLabel, recordConfig);
      const repeatedAt = signatures.get(signature);
      if (repeatedAt === undefined) signatures.set(signature, step);
      const thought = step === firstStep ? action.thought : '';
      const startedAt = Date.now();

      toolCalls++;
      const serverName = call.action === 'call_mcp' ? findMcpServer(mcpIndex, call.server)?.serverName : undefined;
      options.onProgress?.({ stage: 'tool', tool: toolLabel, ...(serverName ? { server: serverName } : {}) });
      options.onTrace?.({ kind: 'tool', turn: step, tool: toolLabel, config: recordConfig, ...(thought ? { thought } : {}) });
      // Masked: `sendLog` appends to yobi.log in plaintext, and a shell command is the one config
      // that routinely carries a token (`curl -H "Authorization: ..."`, `gh auth token`).
      sendLog(`🤖 [Agent] turn ${turn}${batched ? ` · step ${step}` : ''}: ${toolLabel} ${maskSecrets(JSON.stringify(recordConfig), true)}`);

      const settle = (observation: string, status: 'ok' | 'error', research?: ResearchProgress): CallResult => {
        options.onTrace?.({ kind: 'observation', turn: step, tool: toolLabel, status, preview: truncate(observation, 200) });
        return {
          label: toolLabel, config: recordConfig, thought, observation, status, startedAt, ms: Date.now() - startedAt,
          ...(research ? { research } : {}),
        };
      };

      if (repeatedAt !== undefined) {
        sendLog(`🔁 [Agent] skipped a repeat of ${toolLabel} (identical to step ${repeatedAt})`);
        return settle(repeatObservation(toolLabel, repeatedAt), 'error');
      }
      if (call.action !== 'call_mcp' && isHelpTool(call.tool ?? '')) {
        // Connector tools first: a tier-1 brief is the only entry the model saw for them, so
        // `tool_help` has to be able to expand one. Falls through to the built-in catalog when the
        // name is not a connector tool, so one call answers either kind.
        if (helpCalls >= MAX_HELP_CALLS_PER_RUN) {
          return settle(`ERROR: no "${AGENT_HELP_TOOL}" look-ups left this run (limit ${MAX_HELP_CALLS_PER_RUN}). Act with the tools you already have, or finish.`, 'error');
        }
        helpCalls += 1;
        // Give the step back — but not on the last turn, where a look-up cannot be acted on
        // anyway, so a free one would only buy the run a turn it did not earn.
        if (!mustFinish) {
          maxTurns += 1;
          toolCalls -= 1;
        }
        const wanted = recordConfig.tool ?? '';
        // Three granularities, one tool: `<server>:<tool>`, a bare server handle (the summary
        // and the catalog tails both send the model here with one), and finally a built-in
        // name. The server listing is budgeted like any other observation, because a 78-tool
        // server does not fit a browser provider's 3,500 characters either.
        const help = (mcpEnabled ? describeMcpTool(mcpIndex, wanted) : null)
          ?? (mcpEnabled ? describeMcpServer(mcpIndex, wanted, observationLimit) : null)
          ?? describeToolSpec(wanted, toolScope);
        return settle(help, help.startsWith('ERROR:') ? 'error' : 'ok');
      }

      if (!batched) activeStep = step;
      const outcome = await runCall(callCtx, call, recordConfig, step, signature);
      if (outcome.deferred) {
        // Nothing ran, so nothing is counted, and the repeat guard must not remember a call that
        // has not happened: approving it later is what runs it.
        toolCalls--;
        signatures.delete(signature);
        return {
          label: toolLabel, config: recordConfig, thought, observation: '', status: 'ok', startedAt, ms: 0, deferred: outcome.deferred,
        };
      }
      if (outcome.write) {
        writes.attempted += 1;
        if (outcome.landed) writes.succeeded += 1;
      }
      // Held back only until something was looked at: the same call must be allowed through once it has.
      if (outcome.transientBlock) signatures.delete(signature);
      // Failed reads too: the change may be exactly what makes the read work now (a restored page).
      if (!outcome.write) readsBeforeChange.add(signature);
      // A change that landed makes every earlier read stale: re-reading is how the change gets
      // checked, not a repeat.
      if (outcome.landed) {
        for (const read of readsBeforeChange) signatures.delete(read);
        readsBeforeChange.clear();
      }
      return settle(outcome.observation, outcome.status, outcome.research);
    };

    const results = batched
      ? await runScheduled(
          calls.map((call) => batchResource(call, mcpIndex)),
          (resource) => (resource === 'llm' ? llmConcurrency(providerUrl) : 1),
          (index) => executeCall(calls[index], firstStep + index),
        )
      : [await executeCall(calls[0], firstStep)];

    // Only a lone call can be a shell command (a batch holds reads), so only `results[0]`.
    const deferred = results[0]?.deferred;
    if (deferred && options.shellApproval) {
      const text = options.shellApproval(deferred);
      const config = shellApprovalConfig(text, { command: deferred.command, shell: results[0].config.shell ?? '' });
      sendLog(`❓ [Agent] pausing to ask the user to approve a shell command (${deferred.interpreter})`);
      options.onTurn?.({
        index: firstStep,
        turn,
        thought: results[0].thought,
        tool: AGENT_ASK_TOOL,
        config,
        observation: '',
        status: 'ok',
        at: new Date().toISOString(),
        modelMs,
      });
      options.onTrace?.({ kind: 'question', question: text.question, choices: [...text.choices] });
      return { kind: 'question', question: text.question, choices: [...text.choices], toolCalls, turns: turn, ...evidenceOut() };
    }

    // Committed in the order the model wrote the calls, whatever order they finished in: the step
    // numbers it will name next turn, the checkpoint and the delta all have to agree.
    consecutiveErrors = results.some((result) => result.status === 'ok') ? 0 : consecutiveErrors + 1;
    observationCut = results.some((result) => result.observation.length > observationLimit);
    results.forEach((result, index) => {
      const step = firstStep + index;
      const stored = truncate(result.observation, observationLimit);
      const forDelta = truncate(result.observation, deltaObservationLimit);
      // Recorded BEFORE truncation, and only for a tool whose output is a finished answer. The
      // step number matches the one `renderScratch` prints, which is what the model names.
      if (result.status === 'ok' && isDeliverableSkill(result.label) && result.observation.trim()) {
        deliverables.set(step, result.observation);
      }
      scratch.push({
        thought: result.thought,
        tool: result.label,
        config: result.config,
        observation: stored,
        ...(forDelta === stored ? {} : { deltaObservation: forDelta }),
      });
      options.onTurn?.({
        index: step,
        turn,
        thought: result.thought,
        tool: result.label,
        config: result.config,
        observation: stored,
        status: result.status,
        at: new Date(result.startedAt).toISOString(),
        ...(index === 0 ? { modelMs } : {}),
        toolMs: result.ms,
        ...(result.research ? { research: result.research } : {}),
      });
    });
    lastBatchSize = results.length;
  }

  if (heldFinish && scratch.length === heldFinish.steps) {
    // Nothing was gathered after the hold, so a synthesis could only rewrite this answer from the
    // same evidence — a round trip for nothing. It is delivered as the model left it: not done.
    sendLog('⏸️ [Agent] nothing new after the held finish — delivering it as written');
    return answered(heldFinish.title, heldFinish.content, turnsUsed, finishCompletion(false, heldFinish.missing || undefined, false));
  }
  if (scratch.length === 0) {
    throw new AgentRunError('step_limit', 'The agent reached the step limit without an answer');
  }
  options.onProgress?.({ stage: 'thinking' });
  options.onTrace?.({ kind: 'synthesizing' });
  const synthTimeoutMs = Math.max(SYNTH_MIN_TIMEOUT_MS, Math.min(reasoningTimeoutMs, remainingMs()));
  if (plan.steps.length > 0 && !planComplete(plan)) {
    sendLog(`🗂️ [Agent] stopped with ${plan.done.length}/${plan.steps.length} plan items done — synthesizing from what it has`);
  }
  const final = await synthesizeFinal(
    promptGoal, scratch, providerUrl, deps, synthTimeoutMs, lean, scratchSlots, session, history, plan,
    writesAllFailed(writes), renderActionLines(ledger.actions, 8), userMemory, options.signal,
  );
  return answered(final.title, final.content, turnsUsed, synthesisCompletion(final.done, final.missing));
}

import type { SkillType, AgentTraceEvent, AgentTurnRecord, FlowDefinition } from '../../../shared/types';
import { AGENT_ASK_TOOL, isByokTargetUrl } from '../../../shared/types';
import type { FlowExecutorDeps } from '../types';
import { executeSkill } from '../skills';
import { unwrapStepOutput } from '../executor';
import { FlowAbortError, resolveStepTimeoutMs, withStepTimeout } from '../runtime';
import { sendLog } from '../../helpers';
import { currentScopeTokens } from '../../tokenMeter';
import { askJson, createProviderSession } from './structuredLlm';
import type { ProviderSession, Validation } from './structuredLlm';
import { buildToolCatalog, validateAgentAction, validateFinalAnswer } from './agentTools';
import type { AgentAction, FinalAnswer } from './agentTools';
import {
  applyPlanUpdate, buildActionRepair, buildDeltaPrompt, buildFinishPrompt, buildRepairPrompt,
  buildTurnPrompt, emptyPlan, historyThatFits, planComplete, SCRATCH_IN_PROMPT,
  SCRATCH_IN_PROMPT_MCP, SCRATCH_TOTAL_BUDGET, SYNTH_SCRATCH_BUDGET_LEAN, SYNTH_SCRATCH_SLOTS_LEAN,
} from './agentPrompts';
import type { AgentPlan, ScratchEntry, TurnPromptOptions } from './agentPrompts';
import { denyReasonForFileTool, getAgentFileRoots } from './agentSandbox';
import { maskSecrets } from './secretMask';
import { detectProvider, getProviderLabel } from '../../providers';
import type { McpRegistry } from '../../mcp';
import {
  buildMcpCatalog, buildMcpIndex, classifyMcpTool, formatMcpObservation, hasMcpTools,
  mcpCatalogBudgetChars, resolveMcpTool, schemaHint, validateMcpAction, validateMcpArguments,
} from './mcpTools';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import { isBuiltinTool, runBuiltinTool } from './agentBuiltins';
import type { AgentBuiltinTool, BuiltinDeps, FlowWriteConfirmRequest } from './agentBuiltins';

// Façade: the prompt builders moved out when their parameter list outgrew positional
// arguments, but they are part of this module's public surface for the test suite.
export {
  buildActionRepair, buildDeltaPrompt, buildFinishPrompt, buildTurnPrompt, historyThatFits,
  renderScratch, SCRATCH_IN_PROMPT, SCRATCH_IN_PROMPT_MCP, SCRATCH_TOTAL_BUDGET,
} from './agentPrompts';
export type { AgentPlan, ScratchEntry, TurnPromptOptions } from './agentPrompts';

type AgentDecision = AgentAction | McpAction;

export interface McpConfirmRequest {
  kind: 'mcp';
  serverId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Everything the agent can do that leaves state behind on the user's machine. Both arms are
 * asked through one channel so a new one cannot be added without deciding what its dialog says.
 */
export type AgentConfirmRequest = McpConfirmRequest | FlowWriteConfirmRequest;

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_REASONING_TIMEOUT_MS = 120_000;
const DEFAULT_TOTAL_BUDGET_MS = 10 * 60_000;
const MIN_TURN_BUDGET_MS = 30_000;
const BYOK_OBSERVATION_LIMIT = 16_000;
const BROWSER_OBSERVATION_LIMIT = 3_500;
const BROWSER_DELTA_OBSERVATION_LIMIT = 24_000;
/**
 * Ceiling on the tokens one BYOK `/agent` run may spend before it is told to wrap up.
 * The four retry layers (turns x json repairs x transport retries x keys in a group)
 * multiply, and nothing else bounds their product. Browser providers are exempt: their
 * tokens are not billed, so only wall-clock matters there.
 */
const AGENT_BYOK_TOKEN_BUDGET = 120_000;
/**
 * Hard stop, mirroring how the wall-clock budget pairs a soft `mustFinish` with a real
 * `break`. The soft budget only *asks* the model to wrap up; a model that keeps calling
 * tools anyway would sail past it to the turn limit.
 */
const AGENT_BYOK_TOKEN_CEILING = 180_000;
const AGENT_STEP_ID = 'agent';
const SYNTH_MIN_TIMEOUT_MS = 45_000;
const LOCAL_SOURCE_TOOLS = new Set<SkillType>(['file_read', 'clipboard', 'sysinfo']);
/** Failed steps in a row before the prompt starts telling the model to change course. */
const STALL_THRESHOLD = 2;
/** Consecutive verbatim re-reads tolerated before the run gives up instead of spinning. */
const MAX_STALE_READS = 2;
/**
 * A plan earns turns. `DEFAULT_MAX_TURNS` was one number for every goal, so a run that split
 * itself into four sub-questions got the same eight steps as a one-lookup goal and had to
 * choose between covering its plan and synthesizing an answer. Growth is bounded by
 * `PLAN_MAX_TURNS`, and the wall-clock and token budgets remain the real stops — they force a
 * graceful finish long before a 14-turn ceiling could be reached on a slow provider.
 */
const PLAN_TURN_BASE = 2;
const PLAN_TURNS_PER_STEP = 2;
const PLAN_MAX_TURNS = 14;

export function planTurnCeiling(steps: number): number {
  if (steps <= 0) return DEFAULT_MAX_TURNS;
  return Math.min(PLAN_MAX_TURNS, Math.max(DEFAULT_MAX_TURNS, PLAN_TURN_BASE + PLAN_TURNS_PER_STEP * steps));
}

export type AgentProgress =
  | { stage: 'thinking' }
  | { stage: 'tool'; tool: string; index: number; total: number };

export interface AgentRunOptions {
  onProgress?: (progress: AgentProgress) => void;
  onTrace?: (event: AgentTraceEvent) => void;
  onTurn?: (turn: AgentTurnRecord) => void;
  resumeFrom?: AgentTurnRecord[];
  conversationPath?: string;
  signal?: AbortSignal;
  maxTurns?: number;
  totalBudgetMs?: number;
  onConfirm?: (request: AgentConfirmRequest) => Promise<boolean>;
  /**
   * Persists a flow the agent built. Absent = `build_flow` refuses rather than silently
   * discarding the result, so a caller that cannot save flows never advertises that it can.
   */
  onSaveFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
}

export type AgentRunResult =
  | { kind: 'answer'; title: string; answer: string; toolCalls: number; turns: number }
  | { kind: 'question'; question: string; toolCalls: number; turns: number };

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`;
}

interface PlannedCall {
  label: string;
  config: Record<string, string>;
}

/**
 * Resolves a decision into the (label, config) pair that is logged, persisted and — via
 * `callSignature` — deduplicated. Both come from one place so a resumed run recomputes
 * exactly the signature the stored turn produced.
 */
function planCall(action: AgentDecision, providerUrl: string): PlannedCall {
  if (action.action === 'call_mcp') {
    return {
      label: `mcp:${action.name}`,
      config: { server: action.server, arguments: JSON.stringify(action.arguments) },
    };
  }
  const config = action.config ?? {};
  const tool = action.tool as SkillType;
  // "provider" is hidden from the catalog, so the model never sets it: a sub-call inherits
  // the provider this run is already using rather than the app's configured target.
  if ((tool === 'llm' || tool === 'research') && !(config.provider ?? '').trim()) {
    config.provider = providerUrl;
  }
  return { label: tool, config };
}

/**
 * Exported for the test suite. Identity of a tool call for repeat detection. Values are
 * whitespace-normalized and lowercased because a model re-asking the same thing rarely
 * retypes it byte-identically ("Apple Inc" vs "apple inc " is one query, not two), and
 * empty values are dropped because optional keys are emitted inconsistently between turns.
 */
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
  signal?: AbortSignal,
): Promise<FinalAnswer> {
  // A browser provider's window is fixed by its input cap; BYOK's is not, so the final answer
  // there sees every observation the run gathered rather than the last six.
  const assembleFinish = (h: string): string => buildFinishPrompt({
    goal,
    scratch,
    lean,
    scratchSlots: lean ? Math.max(scratchSlots, SYNTH_SCRATCH_SLOTS_LEAN) : scratchSlots,
    totalBudget: lean ? SYNTH_SCRATCH_BUDGET_LEAN : SCRATCH_TOTAL_BUDGET,
    history: h,
    plan,
  });

  const result = await askJson<FinalAnswer>({
    basePrompt: assembleFinish(historyThatFits(assembleFinish, history, providerUrl)),
    session,
    providerUrl,
    deps,
    timeoutMs,
    validate: validateFinalAnswer,
    buildRepair: (prevRaw, error) => {
      const build = (h: string): string => buildRepairPrompt(prevRaw, error, assembleFinish(h));
      return build(historyThatFits(build, history, providerUrl));
    },
    signal,
  });
  if (!result.ok || !result.value) {
    throw new Error(result.error ?? 'The agent could not synthesize a valid answer');
  }
  return result.value;
}

async function runTool(
  tool: SkillType,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  budgetRemainingMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const timeoutMs = Math.max(10_000, Math.min(resolveStepTimeoutMs(tool, deps, config), budgetRemainingMs));
  if (tool === 'llm') {
    return executeSkill('llm', AGENT_STEP_ID, config, deps, timeoutMs, signal);
  }
  return withStepTimeout(
    executeSkill(tool, AGENT_STEP_ID, config, deps, timeoutMs),
    timeoutMs,
    tool,
    undefined,
    signal,
  );
}

function buildObservation(output: string, subVars: Record<string, string>): string {
  const extras = Object.entries(subVars)
    .filter(([key, value]) => value && value !== output && key !== 'isFailed' && key !== 'transcript')
    .map(([key, value]) => `${key}=${value.length > 200 ? `${value.slice(0, 200)}…` : value}`);
  return extras.length > 0 ? `${output}\n[fields] ${extras.join('; ')}` : output;
}

async function runMcpCall(
  action: McpAction,
  index: McpRuntimeIndex,
  registry: McpRegistry,
  onConfirm: AgentRunOptions['onConfirm'],
  signal?: AbortSignal,
): Promise<{ observation: string; status: 'ok' | 'error' }> {
  const resolved = resolveMcpTool(index, action.server, action.name);
  if (!resolved) return { observation: `ERROR: Unknown MCP tool ${action.server}/${action.name}`, status: 'error' };

  const argCheck = validateMcpArguments(resolved.tool, action.arguments);
  if (!argCheck.ok) return { observation: `ERROR: ${argCheck.error}${schemaHint(resolved.tool)}`, status: 'error' };

  if (classifyMcpTool(resolved.tool) === 'write') {
    const serverName = index.byHandle.get(action.server)?.serverName ?? action.server;
    const allowed = onConfirm
      ? await onConfirm({ kind: 'mcp', serverId: resolved.serverId, serverName, toolName: action.name, args: action.arguments })
      : false;
    if (!allowed) {
      return { observation: 'ERROR: The user declined this write operation. Do not retry it — take a different approach or finish.', status: 'error' };
    }
  }

  try {
    const result = await registry.callTool(resolved.serverId, action.name, action.arguments, signal);
    return { observation: maskSecrets(formatMcpObservation(result), true), status: result.isError ? 'error' : 'ok' };
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return { observation: `ERROR: ${message}${schemaHint(resolved.tool)}`, status: 'error' };
  }
}

export async function runAgent(
  goal: string,
  providerUrl: string,
  deps: FlowExecutorDeps,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) throw new Error('Empty goal');

  // A caller-supplied ceiling is authoritative and never grown — only the default one earns
  // extra turns from a plan, so a bounded caller (a test, a queued flow) stays bounded.
  const pinnedMaxTurns = options.maxTurns === undefined ? undefined : Math.max(1, options.maxTurns);
  let maxTurns = pinnedMaxTurns ?? DEFAULT_MAX_TURNS;
  const catalog = buildToolCatalog();
  const fileRoots = await getAgentFileRoots();
  const lean = isByokTargetUrl(providerUrl);
  // Named in the trace so "thinking" says WHO is being asked: on a web provider this step is
  // a minute of wall-clock, and an unlabelled spinner is indistinguishable from a hang.
  const providerLabel = getProviderLabel(providerUrl);
  const observationLimit = lean ? BYOK_OBSERVATION_LIMIT : BROWSER_OBSERVATION_LIMIT;
  const deltaObservationLimit = lean ? BYOK_OBSERVATION_LIMIT : BROWSER_DELTA_OBSERVATION_LIMIT;

  const { buildAgentHistory, historyPromptCost } = await import('./agentContext');
  const history = await buildAgentHistory({
    ...(options.conversationPath ? { conversationPath: options.conversationPath } : {}),
    providerUrl,
    catalogLen: catalog.length,
    goalLen: trimmedGoal.length,
  });
  const historyCost = historyPromptCost(history, providerUrl);

  const { getMcpRegistry } = await import('../../mcp');
  const mcpRegistry = getMcpRegistry();
  const mcpIndex = buildMcpIndex(mcpRegistry?.getAgentTools() ?? []);
  const isDuckai = !lean && detectProvider(providerUrl) === 'duckai';
  const mcpCandidate = mcpRegistry !== null && hasMcpTools(mcpIndex) && !isDuckai;
  const mcpBudget = mcpCandidate
    ? mcpCatalogBudgetChars(providerUrl, catalog.length, trimmedGoal.length, SCRATCH_IN_PROMPT_MCP, observationLimit, historyCost)
    : 0;
  const mcpSection = mcpBudget > 0 ? buildMcpCatalog(mcpIndex, mcpBudget) : { text: '', includedCount: 0, omitted: 0 };
  const mcpEnabled = mcpSection.includedCount > 0;
  const catalogForPrompt = mcpEnabled
    ? `${catalog}\n\nMCP TOOLS (external tools from your connected servers; call with "call_mcp"):\n${mcpSection.text}`
    : catalog;
  const scratchSlots = mcpEnabled ? SCRATCH_IN_PROMPT_MCP : SCRATCH_IN_PROMPT;
  const validateDecision = (allowAsk: boolean) => (json: unknown): Validation<AgentDecision> => {
    if (mcpEnabled && json && typeof json === 'object' && (json as Record<string, unknown>).action === 'call_mcp') {
      return validateMcpAction(json as Record<string, unknown>, mcpIndex);
    }
    return validateAgentAction(json, allowAsk);
  };

  const reasoningTimeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_REASONING_TIMEOUT_MS;
  const budgetMs = Math.max(MIN_TURN_BUDGET_MS, options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS);
  const startedAt = Date.now();
  const remainingMs = (): number => budgetMs - (Date.now() - startedAt);
  const scratch: ScratchEntry[] = (options.resumeFrom ?? []).map((entry) => ({
    thought: entry.thought,
    tool: entry.tool,
    config: entry.config,
    observation: entry.observation,
  }));
  // Repeat detection, keyed by call identity → the step that already made it. Only
  // successful resumed calls are pinned: a resumed run is a fresh attempt at whatever
  // died with the app, so re-trying the step that failed must stay allowed.
  const signatures = new Map<string, number>();
  (options.resumeFrom ?? []).forEach((entry, index) => {
    if (entry.status === 'ok') signatures.set(callSignature(entry.tool, entry.config), index + 1);
  });
  // One context for the whole run so `assess_flow` can hand its selection to a later
  // `build_flow` turn — the assessment is the expensive half and is never paid for twice.
  const builtinCtx: BuiltinDeps = {
    deps,
    providerUrl,
    assessed: null,
    remainingMs,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onSaveFlow ? { saveFlow: options.onSaveFlow } : {}),
    ...(options.onConfirm ? { confirm: options.onConfirm } : {}),
  };

  // A turn spent on a stale read produced no decision, so it is retried rather than counted.
  // Cumulative for the run, not consecutive: "drop the thread and ask again" only helps when
  // the thread was the problem, so a provider that keeps doing it must stop the run, not spin.
  let lastRawDecision = '';
  let staleReads = 0;

  let toolCalls = scratch.length;
  let consecutiveErrors = 0;
  // Not persisted across a resume: a resumed run simply re-plans, which costs nothing and is
  // preferable to threading plan state through the run store for a bookkeeping field.
  const plan: AgentPlan = emptyPlan();
  const session = createProviderSession();
  let budgetWarned = false;
  // No meter around this run means no budgeting: `null` is "cannot tell", not "nothing
  // spent", and a missing measurement must never be the reason a task gets cut short.
  // Browser providers are exempt — their tokens are not billed, so only wall-clock matters.
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

  for (let turn = scratch.length + 1; turn <= maxTurns; turn++) {
    if (options.signal?.aborted) throw new FlowAbortError();
    if (remainingMs() <= 0) break;
    // Only ever break with something to synthesize from — an empty scratch falls through to
    // the "reached the step limit without an answer" throw, which would be a lie here.
    if (scratch.length > 0 && overTokenCeiling()) break;

    // Same graceful landing as the wall-clock budget: force a finish so the user gets an
    // answer built from the observations already paid for, not an error.
    const mustFinish = turn === maxTurns || remainingMs() < MIN_TURN_BUDGET_MS || overTokenBudget();
    const turnTimeoutMs = Math.max(10_000, Math.min(reasoningTimeoutMs, remainingMs()));
    // Asking is offered only while a reply could still be acted on: at the step limit the
    // observations are already paid for and the user is owed the answer, not a question.
    const turnOptions: TurnPromptOptions = {
      goal: trimmedGoal,
      catalog: catalogForPrompt,
      scratch,
      mustFinish,
      lean,
      mcpGrammar: mcpEnabled,
      scratchSlots,
      stalled: consecutiveErrors >= STALL_THRESHOLD,
      allowAsk: !mustFinish,
      plan,
    };
    const buildTurn = (h: string): string => buildTurnPrompt({ ...turnOptions, history: h });
    const turnHistory = historyThatFits(buildTurn, history, providerUrl);
    const basePrompt = buildTurn(turnHistory);
    const previous = scratch.length > 0 ? scratch[scratch.length - 1] : undefined;
    const sessionPrompt = previous
      ? buildDeltaPrompt(previous, scratch.length, mustFinish, turnOptions.stalled, plan)
      : undefined;
    options.onProgress?.({ stage: 'thinking' });
    options.onTrace?.({ kind: 'thinking', turn, provider: providerLabel });

    const decision = await askJson<AgentDecision>({
      basePrompt,
      sessionPrompt,
      session,
      providerUrl,
      deps,
      timeoutMs: turnTimeoutMs,
      validate: validateDecision(!mustFinish),
      buildRepair: buildActionRepair({ ...turnOptions, history }, providerUrl),
      onReject: (error, attempt) => {
        sendLog(`↻ [Agent] turn ${turn}: response rejected (${error}) — asking again (${attempt})`);
        options.onTrace?.({ kind: 'stage', turn, label: 'repairing', detail: String(attempt) });
      },
      signal: options.signal,
    });

    /*
     * A byte-identical reply two turns running is not a decision — it is the same message read
     * twice. It happens when a browser provider navigates mid-turn and the recovery read picks
     * up the answer already on the page; the loop then re-runs the decision it just made, the
     * repeat guard turns each one into an error observation, and the run burns every remaining
     * turn saying the same thing. Drop the thread so the next turn re-sends the full prompt on
     * a clean one, and spend no turn on the stale copy.
     */
    // Browser providers only: a BYOK endpoint repeating itself is an ordinary loop the repeat
    // guard already handles, and there is no page to have re-read.
    if (!lean && decision.raw && decision.raw === lastRawDecision) {
      staleReads++;
      if (staleReads > MAX_STALE_READS) {
        throw new Error('The provider kept returning its previous answer — the conversation could not be advanced');
      }
      session.threadUrl = null;
      session.lost = false;
      sendLog(`♻️ [Agent] turn ${turn}: ${providerLabel} returned the previous answer verbatim — dropping the thread and retrying`);
      options.onTrace?.({ kind: 'stage', turn, label: 'repairing', detail: 'stale' });
      // No decision was made, so this must not cost a step. `staleReads` is cumulative for the
      // whole run, which is what bounds the retry — the loop counter cannot.
      turn--;
      continue;
    }
    lastRawDecision = decision.raw;

    if (!decision.ok || !decision.value) {
      if (scratch.length === 0) throw new Error(decision.error ?? 'The agent could not produce a valid action');
      break;
    }

    const action = decision.value;
    const planWasEmpty = plan.steps.length === 0;
    // A plan that arrives before any step was taken cannot have anything done yet. Models
    // asked for "the items you have now finished" will happily echo all of them on turn one,
    // and an instantly-complete plan would trigger the finish nudge — turning the feature
    // meant to buy depth into the shallowest possible run.
    const bornComplete = planWasEmpty && scratch.length === 0;
    applyPlanUpdate(plan, action.plan, bornComplete ? undefined : action.planDone);
    if (plan.steps.length > 0) {
      options.onTrace?.({ kind: 'plan', steps: [...plan.steps], done: [...plan.done] });
    }
    if (planWasEmpty && plan.steps.length > 0) {
      sendLog(`🗂️ [Agent] plan: ${plan.steps.map((step, i) => `${i + 1}. ${step}`).join(' | ')}`);
      // Not while landing: at the step limit the model was told to finish, and growing the
      // budget for a plan it produced instead would reward ignoring that.
      if (pinnedMaxTurns === undefined && !mustFinish) {
        const grown = planTurnCeiling(plan.steps.length);
        if (grown > maxTurns) {
          sendLog(`🗂️ [Agent] ${plan.steps.length}-step plan — step limit raised ${maxTurns} → ${grown}`);
          maxTurns = grown;
        }
      }
    }

    if (action.action === 'finish') {
      return { kind: 'answer', title: action.title ?? '', answer: action.content ?? '', toolCalls, turns: turn };
    }

    if (action.action === 'ask_user') {
      const question = action.question ?? '';
      sendLog(`❓ [Agent] pausing to ask the user: ${question}`);
      // Persisted with an empty observation on purpose: the resume writes the user's reply
      // into it, so the answer reaches the model through the scratchpad every other tool
      // result travels through, and nothing gathered so far is thrown away.
      options.onTurn?.({
        index: turn,
        thought: action.thought,
        tool: AGENT_ASK_TOOL,
        config: { question },
        observation: '',
        status: 'ok',
      });
      options.onTrace?.({ kind: 'question', question });
      return { kind: 'question', question, toolCalls, turns: turn };
    }

    const { label: toolLabel, config: recordConfig } = planCall(action, providerUrl);
    const signature = callSignature(toolLabel, recordConfig);
    const repeatedAt = signatures.get(signature);
    if (repeatedAt === undefined) signatures.set(signature, turn);

    toolCalls++;
    options.onProgress?.({ stage: 'tool', tool: toolLabel, index: toolCalls, total: maxTurns });
    options.onTrace?.({ kind: 'tool', turn, tool: toolLabel, config: recordConfig, thought: action.thought });
    sendLog(`🤖 [Agent] turn ${turn}: ${toolLabel} ${JSON.stringify(recordConfig)}`);

    let observation: string;
    let turnStatus: 'ok' | 'error' = 'ok';

    if (repeatedAt !== undefined) {
      // Not executed at all: the prompt has always asked for no identical repeats, but a
      // rule the loop does not enforce is a rule a stuck model can spend every turn on.
      observation = repeatObservation(toolLabel, repeatedAt);
      turnStatus = 'error';
      sendLog(`🔁 [Agent] skipped a repeat of ${toolLabel} (identical to step ${repeatedAt})`);
    } else if (action.action === 'call_mcp') {
      const outcome = await runMcpCall(action, mcpIndex, mcpRegistry!, options.onConfirm, options.signal);
      observation = outcome.observation;
      turnStatus = outcome.status;
      if (turnStatus === 'error') sendLog(`⚠️ [Agent] ${toolLabel}: ${observation.slice(0, 160)}`);
    } else if (isBuiltinTool(action.tool ?? '')) {
      const outcome = await runBuiltinTool(action.tool as AgentBuiltinTool, recordConfig, builtinCtx);
      observation = outcome.observation;
      turnStatus = outcome.status;
      if (turnStatus === 'error') sendLog(`⚠️ [Agent] ${toolLabel}: ${observation.slice(0, 160)}`);
    } else {
      const tool = action.tool as SkillType;
      const denyReason = await denyReasonForFileTool(tool, recordConfig, fileRoots);
      if (denyReason) {
        observation = `ERROR: ${denyReason}`;
        turnStatus = 'error';
        sendLog(`🔒 [Agent] blocked ${tool}: ${denyReason}`);
      } else {
        // Stages are reported against THIS turn, so a pipeline skill (research) can narrate
        // itself into its own row instead of leaving it blank for a minute.
        const stageDeps: FlowExecutorDeps = options.onTrace
          ? { ...deps, onStage: (label, detail) => options.onTrace?.({ kind: 'stage', turn, label, detail }) }
          : deps;
        try {
          const raw = await runTool(tool, recordConfig, stageDeps, remainingMs(), options.signal);
          const unwrapped = unwrapStepOutput(tool, raw);
          observation = maskSecrets(
            buildObservation(unwrapped.output, unwrapped.subVars),
            LOCAL_SOURCE_TOOLS.has(tool),
          );
        } catch (err) {
          if (err instanceof FlowAbortError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          observation = `ERROR: ${message}`;
          turnStatus = 'error';
          sendLog(`⚠️ [Agent] ${tool} failed: ${message}`);
        }
      }
    }

    consecutiveErrors = turnStatus === 'error' ? consecutiveErrors + 1 : 0;

    const stored = truncate(observation, observationLimit);
    const forDelta = truncate(observation, deltaObservationLimit);
    scratch.push({
      thought: action.thought,
      tool: toolLabel,
      config: recordConfig,
      observation: stored,
      ...(forDelta === stored ? {} : { deltaObservation: forDelta }),
    });
    options.onTrace?.({ kind: 'observation', turn, tool: toolLabel, status: turnStatus, preview: truncate(observation, 200) });
    options.onTurn?.({ index: turn, thought: action.thought, tool: toolLabel, config: recordConfig, observation: stored, status: turnStatus });
  }

  if (scratch.length === 0) throw new Error('The agent reached the step limit without an answer');
  options.onProgress?.({ stage: 'thinking' });
  // The last thing a run does is the one phase with no row of its own: without this the UI
  // sits on "thinking" through the whole final write-up, which is also its longest single call.
  options.onTrace?.({ kind: 'synthesizing' });
  const synthTimeoutMs = Math.max(SYNTH_MIN_TIMEOUT_MS, Math.min(reasoningTimeoutMs, remainingMs()));
  if (plan.steps.length > 0 && !planComplete(plan)) {
    sendLog(`🗂️ [Agent] stopped with ${plan.done.length}/${plan.steps.length} plan items done — synthesizing from what it has`);
  }
  const final = await synthesizeFinal(trimmedGoal, scratch, providerUrl, deps, synthTimeoutMs, lean, scratchSlots, session, history, plan, options.signal);
  return { kind: 'answer', title: final.title, answer: final.content, toolCalls, turns: scratch.length };
}

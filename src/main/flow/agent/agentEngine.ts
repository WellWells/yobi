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
import {
  buildToolCatalog, describeToolSpec, isHelpTool, validateAgentAction, validateFinalAnswer,
} from './agentTools';
import type { AgentAction, FinalAnswer } from './agentTools';
import {
  applyPlanUpdate, buildActionRepair, buildDeltaPrompt, buildFinishPrompt, buildRepairPrompt,
  buildTurnPrompt, emptyPlan, historyThatFits, planComplete, SCRATCH_IN_PROMPT,
  SCRATCH_IN_PROMPT_MCP, SCRATCH_IN_PROMPT_MCP_CAPPED, SCRATCH_TOTAL_BUDGET,
  SYNTH_SCRATCH_BUDGET_LEAN, SYNTH_SCRATCH_SLOTS_LEAN,
} from './agentPrompts';
import type { AgentPlan, ScratchEntry, TurnPromptOptions } from './agentPrompts';
import { denyReasonForFileTool, getAgentFileRoots } from './agentSandbox';
import { maskSecrets } from './secretMask';
import { detectProvider, getProviderLabel } from '../../providers';
import { getMcpRegistry } from '../../mcp';
import type { McpRegistry } from '../../mcp';
import {
  buildMcpCatalog, buildMcpIndex, classifyMcpTool, formatMcpObservation, hasMcpTools,
  mcpCatalogBudgetChars, mcpScratchReserveChars, resolveMcpTool, schemaHint, validateMcpAction,
  validateMcpArguments,
} from './mcpTools';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import { isBuiltinTool, runBuiltinTool } from './agentBuiltins';
import type { AgentBuiltinTool, BuiltinDeps, FlowWriteConfirmRequest } from './agentBuiltins';

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

export type AgentConfirmRequest = McpConfirmRequest | FlowWriteConfirmRequest;

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_REASONING_TIMEOUT_MS = 120_000;
const DEFAULT_TOTAL_BUDGET_MS = 10 * 60_000;
const MIN_TURN_BUDGET_MS = 30_000;
const BYOK_OBSERVATION_LIMIT = 16_000;
const BROWSER_OBSERVATION_LIMIT = 3_500;
const BROWSER_DELTA_OBSERVATION_LIMIT = 24_000;
const AGENT_BYOK_TOKEN_BUDGET = 120_000;
const AGENT_BYOK_TOKEN_CEILING = 180_000;
const AGENT_STEP_ID = 'agent';
const SYNTH_MIN_TIMEOUT_MS = 45_000;
const LOCAL_SOURCE_TOOLS = new Set<SkillType>(['file_read', 'clipboard', 'sysinfo']);
const STALL_THRESHOLD = 2;
const MAX_STALE_READS = 2;
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
  attachments?: string[];
  signal?: AbortSignal;
  maxTurns?: number;
  totalBudgetMs?: number;
  onConfirm?: (request: AgentConfirmRequest) => Promise<boolean>;
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

function planCall(action: AgentDecision, providerUrl: string): PlannedCall {
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
  signal?: AbortSignal,
): Promise<FinalAnswer> {
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

  const pinnedMaxTurns = options.maxTurns === undefined ? undefined : Math.max(1, options.maxTurns);
  let maxTurns = pinnedMaxTurns ?? DEFAULT_MAX_TURNS;
  const catalog = buildToolCatalog();
  const fileRoots = await getAgentFileRoots();
  const lean = isByokTargetUrl(providerUrl);
  const providerLabel = getProviderLabel(providerUrl);
  const observationLimit = lean ? BYOK_OBSERVATION_LIMIT : BROWSER_OBSERVATION_LIMIT;
  const deltaObservationLimit = lean ? BYOK_OBSERVATION_LIMIT : BROWSER_DELTA_OBSERVATION_LIMIT;

  const mcpRegistry = getMcpRegistry();
  const mcpIndex = buildMcpIndex(mcpRegistry?.getAgentTools() ?? []);
  const isDuckai = !lean && detectProvider(providerUrl) === 'duckai';
  const mcpCandidate = mcpRegistry !== null && hasMcpTools(mcpIndex) && !isDuckai;
  const mcpScratchSlots = lean ? SCRATCH_IN_PROMPT_MCP : SCRATCH_IN_PROMPT_MCP_CAPPED;

  const { buildAgentHistory, historyPromptCost, MCP_CATALOG_RESERVE } = await import('./agentContext');
  const history = await buildAgentHistory({
    ...(options.conversationPath ? { conversationPath: options.conversationPath } : {}),
    providerUrl,
    catalogLen: catalog.length,
    goalLen: trimmedGoal.length,
    mcpReserve: mcpCandidate
      ? mcpScratchReserveChars(mcpScratchSlots, observationLimit) + MCP_CATALOG_RESERVE
      : 0,
  });
  const historyCost = historyPromptCost(history, providerUrl);

  const mcpBudget = mcpCandidate
    ? mcpCatalogBudgetChars(providerUrl, catalog.length, trimmedGoal.length, mcpScratchSlots, observationLimit, historyCost)
    : 0;
  const mcpSection = mcpBudget > 0 ? buildMcpCatalog(mcpIndex, mcpBudget) : { text: '', includedCount: 0, omitted: 0 };
  const mcpEnabled = mcpSection.includedCount > 0;
  if (mcpCandidate && !mcpEnabled) {
    const total = mcpIndex.handles.reduce((sum, server) => sum + server.tools.length, 0);
    sendLog(`⚠️ [Agent] ${total} MCP tool(s) hidden — ${providerLabel}'s input limit leaves no room for the catalog`);
  } else if (mcpEnabled && mcpSection.omitted > 0) {
    sendLog(`⚠️ [Agent] ${mcpSection.omitted} MCP tool(s) omitted — ${providerLabel}'s input limit fits only ${mcpSection.includedCount}`);
  }
  const catalogForPrompt = mcpEnabled
    ? `${catalog}\n\nMCP TOOLS (external tools from your connected servers; call with "call_mcp"):\n${mcpSection.text}`
    : catalog;
  const scratchSlots = mcpEnabled ? mcpScratchSlots : SCRATCH_IN_PROMPT;
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
  const signatures = new Map<string, number>();
  (options.resumeFrom ?? []).forEach((entry, index) => {
    if (entry.status === 'ok') signatures.set(callSignature(entry.tool, entry.config), index + 1);
  });
  const builtinCtx: BuiltinDeps = {
    deps,
    providerUrl,
    assessed: null,
    remainingMs,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onSaveFlow ? { saveFlow: options.onSaveFlow } : {}),
    ...(options.onConfirm ? { confirm: options.onConfirm } : {}),
  };

  let lastRawDecision = '';
  let staleReads = 0;

  let toolCalls = scratch.length;
  let consecutiveErrors = 0;
  const plan: AgentPlan = emptyPlan();
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

  for (let turn = scratch.length + 1; turn <= maxTurns; turn++) {
    if (options.signal?.aborted) throw new FlowAbortError();
    if (remainingMs() <= 0) break;
    if (scratch.length > 0 && overTokenCeiling()) break;

    const mustFinish = turn === maxTurns || remainingMs() < MIN_TURN_BUDGET_MS || overTokenBudget();
    const turnTimeoutMs = Math.max(10_000, Math.min(reasoningTimeoutMs, remainingMs()));
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

    if (!lean && decision.raw && decision.raw === lastRawDecision) {
      staleReads++;
      if (staleReads > MAX_STALE_READS) {
        throw new Error('The provider kept returning its previous answer — the conversation could not be advanced');
      }
      session.threadUrl = null;
      session.lost = false;
      sendLog(`♻️ [Agent] turn ${turn}: ${providerLabel} returned the previous answer verbatim — dropping the thread and retrying`);
      options.onTrace?.({ kind: 'stage', turn, label: 'repairing', detail: 'stale' });
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
    const bornComplete = planWasEmpty && scratch.length === 0;
    applyPlanUpdate(plan, action.plan, bornComplete ? undefined : action.planDone);
    if (plan.steps.length > 0) {
      options.onTrace?.({ kind: 'plan', steps: [...plan.steps], done: [...plan.done] });
    }
    if (planWasEmpty && plan.steps.length > 0) {
      sendLog(`🗂️ [Agent] plan: ${plan.steps.map((step, i) => `${i + 1}. ${step}`).join(' | ')}`);
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
      observation = repeatObservation(toolLabel, repeatedAt);
      turnStatus = 'error';
      sendLog(`🔁 [Agent] skipped a repeat of ${toolLabel} (identical to step ${repeatedAt})`);
    } else if (action.action === 'call_mcp') {
      const outcome = await runMcpCall(action, mcpIndex, mcpRegistry!, options.onConfirm, options.signal);
      observation = outcome.observation;
      turnStatus = outcome.status;
      if (turnStatus === 'error') sendLog(`⚠️ [Agent] ${toolLabel}: ${observation.slice(0, 160)}`);
    } else if (isHelpTool(action.tool ?? '')) {
      observation = describeToolSpec(recordConfig.tool ?? '');
      turnStatus = observation.startsWith('ERROR:') ? 'error' : 'ok';
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
  options.onTrace?.({ kind: 'synthesizing' });
  const synthTimeoutMs = Math.max(SYNTH_MIN_TIMEOUT_MS, Math.min(reasoningTimeoutMs, remainingMs()));
  if (plan.steps.length > 0 && !planComplete(plan)) {
    sendLog(`🗂️ [Agent] stopped with ${plan.done.length}/${plan.steps.length} plan items done — synthesizing from what it has`);
  }
  const final = await synthesizeFinal(trimmedGoal, scratch, providerUrl, deps, synthTimeoutMs, lean, scratchSlots, session, history, plan, options.signal);
  return { kind: 'answer', title: final.title, answer: final.content, toolCalls, turns: scratch.length };
}

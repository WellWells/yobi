import { isByokTargetUrl } from '../../../shared/types';
import type { SkillType } from '../../../shared/types';
import { byokConcurrencyCeiling } from '../../providers/byokClient';
import { Semaphore } from '../lanes';
import { HELPER_EXCLUDED_SKILLS, isHelpTool, validateAgentAction } from './agentTools';
import type { AgentAction, AgentToolScope } from './agentTools';
import { resolveMcpTool, validateMcpAction } from './mcpTools';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import { resolveToolContract } from './contractRegistry';
import { readPlanFields, readStepBudget } from './agentPrompts';
import { readIntent } from './actionGate';
import type { GoalIntent } from './actionGate';
import type { Validation } from './structuredLlm';

/**
 * The most calls one `call_tools` may carry. Three because a capped provider's full prompt — turn 1
 * and a thread-loss rebuild — shows the last three observations, and so does its synthesis: a
 * bigger batch would push its own first result out of view on exactly the providers that need it.
 */
export const MAX_BATCH_CALLS = 3;

export type BatchCall = AgentAction | McpAction;

export interface BatchAction {
  thought: string;
  action: 'call_tools';
  calls: BatchCall[];
  plan?: string[];
  planDone?: number[];
  stepsNeeded?: number;
  intent?: GoalIntent;
}

/**
 * Builders that write, or whose second call depends on the first (`build_flow` reads the assessment
 * `assess_flow` left behind). Neither belongs in a set of calls that run side by side.
 */
const SEQUENTIAL_BUILTINS = new Set<string>(['assess_flow', 'build_flow']);

export interface BatchValidationContext {
  scope: AgentToolScope;
  /** The run's connector index, or null when no connector tool made it into the prompt. */
  mcpIndex: McpRuntimeIndex | null;
}

function itemError(index: number, message: string): Validation<BatchCall> {
  return { ok: false, error: `calls[${index}]: ${message}` };
}

function validateItem(item: unknown, index: number, ctx: BatchValidationContext): Validation<BatchCall> {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return itemError(index, 'each call must be an object — {"tool", "config"} or {"server", "name", "arguments"}.');
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.server === 'string') {
    if (!ctx.mcpIndex) return itemError(index, 'this run has no MCP tools, so a call has no "server".');
    const checked = validateMcpAction({ server: obj.server, name: obj.name, arguments: obj.arguments }, ctx.mcpIndex);
    if (!checked.ok) return itemError(index, checked.error);
    const resolved = resolveMcpTool(ctx.mcpIndex, checked.value.server, checked.value.name);
    // Reads only. A change is proposed alone so the gate, its confirmation and its check each see
    // exactly one — the same reason `ask_user` and `finish` are not call shapes at all.
    if (!resolved || resolveToolContract(resolved.serverId, resolved.tool).risk(checked.value.arguments) !== 'read') {
      return itemError(index, `"${checked.value.name}" is not a (read) tool, and "call_tools" holds reads only — send it on its own with "call_mcp".`);
    }
    return checked;
  }
  const checked = validateAgentAction({ action: 'call_tool', thought: '', tool: obj.tool, config: obj.config }, false, ctx.scope);
  if (!checked.ok) return itemError(index, checked.error);
  const tool = checked.value.tool ?? '';
  if (isHelpTool(tool) || SEQUENTIAL_BUILTINS.has(tool) || HELPER_EXCLUDED_SKILLS.has(tool as SkillType)) {
    return itemError(index, `"${tool}" cannot run alongside other calls — send it on its own with "call_tool".`);
  }
  return checked;
}

/**
 * A batch of one is that one call, judged exactly as if it had been sent alone — so a single change
 * or a flow build passes here too. The model asked for something legal in a roundabout shape, and
 * a repair round trip to say so would cost more than the shape.
 */
function validateSingle(item: unknown, obj: Record<string, unknown>, ctx: BatchValidationContext): Validation<BatchCall> {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return validateItem(item, 0, ctx);
  const call = item as Record<string, unknown>;
  const bookkeeping = { thought: obj.thought, plan: obj.plan, plan_done: obj.plan_done, steps_needed: obj.steps_needed, intent: obj.intent };
  if (typeof call.server === 'string') {
    if (!ctx.mcpIndex) return itemError(0, 'this run has no MCP tools, so a call has no "server".');
    return validateMcpAction({ ...bookkeeping, server: call.server, name: call.name, arguments: call.arguments }, ctx.mcpIndex);
  }
  return validateAgentAction({ ...bookkeeping, action: 'call_tool', tool: call.tool, config: call.config }, false, ctx.scope);
}

/** A `call_tools` action: 2-3 independent reads, or one call of any kind. */
export function validateBatchAction(
  obj: Record<string, unknown>,
  ctx: BatchValidationContext,
): Validation<BatchAction | BatchCall> {
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  const raw = obj.calls;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: `"call_tools" needs "calls": an array of 2-${MAX_BATCH_CALLS} calls.` };
  }
  if (raw.length > MAX_BATCH_CALLS) {
    return { ok: false, error: `"call_tools" takes at most ${MAX_BATCH_CALLS} calls — send the rest in your next step.` };
  }
  if (raw.length === 1) return validateSingle(raw[0], obj, ctx);
  const calls: BatchCall[] = [];
  for (const [index, item] of raw.entries()) {
    const checked = validateItem(item, index, ctx);
    if (!checked.ok) return checked;
    calls.push(checked.value);
  }
  return {
    ok: true,
    value: { thought, action: 'call_tools', calls, ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj) },
  };
}

/** Tools whose work is model calls: they share one resource, the provider behind the run. */
const LLM_BACKED = new Set<string>(['research', 'llm', 'delegate']);

/**
 * What a call contends for. Calls on the same resource run one after another; different resources
 * run at once. A connector and an external service are never hit twice at once by one batch, which
 * is both the rate-limit rule and the collision rule — nothing in a batch shares a target.
 */
export function batchResource(call: BatchCall, mcpIndex: McpRuntimeIndex | null): string {
  if (call.action === 'call_mcp') return `mcp:${mcpIndex?.byHandle.get(call.server)?.serverId ?? call.server}`;
  const tool = call.tool ?? '';
  return LLM_BACKED.has(tool) ? 'llm' : `tool:${tool}`;
}

/**
 * How many model-backed calls may run at once. One on a web provider: its single worker window
 * serializes every model call anyway, and two helpers interleaved there would navigate between
 * their threads on every turn. On BYOK, one per usable key — the app-wide per-key slot in
 * `byokClient` is what actually holds the line; this only avoids starting work that would queue.
 */
export function llmConcurrency(providerUrl: string): number {
  if (!isByokTargetUrl(providerUrl)) return 1;
  return Math.max(1, Math.min(MAX_BATCH_CALLS, byokConcurrencyCeiling(providerUrl)));
}

/**
 * Runs `run(i)` for every item, at most `limit(resource)` at a time per resource, and returns the
 * results in the order given. Same-resource calls start in the order given, so identical calls in
 * one batch meet the repeat guard in a stable order.
 */
export async function runScheduled<T>(
  resources: readonly string[],
  limit: (resource: string) => number,
  run: (index: number) => Promise<T>,
): Promise<T[]> {
  const gates = new Map<string, Semaphore>();
  const gateFor = (resource: string): Semaphore => {
    let gate = gates.get(resource);
    if (!gate) {
      gate = new Semaphore(limit(resource));
      gates.set(resource, gate);
    }
    return gate;
  };
  return Promise.all(resources.map((resource, index) => gateFor(resource).runExclusive(() => run(index))));
}

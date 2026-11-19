import { namesToolId } from '../../../shared/agentStepLabel';
import { isByokGroupUrl, isByokTargetUrl } from '../../../shared/types';
import type { SkillType } from '../../../shared/types';
import { byokConcurrencyCeiling } from '../../providers/byokClient';
import { Semaphore } from '../lanes';
import { HELPER_EXCLUDED_SKILLS, isHelpTool, validateAgentAction } from './agentTools';
import type { AgentAction, AgentToolScope } from './agentTools';
import { connectorNamedAsTool, resolveMcpTool, validateMcpAction } from './mcpTools';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import { resolveToolContract } from './contractRegistry';
import { readDoing } from './agentDoing';
import { MAX_DELEGATE_BATCH_BYOK, readPlanFields, readStepBudget } from './agentPrompts';
import { readIntent } from './actionGate';
import type { GoalIntent } from './actionGate';
import type { Validation } from './structuredLlm';

/**
 * The most calls one `call_tools` may carry. Three because a capped provider's full prompt — turn 1
 * and a thread-loss rebuild — shows the last three observations, and so does its synthesis: a
 * bigger batch would push its own first result out of view on exactly the providers that need it.
 */
export const MAX_BATCH_CALLS = 3;
export { MAX_DELEGATE_BATCH_BYOK };

export type BatchCall = AgentAction | McpAction;

/**
 * An item of a batch that does not run: invalid, or past the limit. The others run; this one is
 * filed as its own error step at `index`, so the model reads which call failed and why — the way a
 * native tool call gets its own result.
 */
export interface SkippedCall {
  /** Its position in the `calls` the model wrote. */
  index: number;
  /** The tool name the model wrote (`mcp:<name>` for a connector item), shown on its row. */
  tool: string;
  error: string;
}

export interface BatchAction {
  thought: string;
  action: 'call_tools';
  /** The calls that run, in the model's order. */
  calls: BatchCall[];
  /** The items that do not run, by position. Absent when every item runs. */
  skipped?: SkippedCall[];
  plan?: string[];
  planDone?: number[];
  stepsNeeded?: number;
  intent?: GoalIntent;
  /** A title written for the whole batch instead of per item: the first step shows it. */
  doing?: string;
}

/**
 * Builders that write, or whose second call depends on the first (`build_flow` reads the assessment
 * `assess_flow` left behind), `run_flow` (a real run of the user's flow), and `draw_image` and `export_file`, whose picture or file is part of
 * the answer rather than a read. None belongs in a set of calls that run side by side.
 */
const SEQUENTIAL_BUILTINS = new Set<string>(['assess_flow', 'build_flow', 'edit_flow', 'run_flow', 'draw_image', 'export_file']);

export interface BatchValidationContext {
  scope: AgentToolScope;
  /** The run's connector index, or null when no connector tool made it into the prompt. */
  mcpIndex: McpRuntimeIndex | null;
  /**
   * How many calls a batch of nothing but `delegate` may hold (`delegateBatchLimit`); absent means
   * `MAX_BATCH_CALLS`. Only BYOK goes past three: it has no window of observations, so the reason
   * for three does not reach it — but no wider than its keys run at once.
   */
  delegateBatch?: number;
}

/** Every call in the batch is `delegate`: the only batch BYOK lets grow past `MAX_BATCH_CALLS`. */
export function isDelegateOnly(calls: readonly unknown[]): boolean {
  return calls.length > 0 && calls.every((call) => (
    typeof call === 'object' && call !== null && (call as { tool?: unknown }).tool === 'delegate'
    && typeof (call as { server?: unknown }).server !== 'string'
  ));
}

/**
 * The most delegates a delegate-only batch may hold in this run: wider than `MAX_BATCH_CALLS` only
 * with `delegate` in its scope. A BYOK helper batches its reads but has no `delegate`, so it is
 * neither offered nor allowed the width.
 */
function delegateWidth(ctx: BatchValidationContext): number {
  return ctx.scope.delegate === true ? Math.max(MAX_BATCH_CALLS, ctx.delegateBatch ?? MAX_BATCH_CALLS) : MAX_BATCH_CALLS;
}

/** How many calls this batch may hold. */
function batchLimit(calls: readonly unknown[], ctx: BatchValidationContext): number {
  return isDelegateOnly(calls) ? delegateWidth(ctx) : MAX_BATCH_CALLS;
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
    const checked = validateMcpAction({ server: obj.server, name: obj.name, arguments: obj.arguments, doing: obj.doing }, ctx.mcpIndex);
    if (!checked.ok) return itemError(index, checked.error);
    const resolved = resolveMcpTool(ctx.mcpIndex, checked.value.server, checked.value.name);
    // Reads only. A change is proposed alone so the gate, its confirmation and its check each see
    // exactly one — the same reason `ask_user` and `finish` are not call shapes at all.
    if (!resolved || resolveToolContract(resolved.serverId, resolved.tool).risk(checked.value.arguments) !== 'read') {
      return itemError(index, `"${checked.value.name}" is not a (read) tool, and "call_tools" holds reads only — send it on its own with "call_mcp".`);
    }
    return checked;
  }
  const checked = validateAgentAction({ action: 'call_tool', thought: '', tool: obj.tool, config: obj.config, doing: obj.doing }, false, ctx.scope);
  if (!checked.ok) return itemError(index, connectorNamedAsTool(ctx.mcpIndex, obj.tool) ?? checked.error);
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
  const bookkeeping = {
    thought: obj.thought, plan: obj.plan, plan_done: obj.plan_done, steps_needed: obj.steps_needed, intent: obj.intent,
    doing: call.doing ?? obj.doing,
  };
  if (typeof call.server === 'string') {
    if (!ctx.mcpIndex) return itemError(0, 'this run has no MCP tools, so a call has no "server".');
    return validateMcpAction({ ...bookkeeping, server: call.server, name: call.name, arguments: call.arguments }, ctx.mcpIndex);
  }
  const checked = validateAgentAction({ ...bookkeeping, action: 'call_tool', tool: call.tool, config: call.config }, false, ctx.scope);
  if (checked.ok) return checked;
  const hint = connectorNamedAsTool(ctx.mcpIndex, call.tool);
  return hint ? { ok: false, error: hint } : checked;
}

/** A title for the whole batch names none of its tools, the same as a title on a single call. */
function batchDoing(obj: Record<string, unknown>, calls: readonly BatchCall[]): { doing?: string } {
  const written = readDoing(obj, '');
  const line = written.doing ?? '';
  const named = calls.some((call) => namesToolId(line, call.action === 'call_mcp' ? call.name : call.tool ?? ''));
  return named ? {} : written;
}

/** The longest tool name a skipped row keeps: the model wrote it, and it is shown as written. */
const SKIPPED_NAME_MAX = 60;

/** The name the model wrote for an item, for the row of a call that did not run. */
function writtenName(item: unknown): string {
  const obj = typeof item === 'object' && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : {};
  const name = typeof obj.server === 'string'
    ? (typeof obj.name === 'string' && obj.name.trim() ? `mcp:${obj.name.trim()}` : 'call_mcp')
    : typeof obj.tool === 'string' && obj.tool.trim() ? obj.tool.trim() : 'call_tool';
  return name.slice(0, SKIPPED_NAME_MAX);
}

/**
 * A `call_tools` action: 2-3 independent reads, or one call of any kind. A batch of two or more
 * runs every valid item within the limit; the rest are carried as `skipped` (one bad item
 * rejecting the whole batch more than doubles the rejections). Only a batch with no valid item
 * is refused.
 */
export function validateBatchAction(
  obj: Record<string, unknown>,
  ctx: BatchValidationContext,
): Validation<BatchAction | BatchCall> {
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  const raw = obj.calls;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: `"call_tools" needs "calls": an array of 2-${MAX_BATCH_CALLS} calls.` };
  }
  if (raw.length === 1) return validateSingle(raw[0], obj, ctx);
  const limit = batchLimit(raw, ctx);
  const wide = delegateWidth(ctx);
  // Delegate width is named only to a run that has `delegate` and may go past three.
  const delegates = limit === MAX_BATCH_CALLS && wide > MAX_BATCH_CALLS ? ` (${wide} when every call is "delegate")` : '';
  const calls: BatchCall[] = [];
  const skipped: SkippedCall[] = [];
  let firstError = '';
  for (const [index, item] of raw.entries()) {
    if (index >= limit) {
      skipped.push({
        index, tool: writtenName(item),
        error: `not run: "call_tools" holds at most ${limit} calls here${delegates} — send it again in your next step.`,
      });
      continue;
    }
    const checked = validateItem(item, index, ctx);
    if (checked.ok) {
      calls.push(checked.value);
      continue;
    }
    firstError ||= checked.error;
    skipped.push({ index, tool: writtenName(item), error: `not run: ${checked.error}` });
  }
  if (calls.length === 0) {
    if (raw.length > limit) {
      return { ok: false, error: `"call_tools" takes at most ${limit} calls${delegates} — send the rest in your next step.` };
    }
    return { ok: false, error: firstError };
  }
  return {
    ok: true,
    value: {
      thought, action: 'call_tools', calls, ...(skipped.length > 0 ? { skipped } : {}),
      ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj), ...batchDoing(obj, calls),
    },
  };
}

/** Tools whose work is model calls: they share one resource, the provider behind the run. */
const LLM_BACKED = new Set<string>(['research', 'llm', 'delegate', 'agoda_reviews']);

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
 * A delegate-only batch on BYOK may run as wide as it may be long (`MAX_DELEGATE_BATCH_BYOK`).
 */
export function llmConcurrency(providerUrl: string, delegateOnly = false): number {
  if (!isByokTargetUrl(providerUrl)) return 1;
  const widest = delegateOnly ? MAX_DELEGATE_BATCH_BYOK : MAX_BATCH_CALLS;
  return Math.max(1, Math.min(widest, byokConcurrencyCeiling(providerUrl)));
}

/**
 * How many calls a batch of nothing but `delegate` may hold on this provider: as many as run at
 * once, never under `MAX_BATCH_CALLS` and never over `MAX_DELEGATE_BATCH_BYOK`. Five helpers on one
 * key run one after another, and the last ones would be left seconds of the run's time.
 */
export function delegateBatchLimit(providerUrl: string): number {
  // Only a key group runs more than one at a time; asked of every run, so a single key does not
  // look the group up.
  if (!isByokGroupUrl(providerUrl)) return MAX_BATCH_CALLS;
  return Math.min(MAX_DELEGATE_BATCH_BYOK, Math.max(MAX_BATCH_CALLS, llmConcurrency(providerUrl, true)));
}

/**
 * Each helper's time when a turn starts `helpers` model-backed calls `concurrency` at a time: an
 * even share of what the run has left, one share per wave, within the helper cap and never under
 * `floorMs`. Set when the batch starts — timed from when each one got its slot, the first helpers
 * took the whole cap and the last ones were left the floor.
 */
export function helperShareMs(remainingMs: number, capMs: number, helpers: number, concurrency: number, floorMs: number): number {
  const waves = Math.max(1, Math.ceil(helpers / Math.max(1, concurrency)));
  return Math.max(floorMs, Math.min(capMs, Math.floor(remainingMs / waves)));
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

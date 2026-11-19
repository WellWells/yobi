import type { FlowDefinition, TriggerType } from './types';
import { missingRequiredVariables } from './flowVariables';

/*
 * 「全部執行」 on a flow category: its flows one after another, in the category's order. What
 * iOS Shortcuts leaves to the user is decided here, the same way for the confirmation the
 * renderer shows and for the run main does: which flows cannot run from a button, and why.
 */

/**
 * Why a flow in the category is left out:
 * - `disabled`: switched off — off means "do not run", a batch does not overrule it.
 * - `needsInput`: it only starts with something handed to it (selected text, a command's words, a
 *   new file, a bot message); run from a button it would work on nothing.
 * - `needsSetup`: a required flow setting is empty; it would only fail.
 * - `busy`: already running or queued; a second copy would only fail as "already running".
 */
export type FlowBatchSkipReason = 'disabled' | 'needsInput' | 'needsSetup' | 'busy';

export const FLOW_BATCH_SKIP_REASONS: readonly FlowBatchSkipReason[] = ['disabled', 'needsInput', 'needsSetup', 'busy'];

/** Ways to start that need nothing handed in: a schedule, a button, a system event. */
const SELF_STARTING: ReadonlySet<TriggerType> = new Set<TriggerType>(['cron', 'manual', 'system']);

export interface FlowBatchSkip {
  flowId: string;
  reason: FlowBatchSkipReason;
}

export interface FlowBatchPlan {
  /** In the category's order. */
  run: string[];
  skipped: FlowBatchSkip[];
}

/** Whether the flow starts with nothing handed to it by any of its triggers. */
export function startsOnItsOwn(flow: FlowDefinition): boolean {
  return [flow.trigger, ...(flow.extraTriggers ?? [])].some((trigger) => SELF_STARTING.has(trigger.type));
}

/** Why this flow would be left out of a batch now; null = it runs. */
export function batchSkipReason(flow: FlowDefinition, busy: boolean): FlowBatchSkipReason | null {
  if (!flow.enabled) return 'disabled';
  if (!startsOnItsOwn(flow)) return 'needsInput';
  if (missingRequiredVariables(flow).length > 0) return 'needsSetup';
  if (busy) return 'busy';
  return null;
}

/** `flows`: the category's flows in its order (`flows.json`'s); unknown ids are not in it. */
export function planFlowBatch(flows: readonly FlowDefinition[], isBusy: (flowId: string) => boolean): FlowBatchPlan {
  const run: string[] = [];
  const skipped: FlowBatchSkip[] = [];
  for (const flow of flows) {
    const reason = batchSkipReason(flow, isBusy(flow.id));
    if (reason) skipped.push({ flowId: flow.id, reason });
    else run.push(flow.id);
  }
  return { run, skipped };
}

/** One category's batch, as main broadcasts it while it runs and once more when it ends. */
export interface FlowFolderRunState {
  folder: string;
  /** The flows it set out to run, in order. */
  flowIds: string[];
  /** How many of them have ended (succeeded, failed, or were skipped once their turn came). */
  done: number;
  succeeded: string[];
  failed: string[];
  /** Left out when their turn came (switched off, started elsewhere meanwhile, deleted), or stopped on their own. */
  skipped: string[];
  /** The one running now. */
  currentFlowId?: string;
  finished: boolean;
  /** Ended by the user's stop. */
  stopped: boolean;
}

export type FlowFolderRunStartResult =
  | { ok: true; state: FlowFolderRunState }
  | { ok: false; reason: 'running' | 'nothing' | 'unknownFolder' };

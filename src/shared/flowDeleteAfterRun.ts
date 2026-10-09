import type { FlowDefinition, FlowExecutionResult } from './types';
import { resolveScheduleMode } from './flowScheduleCore';

/**
 * Only a flow whose single trigger is a one-time schedule may delete itself: deleting a flow
 * that also has a hotkey or a bot command would take those with it.
 */
export function deleteAfterRunAllowed(flow: Pick<FlowDefinition, 'trigger' | 'extraTriggers'>): boolean {
  return flow.trigger.type === 'cron'
    && resolveScheduleMode(flow.trigger) === 'once'
    && (flow.extraTriggers?.length ?? 0) === 0;
}

/**
 * Read at the end of a run the one-time schedule started, against the flow as it is then (the
 * option may have been switched off meanwhile). Anything short of a clean success keeps the flow,
 * so its result and error stay where the user can read them and run it again: a failure, a stop,
 * and a run whose fail-soft steps skipped items alike.
 */
export function shouldDeleteAfterRun(
  flow: Pick<FlowDefinition, 'trigger' | 'extraTriggers'>,
  result: Pick<FlowExecutionResult, 'success' | 'aborted' | 'softFailures'>,
): boolean {
  return deleteAfterRunAllowed(flow)
    && flow.trigger.deleteAfterRun === true
    && result.success
    && !result.aborted
    && (result.softFailures ?? 0) === 0;
}

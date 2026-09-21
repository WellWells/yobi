import type { FlowErrorSample, FlowMetricsSnapshot, FlowRunMetrics } from '../shared/flowMetrics';
import {
  MAX_ERROR_SAMPLES,
  MAX_SAMPLE_CHARS,
  MAX_TRACKED_FLOWS,
  classifyFlowError,
  zeroFlowRun,
  zeroFlowStep,
} from '../shared/flowMetrics';
import { maskSecrets } from './flow/agent/secretMask';
import type { FlowRunEvent, FlowStepEvent } from './flowMeter';

/**
 * Pure counter arithmetic, deliberately separate from the store that holds it: the suite can
 * run a whole flow's worth of events through these without `electron-store` resolving a path
 * into the developer's own config directory.
 */

/** Index of today's entry in what `flowEntries` returns; the lifetime total follows it. */
const DAILY_ENTRY = 0;

/**
 * Both tallies for one flow: today's entry and the lifetime one. Returns nothing when the flow
 * is new and the ceiling is already reached, which drops the event rather than growing the file
 * without bound.
 */
function flowEntries(data: FlowMetricsSnapshot, today: string, flowId: string): FlowRunMetrics[] {
  const day = data.daily[today] ?? {};
  data.daily[today] = day;
  const known = flowId in data.flows || flowId in day;
  if (!known && Object.keys(data.flows).length >= MAX_TRACKED_FLOWS) return [];
  const lifetime = data.flows[flowId] ?? zeroFlowRun();
  data.flows[flowId] = lifetime;
  const daily = day[flowId] ?? zeroFlowRun();
  day[flowId] = daily;
  return [daily, lifetime];
}

/** Masked and flattened before it is stored, never at display time. */
export function sampleMessage(raw: string): string {
  const masked = maskSecrets(raw, true).replace(/\s+/g, ' ').trim();
  return masked.length > MAX_SAMPLE_CHARS ? `${masked.slice(0, MAX_SAMPLE_CHARS)}…` : masked;
}

function pushSample(samples: FlowErrorSample[], sample: FlowErrorSample): void {
  samples.unshift(sample);
  if (samples.length > MAX_ERROR_SAMPLES) samples.length = MAX_ERROR_SAMPLES;
}

export function applyStepEvent(
  data: FlowMetricsSnapshot,
  today: string,
  event: FlowStepEvent,
  at: string,
): void {
  const reason = event.outcome === 'ok' ? null : classifyFlowError(event.type, event.error);
  const entries = flowEntries(data, today, event.flowId);

  for (const [index, flow] of entries.entries()) {
    const step = flow.steps[event.stepId] ?? zeroFlowStep(event.type);
    // A step edited to a different skill keeps its id; the type follows the live definition.
    step.type = event.type;
    flow.steps[event.stepId] = step;
    step[event.outcome] += 1;
    // Counted for every outcome: a step creeping towards its timeout is the warning sign.
    step.durationMsTotal += Math.max(0, Math.trunc(event.durationMs));
    step.durationRuns += 1;
    if (!reason) continue;
    step.reasons[reason] = (step.reasons[reason] ?? 0) + 1;
    // Message text lives only in the daily entry (index 0), so it expires with the retention
    // window. On the lifetime total it would be error text nothing ever deletes.
    if (index === DAILY_ENTRY) {
      pushSample(step.samples, { at, reason, message: sampleMessage(event.error ?? '') });
    }
  }
}

export function applyRunEvent(data: FlowMetricsSnapshot, today: string, event: FlowRunEvent): void {
  for (const flow of flowEntries(data, today, event.flowId)) {
    flow.runs[event.outcome] += 1;
    if (event.degraded) flow.degraded += 1;
  }
}

export function pruneDailyBefore(daily: FlowMetricsSnapshot['daily'], cutoff: string): void {
  for (const date of Object.keys(daily)) {
    if (date < cutoff) delete daily[date];
  }
}

/**
 * Counters for a flow or a step the user has deleted are dead weight the UI can never label, so
 * they go when the definition does — the contract `pruneOrphanCheckpoints` already has.
 */
export function pruneDeadEntries(
  data: FlowMetricsSnapshot,
  activeFlowIds: Set<string>,
  activeStepIds: Set<string>,
): boolean {
  let changed = false;

  function sweep(flows: Record<string, FlowRunMetrics>): void {
    for (const [flowId, flow] of Object.entries(flows)) {
      if (!activeFlowIds.has(flowId)) {
        delete flows[flowId];
        changed = true;
        continue;
      }
      for (const stepId of Object.keys(flow.steps)) {
        if (activeStepIds.has(stepId)) continue;
        delete flow.steps[stepId];
        changed = true;
      }
    }
  }

  sweep(data.flows);
  for (const day of Object.values(data.daily)) sweep(day);
  return changed;
}

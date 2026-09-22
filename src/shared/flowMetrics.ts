import type { MetricCounts, SkillType } from './types';
import type { FlowErrorReason } from './flowErrorReason';

export { FLOW_ERROR_REASONS, classifyFlowError } from './flowErrorReason';
export type { FlowErrorReason } from './flowErrorReason';

/**
 * Three states, because two were hiding the majority of real failures. A step that fails with
 * `emitFailFlag` set is recorded `completed` by the executor and the run still reports success,
 * so on the old counters a flow that silently dropped every article read as 100% healthy.
 */
export type FlowStepOutcome = 'ok' | 'soft' | 'hard';

export interface FlowErrorSample {
  /** ISO timestamp. */
  at: string;
  reason: FlowErrorReason;
  /** Masked and truncated; never the raw throw. */
  message: string;
}

export interface FlowStepMetrics {
  type: SkillType;
  ok: number;
  /** Failed but the flow carried on (`emitFailFlag`). */
  soft: number;
  /** Failed and ended the run. */
  hard: number;
  /** Only non-zero buckets are stored. */
  reasons: Partial<Record<FlowErrorReason, number>>;
  durationMsTotal: number;
  durationRuns: number;
  samples: FlowErrorSample[];
}

export interface FlowRunMetrics {
  /** Run-level outcome keeps its existing meaning, so the headline success rate stays comparable. */
  runs: MetricCounts;
  /** Runs that finished but lost at least one step on the way. */
  degraded: number;
  steps: Record<string, FlowStepMetrics>;
}

export interface FlowMetricsSnapshot {
  /** Lifetime totals, keyed by flow id. */
  flows: Record<string, FlowRunMetrics>;
  /** `YYYY-MM-DD` → flow id → counters. */
  daily: Record<string, Record<string, FlowRunMetrics>>;
  /** `YYYY-MM-DD` of the first recorded day; empty until something is recorded. */
  since: string;
}

/** Enough to see the pattern and the latest message without turning the store into a log. */
export const MAX_ERROR_SAMPLES = 3;
export const MAX_SAMPLE_CHARS = 200;
/** A ceiling on unbounded growth, not a product limit: nobody runs 200 distinct flows a month. */
export const MAX_TRACKED_FLOWS = 200;
export const FLOW_METRICS_RETENTION_DAYS = 30;

/**
 * Block markers only — they close a structure and cannot fail on their own, so counting their
 * successes would add a row per flow that always reads the same. `comment` is deliberately not
 * here: it interpolates a value the rest of the flow consumes, so it is a step like any other.
 */
export const METRIC_SILENT_STEP_TYPES: ReadonlySet<SkillType> = new Set<SkillType>([
  'end_loop',
  'end_if',
]);

export function zeroFlowStep(type: SkillType): FlowStepMetrics {
  return { type, ok: 0, soft: 0, hard: 0, reasons: {}, durationMsTotal: 0, durationRuns: 0, samples: [] };
}

export function zeroFlowRun(): FlowRunMetrics {
  return { runs: { success: 0, failure: 0, timeout: 0 }, degraded: 0, steps: {} };
}

export function emptyFlowMetrics(): FlowMetricsSnapshot {
  return { flows: {}, daily: {}, since: '' };
}

/** The reason bucket with the most hits, used as the one-word diagnosis on a step row. */
export function topReason(reasons: Partial<Record<FlowErrorReason, number>>): FlowErrorReason | null {
  let best: FlowErrorReason | null = null;
  let bestCount = 0;
  for (const [reason, count] of Object.entries(reasons) as [FlowErrorReason, number][]) {
    if (count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }
  return best;
}

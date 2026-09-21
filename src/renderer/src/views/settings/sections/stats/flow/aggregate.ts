import type { FlowDefinition, MetricCounts, SkillType } from '../../../../../../../shared/types';
import type {
  FlowErrorReason,
  FlowErrorSample,
  FlowMetricsSnapshot,
  FlowRunMetrics,
} from '../../../../../../../shared/flowMetrics';
import { topReason } from '../../../../../../../shared/flowMetrics';

export interface StepRow {
  flowId: string;
  flowName: string;
  stepId: string;
  label: string;
  type: SkillType;
  ok: number;
  soft: number;
  hard: number;
  failures: number;
  runs: number;
  reasons: Partial<Record<FlowErrorReason, number>>;
  reason: FlowErrorReason | null;
  avgMs: number;
  latest: FlowErrorSample | null;
}

export interface FlowRow {
  flowId: string;
  name: string;
  runs: MetricCounts;
  runTotal: number;
  degraded: number;
  failures: number;
  steps: StepRow[];
}

export interface FlowStatsAggregate {
  flows: FlowRow[];
  /** Every step that failed at least once, worst first — the answer to "what is breaking". */
  issues: StepRow[];
  totalRuns: number;
  totalFailures: number;
  degradedRuns: number;
}

function zeroRun(): FlowRunMetrics {
  return { runs: { success: 0, failure: 0, timeout: 0 }, degraded: 0, steps: {} };
}

function mergeFlow(target: FlowRunMetrics, source: FlowRunMetrics): void {
  target.runs.success += source.runs.success;
  target.runs.failure += source.runs.failure;
  target.runs.timeout += source.runs.timeout;
  target.degraded += source.degraded;
  for (const [stepId, step] of Object.entries(source.steps)) {
    const current = target.steps[stepId] ?? {
      type: step.type,
      ok: 0,
      soft: 0,
      hard: 0,
      reasons: {},
      durationMsTotal: 0,
      durationRuns: 0,
      samples: [],
    };
    current.type = step.type;
    current.ok += step.ok;
    current.soft += step.soft;
    current.hard += step.hard;
    current.durationMsTotal += step.durationMsTotal;
    current.durationRuns += step.durationRuns;
    for (const [reason, count] of Object.entries(step.reasons) as [FlowErrorReason, number][]) {
      current.reasons[reason] = (current.reasons[reason] ?? 0) + count;
    }
    current.samples = [...current.samples, ...step.samples];
    target.steps[stepId] = current;
  }
}

function toIsoDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Labels come from the live flow definitions, never from the store, so a renamed step reads
 * correctly and a deleted one simply stops being listed — the same contract the key stats have
 * with deleted BYOK keys.
 */
export function aggregateFlowStats(
  snapshot: FlowMetricsSnapshot | null,
  flows: FlowDefinition[],
  rangeDays: number,
  today: Date = new Date(),
): FlowStatsAggregate {
  const merged = new Map<string, FlowRunMetrics>();
  for (let offset = rangeDays - 1; offset >= 0; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const entry = snapshot?.daily[toIsoDate(day)];
    if (!entry) continue;
    for (const [flowId, counters] of Object.entries(entry)) {
      const target = merged.get(flowId) ?? zeroRun();
      mergeFlow(target, counters);
      merged.set(flowId, target);
    }
  }

  const result: FlowStatsAggregate = {
    flows: [],
    issues: [],
    totalRuns: 0,
    totalFailures: 0,
    degradedRuns: 0,
  };

  for (const flow of flows) {
    const counters = merged.get(flow.id);
    if (!counters) continue;
    const runTotal = counters.runs.success + counters.runs.failure + counters.runs.timeout;
    const steps: StepRow[] = [];
    for (const step of flow.steps) {
      const stats = counters.steps[step.id];
      if (!stats) continue;
      const failures = stats.soft + stats.hard;
      const samples = [...stats.samples].sort((a, b) => b.at.localeCompare(a.at));
      steps.push({
        flowId: flow.id,
        flowName: flow.name,
        stepId: step.id,
        label: step.label,
        type: stats.type,
        ok: stats.ok,
        soft: stats.soft,
        hard: stats.hard,
        failures,
        runs: stats.ok + failures,
        reasons: stats.reasons,
        reason: topReason(stats.reasons),
        avgMs: stats.durationRuns > 0 ? Math.round(stats.durationMsTotal / stats.durationRuns) : 0,
        latest: samples[0] ?? null,
      });
    }
    steps.sort((a, b) => b.failures - a.failures || b.runs - a.runs);
    const failures = steps.reduce((sum, step) => sum + step.failures, 0);

    result.flows.push({
      flowId: flow.id,
      name: flow.name,
      runs: counters.runs,
      runTotal,
      degraded: counters.degraded,
      failures,
      steps,
    });
    result.totalRuns += runTotal;
    result.totalFailures += failures;
    result.degradedRuns += counters.degraded;
    result.issues.push(...steps.filter((step) => step.failures > 0));
  }

  result.flows.sort((a, b) => b.failures - a.failures || b.runTotal - a.runTotal);
  result.issues.sort((a, b) => b.failures - a.failures || b.runs - a.runs);
  return result;
}

export function flowSuccessRate(row: FlowRow): number {
  return row.runTotal > 0 ? row.runs.success / row.runTotal : 0;
}

/** Seconds once past a second: a step that averages 47 s is the story, not 47,231 ms. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1_000) return `${ms} ms`;
  const seconds = ms / 1_000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

import type { MetricCounts, SkillType } from '../shared/types';
import type {
  FlowErrorReason,
  FlowErrorSample,
  FlowMetricsSnapshot,
  FlowRunMetrics,
  FlowStepMetrics,
} from '../shared/flowMetrics';
import { FLOW_ERROR_REASONS, MAX_ERROR_SAMPLES, zeroFlowRun } from '../shared/flowMetrics';
import { toCount } from './metricsNormalize';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const REASON_SET = new Set<string>(FLOW_ERROR_REASONS);

function asObject(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
}

function normalizeCounts(raw: unknown): MetricCounts {
  const obj = asObject(raw);
  return { success: toCount(obj.success), failure: toCount(obj.failure), timeout: toCount(obj.timeout) };
}

function normalizeReasons(raw: unknown): Partial<Record<FlowErrorReason, number>> {
  const reasons: Partial<Record<FlowErrorReason, number>> = {};
  for (const [key, value] of Object.entries(asObject(raw))) {
    if (!REASON_SET.has(key)) continue;
    const count = toCount(value);
    if (count > 0) reasons[key as FlowErrorReason] = count;
  }
  return reasons;
}

function normalizeSamples(raw: unknown): FlowErrorSample[] {
  if (!Array.isArray(raw)) return [];
  const samples: FlowErrorSample[] = [];
  for (const entry of raw) {
    const obj = asObject(entry);
    const message = typeof obj.message === 'string' ? obj.message : '';
    const reason = typeof obj.reason === 'string' && REASON_SET.has(obj.reason) ? obj.reason as FlowErrorReason : 'other';
    const at = typeof obj.at === 'string' ? obj.at : '';
    if (!message && !at) continue;
    samples.push({ at, reason, message });
    if (samples.length >= MAX_ERROR_SAMPLES) break;
  }
  return samples;
}

function normalizeStep(raw: unknown): FlowStepMetrics | null {
  const obj = asObject(raw);
  const type = typeof obj.type === 'string' ? obj.type as SkillType : null;
  if (!type) return null;
  return {
    type,
    ok: toCount(obj.ok),
    soft: toCount(obj.soft),
    hard: toCount(obj.hard),
    reasons: normalizeReasons(obj.reasons),
    durationMsTotal: toCount(obj.durationMsTotal),
    durationRuns: toCount(obj.durationRuns),
    samples: normalizeSamples(obj.samples),
  };
}

function normalizeFlow(raw: unknown): FlowRunMetrics {
  const obj = asObject(raw);
  const flow = zeroFlowRun();
  flow.runs = normalizeCounts(obj.runs);
  flow.degraded = toCount(obj.degraded);
  for (const [stepId, entry] of Object.entries(asObject(obj.steps))) {
    if (!stepId) continue;
    const step = normalizeStep(entry);
    if (step) flow.steps[stepId] = step;
  }
  return flow;
}

function normalizeFlowMap(raw: unknown): Record<string, FlowRunMetrics> {
  const flows: Record<string, FlowRunMetrics> = {};
  for (const [flowId, entry] of Object.entries(asObject(raw))) {
    if (flowId) flows[flowId] = normalizeFlow(entry);
  }
  return flows;
}

function normalizeSince(raw: unknown, daily: Record<string, unknown>): string {
  if (typeof raw === 'string' && DATE_KEY.test(raw)) return raw;
  return Object.keys(daily).sort()[0] ?? '';
}

/**
 * The store is user-writable JSON on disk, so every read is treated as untrusted: an unknown
 * reason key, a step with no type, or a hand-edited number all normalize away rather than
 * reaching the renderer.
 */
export function normalizeFlowSnapshot(raw: unknown): FlowMetricsSnapshot {
  const obj = asObject(raw);
  const daily: Record<string, Record<string, FlowRunMetrics>> = {};
  for (const [date, entry] of Object.entries(asObject(obj.daily))) {
    if (!DATE_KEY.test(date)) continue;
    daily[date] = normalizeFlowMap(entry);
  }
  return {
    flows: normalizeFlowMap(obj.flows),
    daily,
    since: normalizeSince(obj.since, daily),
  };
}

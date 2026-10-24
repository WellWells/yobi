import Store from 'electron-store';
import dayjs from 'dayjs';
import { IPC } from '../shared/types';
import type { FlowMetricsSnapshot } from '../shared/flowMetrics';
import { FLOW_METRICS_RETENTION_DAYS, emptyFlowMetrics } from '../shared/flowMetrics';
import { normalizeFlowSnapshot } from './flowMetricsNormalize';
import { applyRunEvent, applyStepEvent, pruneDailyBefore, pruneDeadEntries } from './flowMetricsApply';
import { config, getConfigDir } from './config';
import { sendToRenderer } from './helpers';
import { getLangCache } from './i18n';
import { localizeFlowSnapshot } from './flowMetricsDisplay';
import { setFlowMeterSinks } from './flowMeter';
import type { FlowRunEvent, FlowStepEvent } from './flowMeter';

/**
 * Its own file rather than a branch of `metrics.json`: a flow with a five-item loop writes a
 * step counter fifty times a run, and folding that into the snapshot that also carries token
 * and key totals would re-serialize the whole thing on every one of those writes.
 */
const store = new Store<FlowMetricsSnapshot>({
  name: 'flow-metrics',
  cwd: getConfigDir(),
  defaults: emptyFlowMetrics(),
  clearInvalidConfig: true,
});

/** Same bargain as `metrics.ts`: a few seconds of counters is an acceptable loss on a hard kill. */
const FLUSH_DELAY_MS = 5_000;

let pending: FlowMetricsSnapshot | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function getFlowMetricsSnapshot(): FlowMetricsSnapshot {
  return pending ?? normalizeFlowSnapshot(store.store);
}

/** What the statistics page reads: error samples in the user's language (`flowMetricsDisplay`). */
export function getFlowMetricsView(): FlowMetricsSnapshot {
  return localizeFlowSnapshot(getFlowMetricsSnapshot(), getLangCache());
}

function broadcast(data: FlowMetricsSnapshot): void {
  sendToRenderer(IPC.FLOW_METRICS_CHANGED, localizeFlowSnapshot(data, getLangCache()));
}

/**
 * Re-sends the page's copy after the language pack changed: Settings stays open across a language
 * switch, and the page only re-reads on open or on a flush, so the samples would keep the old language.
 */
export function rebroadcastFlowMetrics(): void {
  broadcast(getFlowMetricsSnapshot());
}

export function flushFlowMetrics(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const data = pending;
  pending = null;
  if (!data) return;
  try {
    store.store = data;
  } catch (err: unknown) {
    console.warn(`[flow-metrics] failed to persist: ${err instanceof Error ? err.message : String(err)}`);
  }
  broadcast(data);
}

function scheduleFlush(data: FlowMetricsSnapshot): void {
  pending = data;
  if (flushTimer) return;
  flushTimer = setTimeout(flushFlowMetrics, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

function mutate(apply: (data: FlowMetricsSnapshot, today: string) => void, label: string): void {
  if (!config.metricsEnabled) return;
  try {
    const data = getFlowMetricsSnapshot();
    const today = dayjs().format('YYYY-MM-DD');
    apply(data, today);
    if (!data.since) data.since = today;
    pruneDailyBefore(data.daily, dayjs().subtract(FLOW_METRICS_RETENTION_DAYS, 'day').format('YYYY-MM-DD'));
    scheduleFlush(data);
  } catch (err: unknown) {
    console.warn(`[flow-metrics] failed to record ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function onStep(event: FlowStepEvent): void {
  mutate((data, today) => applyStepEvent(data, today, event, new Date().toISOString()), `step/${event.outcome}`);
}

function onRun(event: FlowRunEvent): void {
  mutate((data, today) => applyRunEvent(data, today, event), `run/${event.outcome}`);
}

export function pruneFlowMetrics(activeFlowIds: Set<string>, activeStepIds: Set<string>): void {
  try {
    const data = getFlowMetricsSnapshot();
    if (pruneDeadEntries(data, activeFlowIds, activeStepIds)) scheduleFlush(data);
  } catch (err: unknown) {
    console.warn(`[flow-metrics] failed to prune: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function resetFlowMetrics(): FlowMetricsSnapshot {
  const data = emptyFlowMetrics();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pending = null;
  try {
    store.store = data;
  } catch (err: unknown) {
    console.warn(`[flow-metrics] failed to reset: ${err instanceof Error ? err.message : String(err)}`);
    return getFlowMetricsSnapshot();
  }
  broadcast(data);
  return data;
}

setFlowMeterSinks({ onStep, onRun });

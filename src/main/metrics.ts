import Store from 'electron-store';
import dayjs from 'dayjs';
import { IPC } from '../shared/types';
import type { DailyMetricCounts, MetricCounts, MetricDomain, MetricOutcome, MetricsSnapshot } from '../shared/types';
import { config, getConfigDir } from './config';
import { sendToRenderer } from './helpers';

const DAILY_RETENTION_DAYS = 30;

function zeroCounts(): MetricCounts {
  return { success: 0, failure: 0, timeout: 0 };
}

function emptyMetrics(): MetricsSnapshot {
  return { chat: zeroCounts(), flow: zeroCounts(), daily: {} };
}

const store = new Store<MetricsSnapshot>({
  name: 'metrics',
  cwd: getConfigDir(),
  defaults: emptyMetrics(),
  clearInvalidConfig: true,
});

const recordedTasks = new WeakSet<object>();

function toCount(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function normalizeCounts(raw: unknown): MetricCounts {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<MetricCounts>) : {};
  return { success: toCount(obj.success), failure: toCount(obj.failure), timeout: toCount(obj.timeout) };
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const raw = store.store as Partial<MetricsSnapshot>;
  const daily: Record<string, DailyMetricCounts> = {};
  const rawDaily = (raw.daily && typeof raw.daily === 'object') ? raw.daily : {};
  for (const [date, entry] of Object.entries(rawDaily)) {
    const obj = (entry && typeof entry === 'object') ? (entry as Partial<DailyMetricCounts>) : {};
    daily[date] = { chat: normalizeCounts(obj.chat), flow: normalizeCounts(obj.flow) };
  }
  return { chat: normalizeCounts(raw.chat), flow: normalizeCounts(raw.flow), daily };
}

export function classifyFailure(errorMessage: string | undefined): Exclude<MetricOutcome, 'success'> {
  return /timed out|timeout/i.test(errorMessage ?? '') ? 'timeout' : 'failure';
}

function pruneDaily(daily: Record<string, DailyMetricCounts>): void {
  const cutoff = dayjs().subtract(DAILY_RETENTION_DAYS, 'day').format('YYYY-MM-DD');
  for (const date of Object.keys(daily)) {
    if (date < cutoff) delete daily[date];
  }
}

export function recordTaskOutcome(domain: MetricDomain, outcome: MetricOutcome, dedupeRef?: object): void {
  if (!config.metricsEnabled) return;
  if (dedupeRef) {
    if (recordedTasks.has(dedupeRef)) return;
    recordedTasks.add(dedupeRef);
  }

  try {
    const data = getMetricsSnapshot();
    data[domain][outcome] += 1;
    const today = dayjs().format('YYYY-MM-DD');
    const entry = data.daily[today] ?? { chat: zeroCounts(), flow: zeroCounts() };
    entry[domain][outcome] += 1;
    data.daily[today] = entry;
    pruneDaily(data.daily);
    store.store = data;
    sendToRenderer(IPC.METRICS_CHANGED, data);
  } catch (err: unknown) {
    console.warn(`[metrics] failed to record ${domain}/${outcome}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function resetMetrics(): MetricsSnapshot {
  const data = emptyMetrics();
  try {
    store.store = data;
  } catch (err: unknown) {
    console.warn(`[metrics] failed to reset: ${err instanceof Error ? err.message : String(err)}`);
    return getMetricsSnapshot();
  }
  sendToRenderer(IPC.METRICS_CHANGED, data);
  return data;
}

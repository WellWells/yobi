import Store from 'electron-store';
import dayjs from 'dayjs';
import { IPC } from '../shared/types';
import type { DailyMetricCounts, MetricDomain, MetricOutcome, MetricsSnapshot } from '../shared/types';
import { emptyDailyEntry, emptyMetrics, normalizeSnapshot, toCount } from './metricsNormalize';
import { config, getConfigDir } from './config';
import { sendToRenderer } from './helpers';
import { setTokenSink } from './tokenMeter';

const DAILY_RETENTION_DAYS = 30;

const store = new Store<MetricsSnapshot>({
  name: 'metrics',
  cwd: getConfigDir(),
  defaults: emptyMetrics(),
  clearInvalidConfig: true,
});

const recordedTasks = new WeakSet<object>();

export function getMetricsSnapshot(): MetricsSnapshot {
  return normalizeSnapshot(store.store);
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
    const entry = data.daily[today] ?? emptyDailyEntry();
    entry[domain][outcome] += 1;
    data.daily[today] = entry;
    pruneDaily(data.daily);
    store.store = data;
    sendToRenderer(IPC.METRICS_CHANGED, data);
  } catch (err: unknown) {
    console.warn(`[metrics] failed to record ${domain}/${outcome}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function recordTokenUsage(input: number, output: number): void {
  if (!config.metricsEnabled) return;
  const inTokens = toCount(input);
  const outTokens = toCount(output);
  if (inTokens === 0 && outTokens === 0) return;

  try {
    const data = getMetricsSnapshot();
    data.tokens.input += inTokens;
    data.tokens.output += outTokens;
    const today = dayjs().format('YYYY-MM-DD');
    const entry = data.daily[today] ?? emptyDailyEntry();
    entry.tokens.input += inTokens;
    entry.tokens.output += outTokens;
    data.daily[today] = entry;
    pruneDaily(data.daily);
    store.store = data;
    sendToRenderer(IPC.METRICS_CHANGED, data);
  } catch (err: unknown) {
    console.warn(`[metrics] failed to record tokens: ${err instanceof Error ? err.message : String(err)}`);
  }
}

setTokenSink(recordTokenUsage);

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

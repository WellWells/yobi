import Store from 'electron-store';
import dayjs from 'dayjs';
import { IPC } from '../shared/types';
import type {
  DailyMetricCounts,
  KeyMetrics,
  MetricDomain,
  MetricOutcome,
  MetricsSnapshot,
  TokenCounts,
} from '../shared/types';
import { emptyDailyEntry, emptyMetrics, normalizeSnapshot, toCount, zeroKey } from './metricsNormalize';
import { config, getConfigDir } from './config';
import { sendToRenderer } from './helpers';
import { setTokenSink } from './tokenMeter';
import { currentMetricDomain, setLlmMeterSinks } from './llmMeter';

export { classifyFailure } from './metricsNormalize';

const DAILY_RETENTION_DAYS = 30;

const store = new Store<MetricsSnapshot>({
  name: 'metrics',
  cwd: getConfigDir(),
  defaults: emptyMetrics(),
  clearInvalidConfig: true,
});

const recordedTasks = new WeakSet<object>();

/**
 * A single model call now records three things (tokens, the request, the key that served it),
 * and an `/agent` run makes dozens of calls. Writing the whole store and broadcasting to the
 * renderer on each one would be the same JSON serialized to disk sixty times a run, so edits
 * accumulate in memory and land together. Losing at most half a second of counters on a hard
 * kill is the right trade for a local usage log.
 */
const FLUSH_DELAY_MS = 500;

let pending: MetricsSnapshot | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function getMetricsSnapshot(): MetricsSnapshot {
  return pending ?? normalizeSnapshot(store.store);
}

export function flushMetrics(): void {
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
    console.warn(`[metrics] failed to persist: ${err instanceof Error ? err.message : String(err)}`);
  }
  sendToRenderer(IPC.METRICS_CHANGED, data);
}

function scheduleFlush(data: MetricsSnapshot): void {
  pending = data;
  if (flushTimer) return;
  flushTimer = setTimeout(flushMetrics, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

function pruneDaily(daily: Record<string, DailyMetricCounts>): void {
  const cutoff = dayjs().subtract(DAILY_RETENTION_DAYS, 'day').format('YYYY-MM-DD');
  for (const date of Object.keys(daily)) {
    if (date < cutoff) delete daily[date];
  }
}

/**
 * Every counter follows the same path: read, mutate today's entry and the lifetime totals
 * through one callback, prune, write, broadcast. Callers only describe the increment.
 */
function mutate(apply: (today: DailyMetricCounts, total: MetricsSnapshot) => void, label: string): void {
  if (!config.metricsEnabled) return;
  try {
    const data = getMetricsSnapshot();
    const today = dayjs().format('YYYY-MM-DD');
    const entry = data.daily[today] ?? emptyDailyEntry();
    apply(entry, data);
    data.daily[today] = entry;
    if (!data.since) data.since = today;
    pruneDaily(data.daily);
    scheduleFlush(data);
  } catch (err: unknown) {
    console.warn(`[metrics] failed to record ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** One thing the user started: a queued chat task, or a whole flow run. */
export function recordTaskOutcome(domain: MetricDomain, outcome: MetricOutcome, dedupeRef?: object): void {
  if (!config.metricsEnabled) return;
  if (dedupeRef) {
    if (recordedTasks.has(dedupeRef)) return;
    recordedTasks.add(dedupeRef);
  }
  mutate((today, total) => {
    today[domain].runs[outcome] += 1;
    total[domain].runs[outcome] += 1;
  }, `${domain}/${outcome}`);
}

/** One round trip to a model, attributed to the run that made it. */
export function recordLlmRequest(domain: MetricDomain, outcome: MetricOutcome): void {
  mutate((today, total) => {
    today[domain].requests[outcome] += 1;
    total[domain].requests[outcome] += 1;
  }, `request/${domain}/${outcome}`);
}

export function recordTokenUsage(input: number, output: number): void {
  const inTokens = toCount(input);
  const outTokens = toCount(output);
  if (inTokens === 0 && outTokens === 0) return;
  const domain = currentMetricDomain();
  mutate((today, total) => {
    addTokens(today.tokens, inTokens, outTokens);
    addTokens(total.tokens, inTokens, outTokens);
    if (!domain) return;
    addTokens(today[domain].tokens, inTokens, outTokens);
    addTokens(total[domain].tokens, inTokens, outTokens);
  }, 'tokens');
}

function addTokens(target: TokenCounts, input: number, output: number): void {
  target.input += input;
  target.output += output;
}

function keyEntry(bucket: Record<string, KeyMetrics>, keyId: string): KeyMetrics {
  const existing = bucket[keyId] ?? zeroKey();
  bucket[keyId] = existing;
  return existing;
}

/** One attempt against one BYOK key — a failover request records several. */
export function recordKeyResult(keyId: string, outcome: MetricOutcome, tokens: TokenCounts | null): void {
  const domain = currentMetricDomain();
  mutate((today, total) => {
    for (const bucket of keyBuckets(today, total, domain)) {
      const entry = keyEntry(bucket, keyId);
      entry.requests[outcome] += 1;
      if (tokens) addTokens(entry.tokens, toCount(tokens.input), toCount(tokens.output));
    }
  }, `key/${outcome}`);
}

export function recordKeyCooldown(keyId: string): void {
  const domain = currentMetricDomain();
  mutate((today, total) => {
    for (const bucket of keyBuckets(today, total, domain)) {
      keyEntry(bucket, keyId).cooldowns += 1;
    }
  }, 'key/cooldown');
}

/** Key totals mirror token totals: an unscoped call lands in the day total and nowhere else. */
function keyBuckets(
  today: DailyMetricCounts,
  total: MetricsSnapshot,
  domain: MetricDomain | null,
): Record<string, KeyMetrics>[] {
  const buckets = [today.keys, total.keys];
  if (domain) buckets.push(today[domain].keys, total[domain].keys);
  return buckets;
}

setTokenSink(recordTokenUsage);

setLlmMeterSinks({
  onRequest: recordLlmRequest,
  onKeyResult: recordKeyResult,
  onKeyCooldown: recordKeyCooldown,
});

export function resetMetrics(): MetricsSnapshot {
  const data = emptyMetrics();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pending = null;
  try {
    store.store = data;
  } catch (err: unknown) {
    console.warn(`[metrics] failed to reset: ${err instanceof Error ? err.message : String(err)}`);
    return getMetricsSnapshot();
  }
  sendToRenderer(IPC.METRICS_CHANGED, data);
  return data;
}

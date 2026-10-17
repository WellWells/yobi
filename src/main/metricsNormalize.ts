import type {
  DailyMetricCounts,
  DomainMetrics,
  DownloadCounts,
  KeyMetrics,
  MetricCounts,
  MetricOutcome,
  MetricsSnapshot,
  TokenCounts,
} from '../shared/types';

export function zeroCounts(): MetricCounts {
  return { success: 0, failure: 0, timeout: 0 };
}

export function zeroTokens(): TokenCounts {
  return { input: 0, output: 0 };
}

export function zeroDomain(): DomainMetrics {
  return { runs: zeroCounts(), requests: zeroCounts(), tokens: zeroTokens(), keys: {} };
}

export function zeroKey(): KeyMetrics {
  return { requests: zeroCounts(), tokens: zeroTokens(), cooldowns: 0 };
}

export function emptyDailyEntry(): DailyMetricCounts {
  return { chat: zeroDomain(), agent: zeroDomain(), flow: zeroDomain(), tokens: zeroTokens(), keys: {}, downloads: {} };
}

export function emptyMetrics(): MetricsSnapshot {
  return {
    chat: zeroDomain(),
    agent: zeroDomain(),
    flow: zeroDomain(),
    tokens: zeroTokens(),
    keys: {},
    downloads: {},
    daily: {},
    since: '',
  };
}

export function classifyFailure(errorMessage: string | undefined): Exclude<MetricOutcome, 'success'> {
  return /timed out|timeout/i.test(errorMessage ?? '') ? 'timeout' : 'failure';
}

export function toCount(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function asObject(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
}

function normalizeCounts(raw: unknown): MetricCounts {
  const obj = asObject(raw);
  return { success: toCount(obj.success), failure: toCount(obj.failure), timeout: toCount(obj.timeout) };
}

function normalizeTokens(raw: unknown): TokenCounts {
  const obj = asObject(raw);
  return { input: toCount(obj.input), output: toCount(obj.output) };
}

/** A store without Downloader counts reads as no downloads. */
function normalizeDownloads(raw: unknown): Record<string, DownloadCounts> {
  const downloads: Record<string, DownloadCounts> = {};
  for (const [site, entry] of Object.entries(asObject(raw))) {
    const obj = asObject(entry);
    if (site) downloads[site] = { success: toCount(obj.success), failure: toCount(obj.failure) };
  }
  return downloads;
}

function normalizeKeys(raw: unknown): Record<string, KeyMetrics> {
  const keys: Record<string, KeyMetrics> = {};
  for (const [id, entry] of Object.entries(asObject(raw))) {
    if (id) keys[id] = normalizeKey(entry);
  }
  return keys;
}

/**
 * Stores written before the run/request split held a bare `{success, failure, timeout}` per
 * domain. Those counts were run-level, so they migrate into `runs` and leave `requests` at
 * zero rather than being double-counted or dropped.
 */
function normalizeDomain(raw: unknown): DomainMetrics {
  const obj = asObject(raw);
  const legacy = obj.runs === undefined
    && (obj.success !== undefined || obj.failure !== undefined || obj.timeout !== undefined);
  return {
    runs: normalizeCounts(legacy ? obj : obj.runs),
    requests: normalizeCounts(obj.requests),
    tokens: normalizeTokens(obj.tokens),
    keys: normalizeKeys(obj.keys),
  };
}

function normalizeKey(raw: unknown): KeyMetrics {
  const obj = asObject(raw);
  return {
    requests: normalizeCounts(obj.requests),
    tokens: normalizeTokens(obj.tokens),
    cooldowns: toCount(obj.cooldowns),
  };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSince(raw: unknown, daily: Record<string, DailyMetricCounts>): string {
  if (typeof raw === 'string' && DATE_KEY.test(raw)) return raw;
  const dates = Object.keys(daily).sort();
  return dates[0] ?? '';
}

/** A legacy store without an `agent` key reads as zero agent runs rather than failing to load. */
export function normalizeSnapshot(raw: unknown): MetricsSnapshot {
  const obj = asObject(raw);
  const daily: Record<string, DailyMetricCounts> = {};
  for (const [date, entry] of Object.entries(asObject(obj.daily))) {
    if (!DATE_KEY.test(date)) continue;
    const day = asObject(entry);
    daily[date] = {
      chat: normalizeDomain(day.chat),
      agent: normalizeDomain(day.agent),
      flow: normalizeDomain(day.flow),
      tokens: normalizeTokens(day.tokens),
      keys: normalizeKeys(day.keys),
      downloads: normalizeDownloads(day.downloads),
    };
  }
  return {
    chat: normalizeDomain(obj.chat),
    agent: normalizeDomain(obj.agent),
    flow: normalizeDomain(obj.flow),
    tokens: normalizeTokens(obj.tokens),
    keys: normalizeKeys(obj.keys),
    downloads: normalizeDownloads(obj.downloads),
    daily,
    since: normalizeSince(obj.since, daily),
  };
}

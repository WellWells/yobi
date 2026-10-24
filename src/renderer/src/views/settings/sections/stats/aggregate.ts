import type {
  DomainMetrics,
  DownloadCounts,
  KeyMetrics,
  MetricCounts,
  MetricDomain,
  MetricOutcome,
  MetricsSnapshot,
} from '../../../../../../shared/types';
import type { FlowMetricsSnapshot } from '../../../../../../shared/flowMetrics';
import { toIsoDate } from '../../../../../../shared/localTime';

export const RANGE_DAYS = [3, 7, 14, 30] as const;
export const DEFAULT_RANGE_DAYS = 7;

export const SCOPES = ['all', 'chat', 'agent', 'flow'] as const;
export type StatsScope = (typeof SCOPES)[number];

export const OUTCOME_KEYS = ['success', 'failure', 'timeout'] as const;

/** Display order of the per-domain breakdowns, matching the scope filter. */
export const DOMAINS: readonly MetricDomain[] = ['chat', 'agent', 'flow'];

function zero(): MetricCounts {
  return { success: 0, failure: 0, timeout: 0 };
}

function addInto(target: MetricCounts, source: MetricCounts): void {
  for (const key of OUTCOME_KEYS) target[key] += source[key];
}

export function sumCounts(counts: MetricCounts): number {
  return counts.success + counts.failure + counts.timeout;
}

function mergeKeys(target: Record<string, KeyMetrics>, source: Record<string, KeyMetrics>): void {
  for (const [id, entry] of Object.entries(source)) {
    const current = target[id] ?? { requests: zero(), tokens: { input: 0, output: 0 }, cooldowns: 0 };
    addInto(current.requests, entry.requests);
    current.tokens.input += entry.tokens.input;
    current.tokens.output += entry.tokens.output;
    current.cooldowns += entry.cooldowns;
    target[id] = current;
  }
}

function mergeDownloads(result: StatsAggregate, source: Record<string, DownloadCounts>): void {
  for (const [site, entry] of Object.entries(source)) {
    const current = result.downloads[site] ?? { success: 0, failure: 0 };
    current.success += entry.success;
    current.failure += entry.failure;
    result.downloads[site] = current;
    result.downloadTotals.success += entry.success;
    result.downloadTotals.failure += entry.failure;
  }
}

export interface DomainSplit {
  runs: number;
  requests: number;
}

export interface StatsAggregate {
  labels: string[];
  /** Day-by-day counts for the stacked chart, in `OUTCOME_KEYS` order. */
  runsByDay: Record<MetricOutcome, number[]>;
  tokensByDay: { input: number[]; output: number[] };
  runs: MetricCounts;
  runTotal: number;
  requests: MetricCounts;
  requestTotal: number;
  tokens: { input: number; output: number };
  split: Record<MetricDomain, DomainSplit>;
  keys: Record<string, KeyMetrics>;
  /** Downloader uses by link-site id; not split by scope, every one runs as a flow step. */
  downloads: Record<string, DownloadCounts>;
  downloadTotals: DownloadCounts;
}

/**
 * `all` reads the day's own token total rather than summing the domains: it also covers
 * calls made outside a run and days written before domain attribution existed, which would
 * otherwise read as zero.
 */
export function aggregateStats(
  snapshot: MetricsSnapshot | null,
  rangeDays: number,
  scope: StatsScope,
  today: Date = new Date(),
): StatsAggregate {
  const scoped: readonly MetricDomain[] = scope === 'all' ? DOMAINS : [scope];
  const result: StatsAggregate = {
    labels: [],
    runsByDay: { success: [], failure: [], timeout: [] },
    tokensByDay: { input: [], output: [] },
    runs: zero(),
    runTotal: 0,
    requests: zero(),
    requestTotal: 0,
    tokens: { input: 0, output: 0 },
    split: {
      chat: { runs: 0, requests: 0 },
      agent: { runs: 0, requests: 0 },
      flow: { runs: 0, requests: 0 },
    },
    keys: {},
    downloads: {},
    downloadTotals: { success: 0, failure: 0 },
  };

  for (let offset = rangeDays - 1; offset >= 0; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const iso = toIsoDate(day);
    result.labels.push(iso.slice(5).replace('-', '/'));

    const entry = snapshot?.daily[iso];
    const domains: DomainMetrics[] = scoped.map((domain) => entry?.[domain] ?? emptyDomain());

    for (const key of OUTCOME_KEYS) {
      const runs = domains.reduce((sum, domain) => sum + domain.runs[key], 0);
      result.runsByDay[key].push(runs);
      result.runs[key] += runs;
      result.requests[key] += domains.reduce((sum, domain) => sum + domain.requests[key], 0);
    }

    const dayTokens = scope === 'all'
      ? (entry?.tokens ?? { input: 0, output: 0 })
      : { input: domains[0].tokens.input, output: domains[0].tokens.output };
    result.tokensByDay.input.push(dayTokens.input);
    result.tokensByDay.output.push(dayTokens.output);
    result.tokens.input += dayTokens.input;
    result.tokens.output += dayTokens.output;

    mergeKeys(result.keys, scope === 'all' ? (entry?.keys ?? {}) : domains[0].keys);
    mergeDownloads(result, entry?.downloads ?? {});

    for (const domain of DOMAINS) {
      const slice = entry?.[domain];
      if (!slice) continue;
      result.split[domain].runs += sumCounts(slice.runs);
      result.split[domain].requests += sumCounts(slice.requests);
    }
  }

  result.runTotal = sumCounts(result.runs);
  result.requestTotal = sumCounts(result.requests);
  return result;
}

/**
 * Whether anything is recorded at all, whatever the selected range: the daily entries expire
 * after 30 days, but the lifetime totals stay until the user clears them.
 */
export function hasStoredStats(snapshot: MetricsSnapshot | null, flowSnapshot: FlowMetricsSnapshot | null): boolean {
  if (flowSnapshot && (flowSnapshot.since || Object.keys(flowSnapshot.flows).length > 0)) return true;
  if (!snapshot) return false;
  if (snapshot.since || Object.keys(snapshot.daily).length > 0) return true;
  const lifetime = DOMAINS.some((domain) => sumCounts(snapshot[domain].runs) + sumCounts(snapshot[domain].requests) > 0);
  return lifetime
    || snapshot.tokens.input + snapshot.tokens.output > 0
    || Object.keys(snapshot.keys).length > 0
    || Object.keys(snapshot.downloads).length > 0;
}

function emptyDomain(): DomainMetrics {
  return { runs: zero(), requests: zero(), tokens: { input: 0, output: 0 }, keys: {} };
}

export function formatShare(value: number, total: number): string {
  if (total <= 0) return '—';
  const raw = (value / total) * 100;
  const rounded = Math.round(raw);
  if (raw > 0 && rounded === 0) return '<1%';
  return `${rounded}%`;
}

/** Requests per run — the number that separates "I asked once" from "the agent looped 20 times". */
export function perRun(requests: number, runs: number): string {
  if (runs <= 0) return '—';
  return (Math.round((requests / runs) * 10) / 10).toFixed(1);
}

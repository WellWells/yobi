import type { DailyMetricCounts, MetricCounts, MetricsSnapshot, TokenCounts } from '../shared/types';

export function zeroCounts(): MetricCounts {
  return { success: 0, failure: 0, timeout: 0 };
}

export function zeroTokens(): TokenCounts {
  return { input: 0, output: 0 };
}

export function emptyDailyEntry(): DailyMetricCounts {
  return { chat: zeroCounts(), flow: zeroCounts(), tokens: zeroTokens() };
}

export function emptyMetrics(): MetricsSnapshot {
  return { chat: zeroCounts(), flow: zeroCounts(), tokens: zeroTokens(), daily: {} };
}

export function toCount(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function normalizeCounts(raw: unknown): MetricCounts {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<MetricCounts>) : {};
  return { success: toCount(obj.success), failure: toCount(obj.failure), timeout: toCount(obj.timeout) };
}

function normalizeTokens(raw: unknown): TokenCounts {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<TokenCounts>) : {};
  return { input: toCount(obj.input), output: toCount(obj.output) };
}

export function normalizeSnapshot(raw: unknown): MetricsSnapshot {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<MetricsSnapshot>) : {};
  const daily: Record<string, DailyMetricCounts> = {};
  const rawDaily = (obj.daily && typeof obj.daily === 'object') ? obj.daily : {};
  for (const [date, entry] of Object.entries(rawDaily)) {
    const day = (entry && typeof entry === 'object') ? (entry as Partial<DailyMetricCounts>) : {};
    daily[date] = {
      chat: normalizeCounts(day.chat),
      flow: normalizeCounts(day.flow),
      tokens: normalizeTokens(day.tokens),
    };
  }
  return {
    chat: normalizeCounts(obj.chat),
    flow: normalizeCounts(obj.flow),
    tokens: normalizeTokens(obj.tokens),
    daily,
  };
}

/**
 * Date-range resolution for the `line_read` skill.
 *
 * Pure and offline: takes the step's config strings plus `now` and returns epoch-ms bounds.
 * Day arithmetic goes through the LOCAL calendar (`new Date(y, m, d - 6)`) rather than
 * millisecond subtraction, so a DST transition cannot shift a window by an hour.
 */

import { isLineRangePreset, LINE_RANGE_PRESETS } from '../../../shared/lineRange';

// Façade: the vocabulary lives in shared/ so the step editor offers exactly what this resolves.
export { isLineRangePreset, LINE_RANGE_PRESETS };
export type { LineRangePreset } from '../../../shared/lineRange';

export interface ResolvedRange {
  /** Inclusive lower bound, epoch ms; null = no floor. */
  sinceMs: number | null;
  /** Inclusive upper bound, epoch ms; null = no ceiling (the caller clamps to now). */
  untilMs: number | null;
}

export interface LineRangeConfig {
  range?: string;
  since?: string;
  until?: string;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function startOfDay(at: Date, dayOffset = 0): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + dayOffset).getTime();
}

function endOfDay(at: Date, dayOffset = 0): number {
  return startOfDay(at, dayOffset + 1) - 1;
}

/**
 * Parses a `yyyy-mm-dd` config value as a local calendar day.
 *
 * A bad date THROWS rather than degrading to "no bound": every line_read failure mode already
 * reads as "no messages", and a step that silently widened to all time on a typo would look
 * exactly like a busy day, forever.
 */
function parseDay(value: string, field: string): Date {
  const parts = DATE_ONLY.exec(value);
  if (!parts) throw new Error(`the LINE date-range ${field} must look like 2026-09-01, got "${value}"`);
  const [year, month, day] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
  const at = new Date(year, month, day);
  // new Date(2026, 1, 31) rolls into March instead of failing, so round-trip the parts.
  if (at.getFullYear() !== year || at.getMonth() !== month || at.getDate() !== day) {
    throw new Error(`the LINE date-range ${field} is not a real date: "${value}"`);
  }
  return at;
}

export function resolveLineRange(config: LineRangeConfig, now: Date): ResolvedRange {
  const preset = (config.range ?? '').trim() || 'all';
  if (!isLineRangePreset(preset)) {
    throw new Error(`unknown LINE date range "${preset}" — use one of: ${LINE_RANGE_PRESETS.join(', ')}`);
  }
  if (preset === 'all') return { sinceMs: null, untilMs: null };
  if (preset === 'today') return { sinceMs: startOfDay(now), untilMs: null };
  if (preset === 'yesterday') return { sinceMs: startOfDay(now, -1), untilMs: endOfDay(now, -1) };
  // Counted in calendar days INCLUDING today, so "last 7 days" on a Sunday starts on Monday.
  if (preset === 'last7d') return { sinceMs: startOfDay(now, -6), untilMs: null };
  if (preset === 'last30d') return { sinceMs: startOfDay(now, -29), untilMs: null };

  const since = (config.since ?? '').trim();
  const until = (config.until ?? '').trim();
  // A custom range with both ends blank is a half-filled form, not a request for everything.
  if (!since && !until) {
    throw new Error('the LINE date range is set to "custom" but neither a start nor an end date was given');
  }
  const sinceMs = since ? startOfDay(parseDay(since, 'start')) : null;
  const untilMs = until ? endOfDay(parseDay(until, 'end')) : null;
  if (sinceMs !== null && untilMs !== null && sinceMs > untilMs) {
    throw new Error(`the LINE date range ends before it starts (${since} → ${until})`);
  }
  return { sinceMs, untilMs };
}

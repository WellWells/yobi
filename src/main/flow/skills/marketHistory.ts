import { FlowUserError } from '../userError';
import { BROWSER_UA, fetchJson } from './skillFetch';
import { addDays, epochSecOf } from './dateSpan';
import { MAX_HISTORY_YEARS, readHistoryWindow, type HistoryRequest } from '../../../shared/lookupDateWindows';
import { exchangeDateOf, exchangeOffsetSec, marketSession, utcOffsetLabel } from './quoteTime';
import type { YahooMeta } from './quoteTime';
import { parseNumberField } from './numberField';

export { MAX_HISTORY_YEARS, type HistoryRequest };
/** Calendar days fetched before the window, so "the close on or before" survives a Lunar New Year closure. */
export const HISTORY_LOOKBACK_DAYS = 21;

function badPeriod(value: string): FlowUserError {
  return new FlowUserError(
    'flow.error.marketPeriod', { value },
    `Cannot read the period "${value}". Use 5d, 1mo, 6mo, 1y, ytd, a start date, or YYYY-MM-DD..YYYY-MM-DD.`,
  );
}

export function badMarketDate(value: string): FlowUserError {
  const years = String(MAX_HISTORY_YEARS);
  return new FlowUserError(
    'flow.error.marketDate', { value, years },
    `Cannot use the date "${value}". Use YYYY-MM-DD, today or earlier, within the last ${years} years.`,
  );
}

/**
 * null when both fields are blank: the step then runs exactly as it did before they existed. The
 * reading itself is `readHistoryWindow`, which the step editor runs too.
 */
export function readHistoryRequest(config: Record<string, string>, now: Date): HistoryRequest | null {
  const window = readHistoryWindow(config, now);
  if (window.ok) return window.request;
  throw window.reason === 'period' ? badPeriod(window.value) : badMarketDate(window.value);
}

export interface HistoryBar { date: string; close: number; volume: number | null }

export interface HistoryData { meta: YahooMeta; bars: HistoryBar[]; intradayLast: boolean }

interface ChartResult {
  meta?: YahooMeta;
  timestamp?: unknown[];
  indicators?: { quote?: Array<Record<string, unknown[] | undefined>> };
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Daily bars dated in the exchange's own calendar. Yahoo pads a holiday with a flat, zero-volume
 * bar (O=H=L=C, volume 0), dropped when the series trades volume at all —
 * FX has no volume, so its bars all stay.
 */
export function cleanBars(result: ChartResult, nowSec: number): HistoryData {
  const meta = result.meta ?? {};
  const q = result.indicators?.quote?.[0] ?? {};
  const raw = (result.timestamp ?? []).map((ts, i) => ({
    ts: finite(ts),
    open: finite(q.open?.[i]), high: finite(q.high?.[i]), low: finite(q.low?.[i]),
    close: finite(q.close?.[i]), volume: finite(q.volume?.[i]),
  }));
  const hasVolume = raw.some((b) => (b.volume ?? 0) > 0);
  const byDate = new Map<string, HistoryBar>();
  for (const b of raw) {
    if (b.ts === null || b.close === null) continue;
    const flat = b.open === b.close && b.high === b.close && b.low === b.close;
    if (hasVolume && !b.volume && flat) continue;
    const date = exchangeDateOf(meta, b.ts);
    byDate.delete(date);
    byDate.set(date, { date, close: b.close, volume: b.volume });
  }
  const bars = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const traded = parseNumberField(meta.regularMarketTime);
  const last = bars.at(-1);
  const intradayLast = !!last && traded !== null && marketSession(meta, nowSec) === 'open'
    && last.date === exchangeDateOf(meta, traded);
  return { meta, bars, intradayLast };
}

/** Yahoo answered that it has no such symbol, as opposed to not answering at all. */
export const HISTORY_NOT_FOUND = 'not-found';

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'Not Found';
}

/**
 * The bars, HISTORY_NOT_FOUND when Yahoo said it has no such symbol (HTTP 404, "No data found"),
 * or null when it could not be reached.
 */
export async function fetchHistory(
  symbol: string, req: HistoryRequest, timeoutMs: number, nowSec: number,
): Promise<HistoryData | typeof HISTORY_NOT_FOUND | null> {
  const period1 = epochSecOf(addDays(req.fetchFrom, -HISTORY_LOOKBACK_DAYS));
  const period2 = epochSecOf(addDays(req.fetchTo, 2));
  let notFound = false;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
      const data = await fetchJson(url, timeoutMs, { 'User-Agent': BROWSER_UA }) as { chart?: { error?: unknown; result?: ChartResult[] } };
      const result = data.chart?.result?.[0];
      if (!data.chart?.error && result?.meta) return cleanBars(result, nowSec);
      if (isNotFound(data.chart?.error)) notFound = true;
    } catch (err) {
      if (err instanceof Error && err.message === 'HTTP 404') notFound = true;
    }
  }
  return notFound ? HISTORY_NOT_FOUND : null;
}

/**
 * Decimals for history values: at least `min`, and enough for six significant figures of the
 * smallest close, so a 0.03 rate shown at a display precision of 2 still moves.
 */
export function historyDecimals(bars: HistoryBar[], min: number): number {
  const closes = bars.map((b) => Math.abs(b.close)).filter((v) => v > 0);
  if (closes.length === 0) return min;
  const smallest = closes.reduce((a, b) => (b < a ? b : a));
  return Math.min(12, Math.max(min, 5 - Math.floor(Math.log10(smallest))));
}

/** Per-symbol series points: 30 for one symbol, fewer as symbols share the observation. */
export function historySeriesCap(symbols: number): number {
  return symbols <= 1 ? 30 : Math.max(6, Math.floor(36 / symbols));
}

/** Evenly spaced points, first and last kept, the high and low added; at most cap + 2. */
export function downsample<T extends { close: number }>(bars: T[], cap: number): T[] {
  if (cap <= 0) return [];
  if (bars.length <= cap) return bars;
  const picked = new Set<number>();
  for (let i = 0; i < cap; i++) picked.add(Math.round(i * (bars.length - 1) / Math.max(1, cap - 1)));
  let hi = 0;
  let lo = 0;
  bars.forEach((b, i) => {
    if (b.close > bars[hi].close) hi = i;
    if (b.close < bars[lo].close) lo = i;
  });
  picked.add(hi).add(lo);
  return [...picked].sort((a, b) => a - b).map((i) => bars[i]);
}

export interface SummaryOptions {
  decimals: number;
  seriesCap: number;
  nowSec: number;
  /** Forex: the pair's quote ("TWD per 1 USD") and the amount `at.converted` multiplies. */
  quote?: string;
  amount?: number;
  /** Decimals of `at.converted`, the display precision; history values use `decimals`. */
  amountDecimals?: number;
}

export interface HistorySummary {
  json: Record<string, unknown>;
  startClose: number;
  endClose: number;
  changePct: number | null;
  dateClose: number | null;
}

/** The last day the window may show: today, or the exchange's today when it is already ahead. */
export function windowEnd(req: HistoryRequest, meta: YahooMeta, nowSec: number): string {
  if (!req.openEnd) return req.to;
  const exchangeToday = exchangeDateOf(meta, nowSec);
  return exchangeToday > req.to ? exchangeToday : req.to;
}

/** Whether the requested date has come for this exchange: on or before its today, or the computer's. */
export function dateReached(req: HistoryRequest, meta: YahooMeta, nowSec: number): boolean {
  return !req.date || req.date <= windowEnd({ ...req, to: req.fetchTo, openEnd: true }, meta, nowSec);
}

function lastOnOrBefore(bars: HistoryBar[], date: string): HistoryBar | null {
  let found: HistoryBar | null = null;
  for (const b of bars) {
    if (b.date > date) break;
    found = b;
  }
  return found;
}

/**
 * The window's figures, all computed here rather than by the model. `start` is the close on or
 * before `from` — the same rule as `at` — so a period starting on the requested date gives the
 * same change as `at.changePctToEnd`, and the window's first day of movement is counted.
 * A window without a trading day (a weekend, a holiday run, today before the open) shows the last
 * close before it, labelled; null only when no bar exists on or before the window's end.
 */
export function summarizeHistory(data: HistoryData, req: HistoryRequest, opts: SummaryOptions): HistorySummary | null {
  const to = windowEnd(req, data.meta, opts.nowSec);
  const before = lastOnOrBefore(data.bars, req.from < to ? req.from : to);
  let window = data.bars.filter((b) => b.date >= req.from && b.date <= to);
  const noTradingDay = window.length === 0;
  if (noTradingDay) {
    if (!before) return null;
    window = [before];
  }
  const r = (v: number): number => Number(v.toFixed(opts.decimals));
  const pct = (a: number, b: number): number | null => (a ? Number(((b - a) / a * 100).toFixed(2)) : null);
  const start = before ?? window[0];
  const end = window[window.length - 1];
  // The fetched series may run past the window (a closed span, a date after it): only a window
  // ending on that intraday bar is labelled intraday.
  const intraday = data.intradayLast && !noTradingDay && end === data.bars[data.bars.length - 1];
  let high = window[0];
  let low = window[0];
  for (const b of window) {
    if (b.close > high.close) high = b;
    if (b.close < low.close) low = b;
  }
  const pair = (b: HistoryBar): [string, number] => [b.date, r(b.close)];
  const zone = typeof data.meta.exchangeTimezoneName === 'string' ? data.meta.exchangeTimezoneName : '';
  const offset = utcOffsetLabel(exchangeOffsetSec(data.meta, opts.nowSec));
  const json: Record<string, unknown> = {
    source: 'Yahoo Finance',
    from: req.from,
    to,
    timezone: zone ? `${zone} (${offset})` : offset,
    points: noTradingDay ? 0 : window.length,
    values: intraday ?'daily closes; the last is today\'s intraday price' : 'daily closes',
  };
  if (noTradingDay) json.note = `no trading day from ${req.from} to ${to}; the latest value before it is shown`;
  if (opts.quote) json.quote = opts.quote;
  Object.assign(json, {
    start: pair(start), end: pair(end),
    change: r(end.close - start.close), changePct: pct(start.close, end.close),
    high: pair(high), low: pair(low),
  });
  if (data.bars.some((b) => (b.volume ?? 0) > 0)) {
    const total = noTradingDay ? 0 : window.reduce((sum, b) => sum + (b.volume ?? 0), 0);
    json.volume = { total, dailyAvg: noTradingDay ? 0 : Math.round(total / window.length) };
  }
  let dateClose: number | null = null;
  if (req.date) {
    const at = lastOnOrBefore(data.bars, req.date);
    dateClose = at ? r(at.close) : null;
    json.at = at
      ? {
          requested: req.date, date: at.date, close: r(at.close),
          changeToEnd: r(end.close - at.close), changePctToEnd: pct(at.close, end.close),
          ...(opts.amount !== undefined
            ? { converted: Number((opts.amount * at.close).toFixed(opts.amountDecimals ?? opts.decimals)) }
            : {}),
        }
      : { requested: req.date, date: null, close: null };
  }
  const series = noTradingDay ? [] : downsample(window, opts.seriesCap);
  if (series.length > 0) json.series = series.map(pair);
  return {
    json,
    startClose: r(start.close),
    endClose: r(end.close),
    changePct: pct(start.close, end.close),
    dateClose,
  };
}

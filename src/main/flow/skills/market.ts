import { sendLog } from '../../helpers';
import { clampIntField, parseNumberField } from './numberField';
import { BROWSER_UA, envelope, fetchJson } from './skillFetch';
import { formatUtcStamp, marketSession, quoteTimeOf } from './quoteTime';
import type { MarketSession } from './quoteTime';
import {
  badMarketDate, dateReached, fetchHistory, HISTORY_NOT_FOUND, historyDecimals, historySeriesCap, readHistoryRequest,
  summarizeHistory,
} from './marketHistory';
import type { HistoryData, HistoryRequest, HistorySummary } from './marketHistory';
import { splitSymbols } from '../../../shared/flowListTerms';

interface ForexResult {
  base: string; target: string; rate: number; amount: number; converted: number; asOf: string;
  previousClose: number | null; session: MarketSession;
}

function forexFields(r: ForexResult, precision: number): { json: Record<string, unknown>; subVars: Record<string, string> } {
  const rate = Number(r.rate.toFixed(precision));
  const converted = Number(r.converted.toFixed(precision));
  const hasPrev = r.previousClose !== null && r.previousClose > 0;
  const previousClose = hasPrev ? String(Number(r.previousClose!.toFixed(precision))) : '';
  const changePct = hasPrev
    ? String(Number((((r.rate - r.previousClose!) / r.previousClose!) * 100).toFixed(4)))
    : '';
  return {
    json: {
      base: r.base, target: r.target, rate, amount: r.amount, converted, asOf: r.asOf, session: r.session,
      previousClose, changePct,
    },
    subVars: {
      rate: String(rate),
      converted: String(converted),
      amount: String(r.amount),
      base: r.base,
      target: r.target,
      asOf: r.asOf,
      session: r.session,
      previousClose,
      changePct,
      isFailed: '0',
    },
  };
}

function buildForexEnvelope(r: ForexResult, precision: number): string {
  const { json, subVars } = forexFields(r, precision);
  return envelope(JSON.stringify(json), subVars);
}

/** The history sub-vars a single quote adds; "" where a figure is missing. */
function historySubVars(h: HistorySummary): Record<string, string> {
  return {
    startClose: String(h.startClose),
    endClose: String(h.endClose),
    periodChangePct: h.changePct === null ? '' : String(h.changePct),
    dateClose: h.dateClose === null ? '' : String(h.dateClose),
  };
}

interface ForexQuote { rate: number; asOf: string; previousClose: number | null; session: MarketSession }

async function fetchYahooRate(base: string, target: string, timeoutMs: number): Promise<ForexQuote | null> {
  for (const host of ['query1', 'query2']) {
    try {
      const symbol = encodeURIComponent(`${base}${target}=X`);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
      const data = await fetchJson(url, timeoutMs, { 'User-Agent': BROWSER_UA }) as {
        chart?: { error?: unknown; result?: Array<{ meta?: Record<string, unknown> }> };
      };
      const meta = data.chart?.result?.[0]?.meta;
      if (data.chart?.error || !meta) continue;
      const rate = Number(meta.regularMarketPrice);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      const prev = Number(meta.chartPreviousClose ?? meta.previousClose ?? NaN);
      return {
        rate,
        asOf: quoteTimeOf(meta),
        previousClose: Number.isFinite(prev) && prev > 0 ? prev : null,
        session: marketSession(meta),
      };
    } catch {
    }
  }
  return null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1_000);
}

/** A requested day past every exchange's today names a session that has not happened. */
function assertDateReached(req: HistoryRequest, dateRaw: string, histories: Array<HistoryData | null>, at: number): void {
  if (!req.date) return;
  const answered = histories.filter((h): h is HistoryData => !!h);
  if (answered.length > 0 && answered.every((h) => !dateReached(req, h.meta, at))) throw badMarketDate(dateRaw);
}

export async function execForex(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const base = (config.base ?? 'USD').trim().toUpperCase();
  const target = (config.target ?? '').trim().toUpperCase();
  const amountRaw = (config.amount ?? '').trim();
  const precision = clampIntField(config.precision, 4, 0, 12);

  const fail = (message: string): string => {
    sendLog(`💱 [Flow] Forex: ${message}`);
    return envelope(message, {
      rate: '0', converted: '0', amount: amountRaw || '1', base, target,
      asOf: '', session: '', previousClose: '', changePct: '', isFailed: '1',
    });
  };

  if (!base || !target) return fail('forex: base and target are required');
  const amount = amountRaw === '' ? 1 : Number(amountRaw);
  if (!Number.isFinite(amount)) return fail(`forex: invalid amount "${amountRaw}"`);
  if (base === target) {
    return buildForexEnvelope(
      { base, target, rate: 1, amount, converted: amount, asOf: '', previousClose: null, session: '' },
      precision,
    );
  }

  const historyReq = readHistoryRequest(config, new Date());
  if (historyReq) {
    const at = nowSec();
    const [live, history] = await Promise.all([
      fetchYahooRate(base, target, timeoutMs),
      fetchHistory(`${base}${target}=X`, historyReq, timeoutMs, at),
    ]);
    if (history === HISTORY_NOT_FOUND) {
      const legs = base !== 'USD' && target !== 'USD'
        ? `; get USD/${base} and USD/${target} history and divide (${target} per 1 ${base} = USD/${target} divided by USD/${base})`
        : '; check the currency code';
      return fail(`forex: Yahoo Finance has no ${base}/${target} pair${legs}`);
    }
    // The daily fallback table has no history; a period answered from it would be invented.
    if (!live || !history) {
      return fail(`forex: history unavailable for ${base}/${target} — Yahoo Finance did not answer, and the daily fallback table has no history`);
    }
    assertDateReached(historyReq, (config.date ?? '').trim(), [history], at);
    // `precision` is for the amount; a 0.03 rate rounded to it would show no movement at all.
    const summary = summarizeHistory(history, historyReq, {
      decimals: historyDecimals(history.bars, precision), seriesCap: historySeriesCap(1), nowSec: at,
      quote: `${target} per 1 ${base}`, amount: amountRaw === '' ? undefined : amount, amountDecimals: precision,
    });
    if (!summary) return fail(`forex: no trading data from ${historyReq.from} to ${historyReq.to}`);
    const { json, subVars } = forexFields(
      { base, target, rate: live.rate, amount, converted: amount * live.rate, asOf: live.asOf, previousClose: live.previousClose, session: live.session },
      precision,
    );
    sendLog(`💱 [Flow] Forex: ${base}/${target} history ${historyReq.from}..${historyReq.to} (${String(summary.json.points)} days)`);
    return envelope(JSON.stringify({ ...json, history: summary.json }), { ...subVars, ...historySubVars(summary) });
  }

  const live = await fetchYahooRate(base, target, timeoutMs);
  if (live) {
    sendLog(`💱 [Flow] Forex: 1 ${base} = ${live.rate} ${target} (live)`);
    return buildForexEnvelope(
      { base, target, rate: live.rate, amount, converted: amount * live.rate, asOf: live.asOf, previousClose: live.previousClose, session: live.session },
      precision,
    );
  }

  sendLog(`💱 [Flow] Forex: live quote unavailable for ${base}/${target}, falling back to the daily rate table`);
  try {
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, timeoutMs) as {
      result?: string; 'error-type'?: string; rates?: Record<string, number>; time_last_update_utc?: string;
    };
    if (data.result === 'error') return fail(`forex: unknown currency ${base} (${data['error-type'] ?? 'error'})`);
    const rate = data.rates?.[target];
    if (typeof rate !== 'number') return fail(`forex: unknown currency ${target}`);
    sendLog(`💱 [Flow] Forex: 1 ${base} = ${rate} ${target} (daily)`);
    return buildForexEnvelope(
      {
        base, target, rate, amount, converted: amount * rate,
        asOf: formatUtcStamp(data.time_last_update_utc ?? ''), previousClose: null, session: '',
      },
      precision,
    );
  } catch (err) {
    return fail(`forex source unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface Quote {
  symbol: string; name: string; currency: string;
  price: number; previousClose: number;
  open: number | null; high: number | null; low: number | null; volume: number | null;
  marketTime: string;
  session: MarketSession;
}

export function computeChange(price: number, previousClose: number): { change: number; changePct: string } {
  const change = price - previousClose;
  const changePct = previousClose ? String(Number((change / previousClose * 100).toFixed(4))) : '';
  return { change: Number(change.toFixed(6)), changePct };
}

function lastNum(arr: unknown): number | null {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

async function fetchQuote(symbol: string, timeoutMs: number): Promise<Quote | null> {
  if (!symbol) return null;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const data = await fetchJson(url, timeoutMs, { 'User-Agent': BROWSER_UA }) as {
        chart?: { error?: unknown; result?: Array<{ meta?: Record<string, unknown>; indicators?: { quote?: Array<Record<string, unknown>> } }> };
      };
      const result = data.chart?.result?.[0];
      if (data.chart?.error || !result?.meta) return null;
      const meta = result.meta;
      const q = result.indicators?.quote?.[0] ?? {};
      const price = Number(meta.regularMarketPrice);
      if (!Number.isFinite(price)) return null;
      const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? NaN);
      return {
        symbol: String(meta.symbol ?? symbol),
        name: String(meta.longName ?? meta.shortName ?? symbol),
        currency: String(meta.currency ?? ''),
        price,
        previousClose: Number.isFinite(prevClose) ? prevClose : 0,
        open: lastNum(q.open),
        high: Number(meta.regularMarketDayHigh) || lastNum(q.high),
        low: Number(meta.regularMarketDayLow) || lastNum(q.low),
        volume: Number(meta.regularMarketVolume) || lastNum(q.volume),
        marketTime: quoteTimeOf(meta),
        session: marketSession(meta),
      };
    } catch {
    }
  }
  return null;
}

function stockJson(q: Quote): Record<string, unknown> {
  const { change, changePct } = computeChange(q.price, q.previousClose);
  return {
    symbol: q.symbol, name: q.name, currency: q.currency,
    price: q.price, open: q.open, high: q.high, low: q.low, volume: q.volume,
    previousClose: q.previousClose, change, changePct, marketTime: q.marketTime, session: q.session,
  };
}

function stockSubVars(q: Quote): Record<string, string> {
  const { change, changePct } = computeChange(q.price, q.previousClose);
  return {
    symbol: q.symbol, name: q.name, currency: q.currency,
    price: String(q.price),
    open: q.open == null ? '' : String(q.open),
    high: q.high == null ? '' : String(q.high),
    low: q.low == null ? '' : String(q.low),
    volume: q.volume == null ? '' : String(q.volume),
    previousClose: String(q.previousClose),
    change: String(change),
    changePct,
    marketTime: q.marketTime,
    session: q.session,
    isFailed: '0',
  };
}

function buildStockEnvelope(q: Quote): string {
  return envelope(JSON.stringify(stockJson(q)), stockSubVars(q));
}

/** Price decimals as Yahoo hints them for the symbol (2 for most equities). */
function priceDecimals(meta: Record<string, unknown>): number {
  return Math.min(6, Math.max(0, Math.round(parseNumberField(meta.priceHint) ?? 4)));
}

/**
 * What several symbols with history may spend: the browser providers keep the first 3,500
 * characters of an observation, and a cut array loses its last symbols without a word. Series
 * points go first, since every figure the user asks about is computed outside them.
 */
export const MULTI_HISTORY_OUTPUT_MAX = 3_300;

/** Stated once, on the first symbol's history, when every later symbol has the same value. */
const SHARED_HISTORY_KEYS = ['source', 'from', 'to', 'timezone', 'values'] as const;

async function execStockHistory(symbols: string[], req: HistoryRequest, dateRaw: string, timeoutMs: number): Promise<string> {
  const at = nowSec();
  const fetched = await Promise.all(symbols.map(async (s) => {
    const [q, h] = await Promise.all([fetchQuote(s, timeoutMs), fetchHistory(s, req, timeoutMs, at)]);
    return { s, q, h: h === HISTORY_NOT_FOUND ? null : h };
  }));
  assertDateReached(req, dateRaw, fetched.map((f) => f.h), at);
  const build = (cap: number): Array<{ s: string; q: Quote | null; summary: HistorySummary | null }> => fetched.map(({ s, q, h }) => ({
    s, q,
    summary: q && h ? summarizeHistory(h, req, { decimals: priceDecimals(h.meta), seriesCap: cap, nowSec: at }) : null,
  }));

  if (symbols.length === 1) {
    const [{ s, q, summary }] = build(historySeriesCap(1));
    if (!q || !summary) {
      const why = q && fetched[0].h ? `no trading data from ${req.from} to ${req.to}` : 'history unavailable';
      sendLog(`📈 [Flow] Stock: ${why} for ${s}`);
      return envelope(`(${why}: ${s})`, { symbol: s, isFailed: '1' });
    }
    sendLog(`📈 [Flow] Stock: ${q.symbol} history ${req.from}..${req.to} (${String(summary.json.points)} days)`);
    return envelope(JSON.stringify({ ...stockJson(q), history: summary.json }), { ...stockSubVars(q), ...historySubVars(summary) });
  }

  const render = (cap: number): string => {
    let shared: Record<string, unknown> | null = null;
    return JSON.stringify(build(cap).map(({ s, q, summary }) => {
      if (!q || !summary) return { symbol: s, isFailed: 1 };
      const history = { ...summary.json };
      if (shared) {
        for (const key of SHARED_HISTORY_KEYS) if (history[key] === shared[key]) delete history[key];
      } else {
        shared = history;
      }
      return { ...stockJson(q), history };
    }));
  };
  let cap = historySeriesCap(symbols.length);
  let output = render(cap);
  while (output.length > MULTI_HISTORY_OUTPUT_MAX && cap > 0) {
    cap = cap > 3 ? Math.floor(cap / 2) : 0;
    output = render(cap);
  }
  sendLog(`📈 [Flow] Stock: ${symbols.length} symbols with history ${req.from}..${req.to} (series ${cap})`);
  return output;
}

export async function execStock(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const symbols = splitSymbols(config.symbol);

  if (symbols.length === 0) {
    sendLog('📈 [Flow] Stock: no symbol');
    return envelope('(no symbol)', { isFailed: '1' });
  }

  const historyReq = readHistoryRequest(config, new Date());
  if (historyReq) return execStockHistory(symbols, historyReq, (config.date ?? '').trim(), timeoutMs);

  if (symbols.length === 1) {
    const q = await fetchQuote(symbols[0], timeoutMs);
    if (!q) {
      sendLog(`📈 [Flow] Stock: quote unavailable for ${symbols[0]}`);
      return envelope(`(quote unavailable: ${symbols[0]})`, { symbol: symbols[0], isFailed: '1' });
    }
    sendLog(`📈 [Flow] Stock: ${q.symbol} ${q.price} ${q.currency}`);
    return buildStockEnvelope(q);
  }

  const quotes = await Promise.all(symbols.map((s) => fetchQuote(s, timeoutMs).then((q) => ({ s, q }))));
  sendLog(`📈 [Flow] Stock: ${quotes.filter((x) => x.q).length}/${symbols.length} quotes`);
  return JSON.stringify(quotes.map(({ s, q }) => (q ? stockJson(q) : { symbol: s, isFailed: 1 })));
}

import { parseNumberField } from './numberField';

/** '' when the source gave no trading window or no trade time, so "open" is never guessed. */
export type MarketSession = 'open' | 'closed' | '';

/** Yahoo v8 chart `meta`, loosely typed: every field is read defensively. */
export type YahooMeta = Record<string, unknown>;

/** "UTC+8", "UTC-4", "UTC+5:30", "UTC+0". */
export function utcOffsetLabel(offsetSec: number): string {
  const sign = offsetSec < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(offsetSec / 60));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

/** Wall-clock time at the given UTC offset, with the offset spelled out. */
export function formatExchangeTime(epochSec: number, offsetSec: number): string {
  const iso = new Date((epochSec + offsetSec) * 1_000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} (${utcOffsetLabel(offsetSec)})`;
}

function offsetFromZone(zone: string, epochSec: number): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(epochSec * 1_000))
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (part === 'GMT') return 0;
    const match = /^GMT([+-])(\d{1,2}):?(\d{2})?$/.exec(part);
    if (!match) return null;
    const sec = Number(match[2]) * 3_600 + Number(match[3] ?? 0) * 60;
    return match[1] === '-' ? -sec : sec;
  } catch {
    return null;
  }
}

/** The exchange's UTC offset in seconds: Yahoo's gmtoffset, else its zone name, else UTC. */
export function exchangeOffsetSec(meta: YahooMeta, epochSec: number): number {
  const direct = parseNumberField(meta.gmtoffset);
  if (direct !== null) return direct;
  const zone = typeof meta.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : '';
  return (zone && offsetFromZone(zone, epochSec)) || 0;
}

/** The last trade's time in the exchange's own clock, or '' when the source gave none. */
export function quoteTimeOf(meta: YahooMeta): string {
  const t = parseNumberField(meta.regularMarketTime);
  return t === null ? '' : formatExchangeTime(t, exchangeOffsetSec(meta, t));
}

/**
 * Whether the quote is an intraday price, not a close: "open" needs both the clock and the last
 * trade inside the regular session. A price stamped before today's session start (a holiday, no
 * trade yet) is the previous close even while the clock sits inside the window. Without a trade
 * time there is no evidence either way, so the session is unknown ('').
 */
export function marketSession(meta: YahooMeta, nowSec: number = Math.floor(Date.now() / 1_000)): MarketSession {
  const period = meta.currentTradingPeriod as { regular?: { start?: unknown; end?: unknown } } | undefined;
  const start = parseNumberField(period?.regular?.start);
  const end = parseNumberField(period?.regular?.end);
  if (start === null || end === null || end <= start) return '';
  if (nowSec < start || nowSec >= end) return 'closed';
  const traded = parseNumberField(meta.regularMarketTime);
  if (traded === null) return '';
  return traded >= start && traded < end ? 'open' : 'closed';
}

/** The daily fallback table stamps an RFC 2822 UTC time; show it in the same shape as Yahoo's. */
export function formatUtcStamp(raw: string): string {
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? formatExchangeTime(Math.floor(ms / 1_000), 0) : raw;
}

/**
 * since/until for the LINE tools that page like line-cli's read (line_download, line_preview):
 * YYYY-MM-DD, YYYYMMDD,
 * 'YYYY-MM-DD HH:MM[:SS]', RFC3339, unix seconds or unix milliseconds, in this computer's local
 * time unless an offset is given. A bare date is the start of that day for since and its last
 * second for until, so both ends are inclusive. Bad input is INVALID_ARGUMENT in line-cli's words.
 */
import { LineError } from './errors';

// 9999-12-31T23:59:59Z; larger times would overflow the millisecond bounds the queries use.
const MAX_UNIX_SECONDS = 253_402_300_799;
const INT64_MAX = 9_223_372_036_854_775_807n;

function invalid(message: string): LineError {
  return new LineError('INVALID_ARGUMENT', message);
}

function validClock(h: number, m: number, s: number): boolean {
  return h <= 23 && m <= 59 && s <= 59;
}

// A local wall-clock time, or null when the fields are not a real one (Go's parse rejects Feb 30).
function localTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  if (!validClock(h, mi, s)) return null;
  const at = new Date(2000, 0, 1);
  at.setFullYear(y, mo - 1, d);
  at.setHours(h, mi, s, 0);
  return at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d ? at : null;
}

// Seconds of the day's start, or of its last second (the next local midnight minus one second).
function dayTime(y: number, mo: number, d: number, endOfDay: boolean): number | null {
  const start = localTime(y, mo, d);
  if (!start) return null;
  if (!endOfDay) return Math.floor(start.getTime() / 1000);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return Math.floor(next.getTime() / 1000) - 1;
}

function checkUnix(s: string, sec: bigint): number {
  if (sec > BigInt(MAX_UNIX_SECONDS)) throw invalid(`invalid time: ${s} (out of range)`);
  return Number(sec);
}

function parseInteger(s: string, endOfDay: boolean): number {
  const n = BigInt(s);
  if (s.length === 8) {
    const day = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    const at = day ? dayTime(Number(day[1]), Number(day[2]), Number(day[3]), endOfDay) : null;
    if (at !== null) return at;
  } else if (n >= 1_000_000_000_000n) {
    return checkUnix(s, n / 1000n);
  } else if (n >= 1_000_000_000n) {
    return checkUnix(s, n);
  }
  throw invalid(`invalid time: ${s} (an integer must be YYYYMMDD, unix seconds or unix milliseconds)`);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

function parseRfc3339(match: RegExpExecArray): number | null {
  const [y, mo, d, h, mi, s] = match.slice(1, 7).map(Number);
  if (!validClock(h, mi, s) || !localTime(y, mo, d)) return null;
  const offH = Number(match[8] ?? 0);
  const offM = Number(match[9] ?? 0);
  if (offH > 23 || offM > 59) return null;
  const offset = (match[7] === '-' ? -1 : 1) * (offH * 60 + offM) * 60;
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000) - offset;
}

/** Unix seconds for one bound; 0 (no bound) for an empty value. */
export function parseLineTime(value: string | undefined, endOfDay: boolean): number {
  const s = (value ?? '').trim();
  if (!s) return 0;
  if (/^[+-]?\d+$/.test(s)) {
    const n = BigInt(s);
    if (n <= INT64_MAX && n >= -INT64_MAX - 1n) return parseInteger(s, endOfDay);
  }
  const date = DATE.exec(s);
  if (date) {
    const at = dayTime(Number(date[1]), Number(date[2]), Number(date[3]), endOfDay);
    if (at !== null) return at;
  }
  const rfc = RFC3339.exec(s);
  const rfcAt = rfc ? parseRfc3339(rfc) : null;
  if (rfcAt !== null) return rfcAt;
  const local = LOCAL.exec(s);
  if (local) {
    const [y, mo, d, h, mi] = local.slice(1, 6).map(Number);
    const at = localTime(y, mo, d, h, mi, Number(local[6] ?? 0));
    if (at) return Math.floor(at.getTime() / 1000);
  }
  throw invalid(`invalid time: ${s} (use YYYY-MM-DD, YYYYMMDD, 'YYYY-MM-DD HH:MM', RFC3339, unix seconds or unix milliseconds)`);
}

/** since (start of day) and until (end of day) in unix seconds, 0 when absent; since after until is an error. */
export function parseLineRange(since: string | undefined, until: string | undefined): { sinceTs: number; untilTs: number } {
  const sinceTs = parseLineTime(since, false);
  const untilTs = parseLineTime(until, true);
  if (sinceTs !== 0 && untilTs !== 0 && sinceTs > untilTs) throw invalid('since is later than until');
  return { sinceTs, untilTs };
}

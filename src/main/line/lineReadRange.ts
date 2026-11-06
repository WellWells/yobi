/**
 * A range of one chat's stored messages.
 * Anchored on `since` when given (the first N from it), otherwise on the newest end (the last N up
 * to `until` or now); the output is always oldest first. Each message keeps its exact _createdTime
 * so messages read from LINE's server merge in at the right place.
 */
import type { ReaderAccess } from './reader';
import { saneLimit, type ParsedMessage } from './schema';
import { untilMs } from './lineFreshness';

export const DEFAULT_READ_LIMIT = 200;
export const DEFAULT_READ_RANGE_LIMIT = 500;

/** A read of one chat: bounds in unix seconds (0 = open) and the limit asked for (0 / absent = default). */
export interface RangeOptions {
  sinceSec: number;
  untilSec: number;
  limit?: number;
}

/** The message count a read returns at most: 200 without a range, 500 with one, capped at 5000. */
export function effectiveReadLimit(opt: RangeOptions): number {
  return saneLimit(opt.limit, opt.sinceSec !== 0 || opt.untilSec !== 0 ? DEFAULT_READ_RANGE_LIMIT : DEFAULT_READ_LIMIT);
}

/** A message with its exact _createdTime (ms), for merging; `main` marks an open chat's own message. */
export interface Timed {
  msg: ParsedMessage;
  created: number;
  main: boolean;
}

/** One chat's stored messages in a range, oldest first. */
export function readRange(acc: ReaderAccess, chatId: string, opt: RangeOptions): Timed[] {
  let where = '_chatId=?';
  const params: unknown[] = [chatId];
  if (opt.sinceSec !== 0) {
    where += ' AND _createdTime>=?';
    params.push(opt.sinceSec * 1000);
  }
  if (opt.untilSec !== 0) {
    where += ' AND _createdTime<=?';
    params.push(untilMs(opt.untilSec));
  }
  const newest = opt.sinceSec === 0;
  const rows = acc.all(`SELECT * FROM _message WHERE ${where} ORDER BY _createdTime ${newest ? 'DESC' : 'ASC'} LIMIT ?`, [...params, effectiveReadLimit(opt)]);
  if (newest) rows.reverse();
  const parse = acc.parser();
  return rows.map((row) => ({ msg: parse(row), created: Number(row._createdTime) || 0, main: false }));
}

/** `since`/`until` (unix seconds, 0 = open) as inclusive ms bounds (0 = open). */
/** Narrows [lo, hi] to the page `limit` cut: one from `since` ends at its last message's second, one from the newest end starts at its first's. */
export function pageSpan(lo: number, hi: number, first: number, last: number, fromSince: boolean): { lo: number; hi: number } {
  return fromSince ? { lo, hi: Math.floor(last / 1000) * 1000 + 999 } : { lo: Math.floor(first / 1000) * 1000, hi };
}

export function rangeMs(sinceSec: number, untilSec: number): { lo: number; hi: number } {
  return { lo: sinceSec !== 0 ? sinceSec * 1000 : 0, hi: untilSec !== 0 ? untilMs(untilSec) : 0 };
}

export function inSpan(all: Timed[], lo: number, hi: number): Timed[] {
  return all.filter((t) => t.created >= lo && (hi === 0 || t.created <= hi));
}

/** The first limit (fromStart) or the last limit of a sorted list, as a read pages from `since` or from the newest end. */
export function limitTimed(all: Timed[], limit: number, fromStart: boolean): Timed[] {
  if (all.length <= limit) return all;
  return fromStart ? all.slice(0, limit) : all.slice(all.length - limit);
}

/** Orders by time; at the same ms an open chat's own message comes first. Stable. */
export function sortTimed(all: Timed[]): void {
  all.sort((a, b) => (a.created !== b.created ? a.created - b.created : Number(b.main && !a.main) - Number(a.main && !b.main)));
}

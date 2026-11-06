import { toPlausibleDate } from '../publishedAt';

const DAY_MS = 86_400_000;

/** Absolute dates as engines print them in a result's snippet: `2026年8月8日` (zh / ja) or `2026-08-08`. */
const CJK_DATE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;

/** Relative ages, in milliseconds per unit. A month is 30 days and a year 365: the date is a page's age, not a timestamp. */
const RELATIVE_UNITS: readonly { pattern: RegExp; ms: number }[] = [
  { pattern: /(\d+)\s*(?:分鐘|分钟|分)前|(\d+)\s*(?:minutes?|mins?)\s+ago/i, ms: 60_000 },
  { pattern: /(\d+)\s*(?:小時|小时|時間)前|(\d+)\s*(?:hours?|hrs?)\s+ago/i, ms: 3_600_000 },
  { pattern: /(\d+)\s*(?:天|日)前|(\d+)\s*days?\s+ago/i, ms: DAY_MS },
  { pattern: /(\d+)\s*(?:週|周|星期)前|(\d+)\s*weeks?\s+ago/i, ms: 7 * DAY_MS },
  { pattern: /(\d+)\s*(?:個月|个月|か月|ヶ月)前|(\d+)\s*months?\s+ago/i, ms: 30 * DAY_MS },
  { pattern: /(\d+)\s*年前|(\d+)\s*years?\s+ago/i, ms: 365 * DAY_MS },
];

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The date an engine shows beside a result (`2 週前`, `2026年8月8日`, `Aug 8, 2026`, `3 days ago`)
 * as `YYYY-MM-DD`, or '' when it is not a date this can read. Future and pre-1990 dates are refused,
 * like a page's own: an undated source beats a confidently wrong one.
 */
export function parseSerpDate(text: string, now: Date = new Date()): string {
  const label = text.replace(/[\s·\-–—]+$/u, '').trim();
  if (!label) return '';

  const cjk = CJK_DATE.exec(label);
  if (cjk) return toPlausibleDate(`${cjk[1]}-${cjk[2]}-${cjk[3]}`, now);
  const iso = ISO_DATE.exec(label);
  if (iso) return toPlausibleDate(`${iso[1]}-${iso[2]}-${iso[3]}`, now);

  for (const { pattern, ms } of RELATIVE_UNITS) {
    const match = pattern.exec(label);
    if (!match) continue;
    const count = Number(match[1] ?? match[2]);
    return Number.isFinite(count) ? toPlausibleDate(isoDate(new Date(now.getTime() - count * ms)), now) : '';
  }

  // English month names ("Aug 8, 2026"); a bare number or a word is not a date.
  if (!/[a-z]{3}/i.test(label) || !/\d{4}/.test(label)) return '';
  const parsed = new Date(label);
  return Number.isNaN(parsed.getTime()) ? '' : toPlausibleDate(isoDate(parsed), now);
}

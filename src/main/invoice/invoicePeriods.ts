import { isOffDay } from '../metro/taiwanCalendar';
import { addDays } from '../rail/railTime';

/**
 * Taiwan's receipt lottery (統一發票) runs in two-month periods starting on an odd month
 * (01-02 … 11-12). A period is named by its ROC year and first month, the Ministry of Finance's
 * own code: 115年07~08月 = "11507" (ROC year = Gregorian year - 1911).
 */
export const ROC_OFFSET = 1_911;

export interface PeriodRef {
  /** Gregorian year. */
  year: number;
  /** The period's first month: 1, 3, 5, 7, 9 or 11. */
  startMonth: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function periodCode(ref: PeriodRef): string {
  return `${ref.year - ROC_OFFSET}${pad2(ref.startMonth)}`;
}

/** "11507" → 2026 July; anything that is not an odd-month period code → null. */
export function periodFromCode(code: string): PeriodRef | null {
  const m = /^(\d{2,3})(\d{2})$/.exec(code.trim());
  if (!m) return null;
  return periodOf(Number(m[1]) + ROC_OFFSET, Number(m[2]), true);
}

/** The period a month falls in; with `mustStart`, only a period's first (odd) month is accepted. */
function periodOf(year: number, month: number, mustStart = false): PeriodRef | null {
  if (!Number.isInteger(year) || year < 2_000 || year > 2_200 || !(month >= 1 && month <= 12)) return null;
  if (mustStart && month % 2 === 0) return null;
  return { year, startMonth: month % 2 === 1 ? month : month - 1 };
}

/** Months since a fixed origin, so periods compare and step by plain arithmetic. */
export function periodIndex(ref: PeriodRef): number {
  return ref.year * 12 + ref.startMonth - 1;
}

/** "YYYY-MM-DD" of a calendar day in Taiwan (UTC+8, no daylight saving). */
export function taipeiDate(at: Date): string {
  return new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** The draw is on the 25th of the odd month after the period: 07~08 → 09-25. */
export function drawDateOf(ref: PeriodRef): string {
  const monthIndex = ref.startMonth + 1; // 0-based index of the month after the period
  const year = ref.year + Math.floor(monthIndex / 12);
  return `${year}-${pad2((monthIndex % 12) + 1)}-25`;
}

function shiftMonth(date: string, months: number, day: number): string {
  const [y, m] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}-${pad2(day)}`;
}

/**
 * The claim window printed on every period page since at least 110年: from the 6th of the month
 * after the draw to the 5th three months later, the end moved to the next office day when it is
 * a weekend or a national holiday (115年07~08月 ends 116-01-05; 115年03~04月 ended on Monday
 * 115-09-07 because the 5th was a Saturday). The start does not move (114-12-06 was a Saturday).
 */
export function claimWindowOf(drawnAt: string): { from: string; until: string } {
  let until = shiftMonth(drawnAt, 4, 5);
  for (let guard = 0; guard < 14 && isOffDay(until); guard++) until = addDays(until, 1);
  return { from: shiftMonth(drawnAt, 1, 6), until };
}

export type PeriodSelection =
  | { kind: 'default' }
  | { kind: 'latest' }
  | { kind: 'all' }
  | { kind: 'period'; ref: PeriodRef };

const LATEST_WORDS = new Set(['latest', 'current', 'newest', 'last', '最新', '最新一期', '本期', '這期', '这期', '這一期', '这一期']);
const ALL_WORDS = new Set(['all', '全部', '所有', '所有期別']);

/** A 3-digit year is ROC (115), a 4-digit one Gregorian (2026). */
function yearOf(raw: string): number {
  const n = Number(raw);
  return raw.length <= 3 ? n + ROC_OFFSET : n;
}

/**
 * What the `period` field names: blank, "latest", "all", a period in any of the ways people and
 * models write one — ROC "115-07", "11507", "115年07~08月"; Gregorian "2026-07", "2026/07-08",
 * "202607" — or an invoice date ("2026-07-15", ROC "115/07/15"), which picks its two-month period.
 * An even month names the period it ends ("2026-08" = 07~08). null = not readable.
 */
export function parsePeriodInput(raw: string): PeriodSelection | null {
  const text = raw.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return { kind: 'default' };
  if (LATEST_WORDS.has(text)) return { kind: 'latest' };
  if (ALL_WORDS.has(text)) return { kind: 'all' };
  const compact = /^(\d{3})(\d{2})$/.exec(text) ?? /^(\d{4})(\d{2})$/.exec(text);
  if (compact) {
    const ref = periodOf(yearOf(compact[1]), Number(compact[2]));
    return ref ? { kind: 'period', ref } : null;
  }
  // A date repeats its separator ("2026-07-15", "115/7/15") or reads 年月日; "2026/08-09" is a span.
  const date = /^(\d{3,4})(?:([-/.])(\d{1,2})\2(\d{1,2})|年(\d{1,2})月(\d{1,2})日?)$/.exec(text);
  if (date) {
    const day = Number(date[4] ?? date[6]);
    const ref = day >= 1 && day <= 31 ? periodOf(yearOf(date[1]), Number(date[3] ?? date[5])) : null;
    return ref ? { kind: 'period', ref } : null;
  }
  const span = /^(\d{3,4})[-/.年](\d{1,2})(?:月?[-~～–—至到/](\d{1,2}))?月?(?:份)?$/.exec(text);
  if (!span) return null;
  const first = Number(span[2]);
  const ref = periodOf(yearOf(span[1]), first);
  if (!ref) return null;
  // "07-08" must be one period; "08-09" spans two and is refused rather than guessed.
  if (span[3] !== undefined && !(first % 2 === 1 && Number(span[3]) === first + 1)) return null;
  return { kind: 'period', ref };
}

import { claimWindowOf, drawDateOf, periodCode, periodFromCode, ROC_OFFSET, taipeiDate } from './invoicePeriods';
import type { PeriodRef } from './invoicePeriods';

/** One drawn period as the Ministry of Finance's feed lists it. */
export interface InvoiceDraw extends PeriodRef {
  /** The ministry's code, "11507". */
  period: string;
  /** The official name, "115年07~08月". */
  label: string;
  /** Taiwan date of the draw (the feed's publish time), "YYYY-MM-DD". */
  drawnAt: string;
  claimFrom: string;
  claimUntil: string;
  special: string;
  grand: string;
  first: string[];
  /** 增開六獎 (last three digits). Not drawn since 111年01~02月, but still read if a period lists one. */
  extraSixth: string[];
  /** Prize names the feed lists that this checker does not know; reported, never silently skipped. */
  otherPrizes: string[];
  link: string;
}

export type PrizeId = 'special' | 'grand' | 'first' | 'second' | 'third' | 'fourth' | 'fifth' | 'sixth' | 'extraSixth';

/** 統一發票給獎辦法: every prize, its official name and its amount in NT$. */
export const PRIZES: Readonly<Record<PrizeId, { name: string; amount: number }>> = {
  special: { name: '特別獎', amount: 10_000_000 },
  grand: { name: '特獎', amount: 2_000_000 },
  first: { name: '頭獎', amount: 200_000 },
  second: { name: '二獎', amount: 40_000 },
  third: { name: '三獎', amount: 10_000 },
  fourth: { name: '四獎', amount: 4_000 },
  fifth: { name: '五獎', amount: 1_000 },
  sixth: { name: '六獎', amount: 200 },
  extraSixth: { name: '增開六獎', amount: 200 },
};

/** How many trailing digits of a 頭獎 number each lower prize needs. */
const TAIL_PRIZES: readonly (readonly [number, PrizeId])[] = [
  [8, 'first'], [7, 'second'], [6, 'third'], [5, 'fourth'], [4, 'fifth'], [3, 'sixth'],
];

function tagText(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`).exec(block);
  return m?.[1].trim() ?? '';
}

/** "<p>特別獎：89996565</p><p>頭獎：54348835、44991397</p>" → label → digit runs. */
function prizeRows(description: string): [string, string[]][] {
  const rows: [string, string[]][] = [];
  for (const m of description.matchAll(/<p>\s*([^：:<]+?)\s*[：:]\s*([^<]*)<\/p>/g)) {
    rows.push([m[1].trim(), m[2].match(/\d+/g) ?? []]);
  }
  return rows;
}

const isFull = (n: string): boolean => /^\d{8}$/.test(n);

/** The period an item is about: the code at the end of its link, else its title. */
function itemPeriod(link: string, title: string): PeriodRef | null {
  const fromLink = /_(\d{5})\/?$/.exec(link);
  if (fromLink) return periodFromCode(fromLink[1]);
  const fromTitle = /(\d{2,3})\s*年\s*(\d{1,2})\s*[~～\-–]\s*\d{1,2}\s*月/.exec(title);
  return fromTitle ? periodFromCode(`${fromTitle[1]}${fromTitle[2].padStart(2, '0')}`) : null;
}

/**
 * Every complete period in the feed (https://invoice.etax.nat.gov.tw/invoice.xml), newest first.
 * An item without a full 特別獎, 特獎 and 頭獎 is left out rather than half-read: checking a
 * number against half a period would report "no prize" for a winner.
 */
export function parseInvoiceFeed(xml: string): InvoiceDraw[] {
  const draws: InvoiceDraw[] = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = item[1];
    const link = tagText(block, 'link');
    const ref = itemPeriod(link, tagText(block, 'title'));
    if (!ref) continue;
    let special = '';
    let grand = '';
    const first: string[] = [];
    const extraSixth: string[] = [];
    const otherPrizes: string[] = [];
    for (const [label, numbers] of prizeRows(tagText(block, 'description'))) {
      if (label === '特別獎') special = numbers.find(isFull) ?? '';
      else if (label === '特獎') grand = numbers.find(isFull) ?? '';
      else if (label === '頭獎') first.push(...numbers.filter(isFull));
      else if (label === '增開六獎') extraSixth.push(...numbers.filter((n) => /^\d{3}$/.test(n)));
      else otherPrizes.push(label);
    }
    if (!special || !grand || first.length === 0) continue;
    const published = Date.parse(tagText(block, 'pubDate'));
    const drawnAt = Number.isFinite(published) ? taipeiDate(new Date(published)) : drawDateOf(ref);
    const claim = claimWindowOf(drawnAt);
    const startMonth = String(ref.startMonth).padStart(2, '0');
    draws.push({
      ...ref,
      period: periodCode(ref),
      label: `${ref.year - ROC_OFFSET}年${startMonth}~${String(ref.startMonth + 1).padStart(2, '0')}月`,
      drawnAt,
      claimFrom: claim.from,
      claimUntil: claim.until,
      special,
      grand,
      first,
      extraSixth,
      otherPrizes,
      link,
    });
  }
  const seen = new Set<string>();
  return draws
    .sort((a, b) => Number(b.period) - Number(a.period))
    .filter((d) => !seen.has(d.period) && seen.add(d.period));
}

export interface TicketNumber {
  /** As the receipt prints it, normalised: "AB-12345678", "12345678", or a tail "111". */
  display: string;
  /** 3-8 digits; fewer than 8 = only the last digits are known. */
  digits: string;
}

/** Most numbers one request can check. */
export const MAX_TICKET_NUMBERS = 200;

/**
 * Receipt numbers in whatever the user or the model typed: several separated by spaces, commas,
 * 、 or lines; full-width digits; a two-letter track prefix ("AB-12345678", "ab12345678") kept for
 * display only; or just the last 3 (up to 7) digits. Words between them are ignored; a digit run
 * that is not 3-8 long (a phone number, a date) is returned in `bad` instead of being guessed at.
 */
export function parseTicketNumbers(raw: string): { numbers: TicketNumber[]; bad: string[] } {
  const text = raw.normalize('NFKC').toUpperCase();
  const numbers: TicketNumber[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:(?<![A-Z])([A-Z]{2})\s*[-–—]?\s*)?(\d+)/g)) {
    const [whole, track, digits] = m;
    if (digits.length < 3 || digits.length > 8 || (track && digits.length !== 8)) {
      bad.push(whole.trim());
      continue;
    }
    const display = track ? `${track}-${digits}` : digits;
    if (seen.has(digits)) continue;
    seen.add(digits);
    numbers.push({ display, digits });
  }
  return { numbers: numbers.slice(0, MAX_TICKET_NUMBERS), bad };
}

export interface TicketMatch {
  /** won = a prize for certain (with `atLeast`, possibly a bigger one); maybe = only the full number can tell. */
  status: 'won' | 'maybe' | 'none';
  prize?: PrizeId;
  /** The winning number it matched. */
  matched?: string;
  /** A tail matched: this prize at least, the full number may win more. */
  atLeast?: boolean;
  /** For `maybe` (and alongside an `atLeast` win): the 8-digit prizes whose tail it shares. */
  checkFull?: PrizeId[];
}

function sharedTail(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/**
 * One number against one period. An invoice wins one prize only (給獎辦法: 同時對中多數獎項，以兌領
 * 一個獎項為限), so the highest one is reported: 特別獎 over a 頭獎 tail it also shares.
 */
export function matchTicket(ticket: TicketNumber, draw: InvoiceDraw): TicketMatch {
  const { digits } = ticket;
  const full = digits.length === 8;
  if (full && digits === draw.special) return { status: 'won', prize: 'special', matched: draw.special };
  if (full && digits === draw.grand) return { status: 'won', prize: 'grand', matched: draw.grand };
  let best: { prize: PrizeId; matched: string; tail: number } | null = null;
  for (const winning of draw.first) {
    const tail = sharedTail(digits, winning);
    const hit = TAIL_PRIZES.find(([need]) => tail >= need);
    if (hit && (!best || hit[0] > best.tail)) best = { prize: hit[1], matched: winning, tail: hit[0] };
  }
  if (!best) {
    const extra = draw.extraSixth.find((n) => digits.endsWith(n));
    if (extra) best = { prize: 'extraSixth', matched: extra, tail: 3 };
  }
  if (full) return best ? { status: 'won', prize: best.prize, matched: best.matched } : { status: 'none' };
  // A tail: a bigger prize stays possible when every known digit matched, and the 8-digit
  // prizes can never be ruled in or out.
  const checkFull = (['special', 'grand'] as const).filter((p) => draw[p].endsWith(digits));
  if (best) {
    // An 增開六獎 tail can only grow into 特別獎/特獎; a 頭獎 tail that used every known digit
    // can grow up to 頭獎.
    const atLeast = (best.prize !== 'extraSixth' && best.tail === digits.length) || checkFull.length > 0;
    return { status: 'won', prize: best.prize, matched: best.matched, atLeast, ...(checkFull.length ? { checkFull } : {}) };
  }
  return checkFull.length ? { status: 'maybe', checkFull } : { status: 'none' };
}

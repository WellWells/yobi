/**
 * Reading TYMC's own pages: the timetable-and-fare search result, its station list and the
 * homepage's service status. Pure functions over the HTML the site serves (captures 2026-10-22).
 */
import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { DAY_MINUTES, clockMinutes } from '../rail/railTime';
import type { TicketPrice } from './metroTypes';

/** One train of the search result; minutes after the asked day's midnight, rolled past 1440 after midnight. */
export interface TymcRow {
  /** 直達車 or 普通車, as printed. */
  type: string;
  depart: number;
  arrive: number;
  /** 行車時間, in minutes. */
  minutes: number;
}

export interface TymcSearchPage {
  /** The date TYMC says it answered for (it falls back to today, silently, for a date it rejects). */
  date: string | null;
  /** The last date TYMC has published a timetable for (banner "時刻表更新至115/11/30"). */
  horizon: string | null;
  /** How many days ahead TYMC tells riders to check a date past the horizon (banner "行前3天"). */
  checkDaysAhead: number | null;
  /** The whole service day for the pair, in departure order (較早/較晚班次 only pages it client-side). */
  rows: TymcRow[];
  /** Every ticket kind of the fare table, in page order; the first is 全票. */
  fares: TicketPrice[];
}

const MIDNIGHT_JUMP = 6 * 60;

/** "115/11/30" (ROC year) → "2026-11-30"; null for anything else. */
export function rocDate(text: string): string | null {
  const match = /(\d{2,3})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/u.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]) + 1911, Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

/** "1,280元" → 1280; NaN for "-" (the kind is not sold for this pair). */
function priceOf(text: string): number {
  const match = /^([\d,]+)元$/u.exec(squash(text));
  return match ? Number(match[1].replaceAll(',', '')) : Number.NaN;
}

/** The fare table's own column label; "7天" sits under the 定期票 group, so it reads "7天定期票" (TYMC's word). */
function ticketKind(label: string): string {
  return /^\d+天$/u.test(label) ? `${label}定期票` : label;
}

function parseFares($: CheerioAPI): TicketPrice[] {
  const table = $('table').filter((_, el) => $(el).children('caption').text().includes('票價查詢結果')).first();
  if (table.length === 0) return [];
  const headers = table.find('tr').filter((_, tr) => $(tr).find('th[scope="col"]').length > 0).last()
    .find('th[scope="col"]')
    .filter((_, th) => !/display\s*:\s*none/iu.test($(th).attr('style') ?? ''))
    .map((_, th) => squash($(th).text())).get();
  const cells = table.find('tr').filter((_, tr) => $(tr).children('td').length > 0).first()
    .children('td').map((_, td) => $(td).text()).get();
  if (headers.length !== cells.length) {
    throw new Error(`TYMC fare table has ${headers.length} ticket kinds but ${cells.length} prices`);
  }
  const fares: TicketPrice[] = [];
  headers.forEach((label, i) => {
    const ntd = priceOf(cells[i]);
    if (Number.isFinite(ntd)) fares.push({ kind: ticketKind(label), ntd });
  });
  return fares;
}

/**
 * Rows as printed (each clock in 0..1439) → one service day: a departure hours earlier than the one
 * before passed midnight (A12 → A13 ends 23:58, 00:13, 00:28). A few minutes back is left alone.
 */
function parseRows($: CheerioAPI): TymcRow[] {
  const rows: TymcRow[] = [];
  let offset = 0;
  let last = -1;
  $('#car_time_show tr').each((_, tr) => {
    const cells = $(tr).children('td').map((__, td) => $(td).text().trim()).get();
    if (cells.length < 4) return;
    const depart = clockMinutes(cells[1]);
    const arrive = clockMinutes(cells[2]);
    const minutes = clockMinutes(cells[3]);
    if (!cells[0] || !Number.isFinite(depart) || !Number.isFinite(arrive) || !Number.isFinite(minutes)) return;
    if (depart + offset < last - MIDNIGHT_JUMP) offset += DAY_MINUTES;
    const rolledDepart = depart + offset;
    let rolledArrive = arrive + offset;
    if (rolledArrive < rolledDepart) rolledArrive += DAY_MINUTES;
    last = rolledDepart;
    rows.push({ type: cells[0], depart: rolledDepart, arrive: rolledArrive, minutes });
  });
  return rows;
}

/**
 * The search result page. Throws when it is the blank form — what TYMC serves (HTTP 200) when the
 * request has no Referer on its own site, or when the form was not accepted.
 */
export function parseTymcSearch(html: string): TymcSearchPage {
  const $ = load(html);
  const date = $('li.date').first().text().trim() || null;
  const fares = parseFares($);
  if (!date && fares.length === 0) throw new Error('TYMC timetable search returned the blank form, not a result');
  // Comments are not text, so the commented-out 2023 banner ("更新至112/8/10") is not read.
  const bodyText = $('body').text();
  const banner = /時刻表更新至\s*([\d/]+)(?:[^。]*?行前\s*(\d+)\s*天)?/u.exec(bodyText);
  return {
    date,
    horizon: banner ? rocDate(banner[1]) : null,
    checkDaysAhead: banner?.[2] ? Number(banner[2]) : null,
    rows: parseRows($),
    fares,
  };
}

/** The search form's station list: internal id and label ("1", "A1 台北車站"). */
export function parseTymcStationOptions(html: string): { ref: string; label: string }[] {
  const $ = load(html);
  return $('select[name="start_station"] option').map((_, el) => ({
    ref: ($(el).attr('value') ?? '').trim(),
    label: $(el).text().replace(/\s+/gu, ' ').trim(),
  })).get().filter((option) => option.ref !== '');
}

/** The homepage's 最新營運狀態 (the page repeats it for narrow and wide layouts; the first is read). */
export function parseTymcStatus(html: string): { normal: boolean | null; text: string } {
  const $ = load(html);
  const block = $('.operation').filter((_, el) => $(el).text().includes('營運狀態')).first();
  if (block.length === 0) throw new Error('TYMC homepage has no service status block');
  const text = block.find('span').first().text().replace(/\s+/gu, ' ').trim();
  if (!text) return { normal: null, text: '' };
  return { normal: text.includes('正常營運'), text };
}

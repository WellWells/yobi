/**
 * Reading New Taipei Metro's per-station timetables (淡海 / 安坑 搭乘時刻表 pages, the "詳細資料"
 * ODT next to each station's PDF). Every file is the operator's own typing, so the format drifts
 * from file to file (read 2026-10-22, all 23 stations, old and new 淡海 versions):
 *
 * - A section heading names the day type — "平常日" or "週六、週日及國定假日" — and usually the
 *   platform's direction ("2月台往紅樹林站平常日", "平常日往雙城發車時刻"). Headings that name both
 *   淡海 branches ("1月台往崁頂及淡水漁人碼頭站") leave the direction to each line; a heading with no
 *   "往" keeps the previous heading's direction (K09's 假日 heading), else the terminus's only one
 *   (K01's "雙城站發車時刻-【平常日】").
 * - An hour line is "6時：15、30分往崁頂站，22、47分往淡水漁人碼頭站", "6時12、28、40分", "7時 05、14…",
 *   "17時：01、8、18…" (one digit), with optional "分" and tabs. Hours after midnight are written
 *   "00時" in the new files and "24時" in the old V01 one: both are 24:xx of the same service day.
 * - Direction words: 往崁頂, 往淡水漁人碼頭 / 往漁人碼頭 (old files), 往紅樹林, 往雙城, 往十四張.
 *
 * The page puts the files in document order; when the 淡海 pages list two, a paragraph reading
 * exactly "新時刻表" sits between the old and the new one, and the page says when the new one starts
 * ("舊時刻表使用至23日止，24日起使用新時刻表" — a day of the month, no month: see `effectiveFrom`).
 */
import AdmZip from 'adm-zip';
import { load } from 'cheerio';

export type DayKind = 'weekday' | 'offday';

/** Terminus code → departures in minutes after the service day's midnight, sorted (00:15 after midnight = 1455). */
export type DirectionTimes = Readonly<Record<string, readonly number[]>>;

export type StationTimetable = Readonly<Record<DayKind, DirectionTimes>>;

/** The termini a train can be signed for, with the words the files use for them. */
const TERMINI = [
  [/崁頂/u, 'V11'],
  [/漁人碼頭/u, 'V26'],
  [/紅樹林/u, 'V01'],
  [/雙城/u, 'K01'],
  [/十四張/u, 'K09'],
] as const;

export const TERMINUS_ZH: Readonly<Record<string, string>> = { V11: '崁頂', V26: '淡水漁人碼頭', V01: '紅樹林', K01: '雙城', K09: '十四張' };

/** A terminus station's file may name no direction at all: trains leave it one way only. */
const ONLY_WAY: Readonly<Record<string, string>> = { V11: 'V01', V26: 'V01', K01: 'K09', K09: 'K01' };

/** Hours this early belong to the previous service day (the files' last trains leave at 00:xx). */
const SERVICE_DAY_STARTS_HOUR = 4;

function termini(text: string): string[] {
  return TERMINI.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
}

/** The ODT's paragraphs, one per line, with tabs and spaces as typed. */
export function odtText(buffer: Buffer): string {
  let xml: string;
  try {
    xml = new AdmZip(buffer).readAsText('content.xml');
  } catch {
    throw new Error('New Taipei Metro timetable file is not an ODT');
  }
  if (!xml) throw new Error('New Taipei Metro timetable file has no content.xml');
  return xml
    .replace(/<\/text:(?:p|h)>|<text:line-break\/>/gu, '\n')
    .replace(/<text:tab\/>/gu, '\t')
    .replace(/<text:s(?: text:c="(\d+)")?\/>/gu, (_m, count?: string) => ' '.repeat(Number(count ?? 1)))
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&');
}

function dayKind(heading: string): DayKind | null {
  if (/假日|週六|週日/u.test(heading)) return 'offday';
  if (/平常日|平日/u.test(heading)) return 'weekday';
  return null;
}

/** The heading's direction: one terminus, null for "both branches", undefined when it names none. */
function headingToward(heading: string): string | null | undefined {
  const at = heading.indexOf('往');
  if (at < 0) return undefined;
  const named = termini(heading.slice(at));
  return named.length === 1 ? named[0] : null;
}

/** "15、30、35分往崁頂站" → minutes and the line's own direction, if any. */
function lineGroups(body: string): { minutes: number[]; toward?: string }[] {
  return body.split(/[，,；;]/u).flatMap((part) => {
    const at = part.indexOf('往');
    const digits = (at < 0 ? part : part.slice(0, at)).match(/\d{1,2}/gu) ?? [];
    if (!digits.length) return [];
    const named = at < 0 ? [] : termini(part.slice(at));
    if (named.length > 1) throw new Error(`Timetable line part "${part.trim()}" names two directions`);
    return [{ minutes: digits.map(Number), ...(named.length ? { toward: named[0] } : {}) }];
  });
}

/**
 * One station's ODT text as departures per day type and direction. `station` is the file's station
 * code (for a terminus that names no direction). Throws when a line cannot be read: a wrong table
 * is worse than none.
 */
export function parseStationTimetable(text: string, station: string): StationTimetable {
  const out: Record<DayKind, Record<string, Set<number>>> = { weekday: {}, offday: {} };
  let day: DayKind | null = null;
  let toward: string | null | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const hour = /^(\d{1,2})\s*時\s*[：:]?\s*(.*)$/u.exec(line);
    if (!hour) {
      const kind = dayKind(line);
      if (!kind) continue;
      day = kind;
      const named = headingToward(line);
      if (named !== undefined) toward = named;
      toward ??= ONLY_WAY[station] ?? null;
      continue;
    }
    if (!day) throw new Error(`Timetable hour line "${line}" comes before any 平常日 / 假日 heading`);
    const h = Number(hour[1]);
    if (h > 24) throw new Error(`Timetable hour line "${line}" has hour ${h}`);
    const base = (h < SERVICE_DAY_STARTS_HOUR ? h + 24 : h) * 60;
    for (const group of lineGroups(hour[2])) {
      const dir = group.toward ?? toward;
      if (!dir) throw new Error(`Timetable line "${line}" names no direction`);
      for (const m of group.minutes) {
        if (m > 59) throw new Error(`Timetable line "${line}" has minute ${m}`);
        (out[day][dir] ??= new Set()).add(base + m);
      }
    }
  }
  const sorted = (table: Record<string, Set<number>>): DirectionTimes =>
    Object.fromEntries(Object.entries(table).map(([dir, set]) => [dir, [...set].sort((a, b) => a - b)]));
  const result = { weekday: sorted(out.weekday), offday: sorted(out.offday) };
  if (!Object.keys(result.weekday).length || !Object.keys(result.offday).length) {
    throw new Error(`Timetable for ${station} lacks a 平常日 or a 假日 table`);
  }
  return result;
}

export interface TimetableFiles {
  /** The file in force until the new one starts, when the page still lists both. */
  previous?: string;
  /** The newest file (the only one on most pages). */
  latest: string;
  /** Day of the month the latest file starts on, when the page lists two. */
  fromDay?: number;
}

/** The page's ODT links (paths as written), split at the "新時刻表" paragraph. */
export function parseTimetablePage(html: string): TimetableFiles {
  const $ = load(html);
  const content = $('#is-content');
  if (!content.length) throw new Error('New Taipei Metro timetable page has no content area');
  const found: { href: string; isNew: boolean }[] = [];
  let marked = false;
  for (const el of content.find('p, a').toArray()) {
    const node = $(el);
    if (el.tagName === 'p' && node.text().replace(/\s+/gu, '') === '新時刻表') marked = true;
    const href = el.tagName === 'a' ? node.attr('href') ?? '' : '';
    if (/\.odt$/iu.test(href) && !found.some((f) => f.href === href)) found.push({ href, isNew: marked });
  }
  if (!found.length) throw new Error('New Taipei Metro timetable page links no ODT file');
  if (found.length === 1) return { latest: found[0].href };
  const fresh = found.filter((f) => f.isNew);
  const old = found.filter((f) => !f.isNew);
  const day = /(\d{1,2})日起使用新時刻表/u.exec(content.text());
  if (fresh.length !== 1 || old.length !== 1 || !day) {
    throw new Error(`New Taipei Metro timetable page lists ${found.length} ODT files without saying which applies when`);
  }
  return { previous: old[0].href, latest: fresh[0].href, fromDay: Number(day[1]) };
}

/**
 * The date a "N日起" switch means: the page gives only the day of the month, so it is read as the
 * date with that day nearest to when the new file was uploaded (Last-Modified, Taipei). The 淡海
 * files of 2026-10-19 → 2026-10-24, as the news (node 911) says: "10月24日（六）起實施全新列車時刻表".
 */
export function effectiveFrom(day: number, uploadedOn: string): string {
  const [y, m] = uploadedOn.split('-').map(Number);
  const anchor = Date.parse(`${uploadedOn}T00:00:00Z`);
  const candidates = [-1, 0, 1].flatMap((offset) => {
    const at = new Date(Date.UTC(y, m - 1 + offset, day));
    return at.getUTCDate() === day ? [at] : [];
  });
  const best = candidates.reduce((a, b) => (Math.abs(b.getTime() - anchor) <= Math.abs(a.getTime() - anchor) ? b : a));
  return best.toISOString().slice(0, 10);
}

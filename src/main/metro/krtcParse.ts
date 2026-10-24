/**
 * The KRTC pages the Kaohsiung sources read, as server-rendered on 2026-10-22:
 *
 * - The fare map's `stationtime.ashx?stationId=r11` (activity.krtc.com.tw): one origin to every
 *   station of the same network, `{"StationEnd":"R4","Time":"18","Fara":"35"}`. MRT times are
 *   minutes, light-rail times read "約22分鐘"; there are no MRT↔light-rail rows; a bad id is `[]`.
 * - Station timetables (`/Guide/train_times?n=R11`, `/KLRT/train_timesLRT?n=C1`): a tab per
 *   direction ("上行（往岡山車站）", "順行方向"), a row per hour ("6時" … "24時"), the minutes as
 *   spans. 美麗島's page carries both lines' tables. A span classed `noUplink` / `noDownlink` is
 *   a train whose riders cannot change at 美麗島 to the other line's 上行 (往岡山車站／往大寮) /
 *   下行 (往小港／往哈瑪星) train — the page's own legend.
 * - First/last trains (`/Guide/first_and_last_train`, `/KLRT/first_and_last_train`): per direction
 *   and day type, then the last train that still connects to the other line ("轉橘線(往 OT1 大寮方向)")
 *   or, on the light rail, the last that goes all the way round back to this stop. Past midnight
 *   the pages count on ("24:23").
 * - Every www page's header banner `#RtStatus`: a g/y/r dot and the words, one for the MRT and one
 *   for the light rail ("捷運全線正常營運", "輕軌營運異常").
 */
import { addDays, clockMinutes } from '../rail/railTime';
import type { LineStatus } from './metroTypes';
import { isDayBeforeOffDay, isOffDay } from './taiwanCalendar';

/**
 * KRTC's MRT day types, in KRTC's own words on every first/last-train page: "「平日」：為一般上班日且
 * 隔日非休假日之日型(如週一~週四)，「假日前一日」：當日為一般上班日且隔日為休假日之日型(如週五)".
 * Workdays and days off come from the official office calendar (`taiwanCalendar.ts`), so the day
 * before a weekday holiday is 假日前一日 and a make-up Saturday a workday. KRTC does not say which
 * of 週六 / 週日 a weekday holiday runs (its timetable, first/last, 營運服務規約 and FAQ pages read
 * 2026-10-22); `krtcDayType` reads it as 週六 when the next day is off too and 週日 when work
 * follows, as in an ordinary weekend, and the quote says so.
 */
export type KrtcDayType = '平日' | '假日前一日' | '週六' | '週日';
/** The light rail's pages list only 平日 and 假日. */
export type KlrtDayType = '平日' | '假日';

export function krtcDayType(date: string): KrtcDayType {
  if (!isOffDay(date)) return isDayBeforeOffDay(date) ? '假日前一日' : '平日';
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 6) return '週六';
  if (day === 0) return '週日';
  return isOffDay(addDays(date, 1)) ? '週六' : '週日';
}

export function klrtDayType(date: string): KlrtDayType {
  return isOffDay(date) ? '假日' : '平日';
}

/** The timetable page for a day type: 週六 is KRTC's `_holiday` page. */
export const KRTC_TIMETABLE_SUFFIX: Readonly<Record<KrtcDayType, string>> = {
  平日: '', 假日前一日: '_before_holiday', 週六: '_holiday', 週日: '_sunday',
};

export const KLRT_TIMETABLE_SUFFIX: Readonly<Record<KlrtDayType, string>> = { 平日: '', 假日: '_holiday' };

export interface KrtcFareRow {
  minutes?: number;
  fare: number;
}

/** The fare map's rows by destination id in upper case ("R4", "O5R10", "C21A"). */
export function parseKrtcFareMap(json: unknown): Map<string, KrtcFareRow> {
  if (!Array.isArray(json)) throw new Error('KRTC fare map answer is not a list');
  const rows = new Map<string, KrtcFareRow>();
  for (const item of json as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const fare = Number(row.Fara);
    const end = typeof row.StationEnd === 'string' ? row.StationEnd.trim().toUpperCase() : '';
    if (!end || !Number.isFinite(fare) || fare <= 0) continue;
    const minutes = Number(/\d+/u.exec(String(row.Time ?? ''))?.[0]);
    rows.set(end, { fare, ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {}) });
  }
  return rows;
}

function text(html: string): string {
  return html.replace(/<[^>]*>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** "上行（往岡山車站）" → 上行 + 岡山車站; "順行方向" → 順行. */
export function directionLabel(raw: string): { label: string; toward?: string } {
  const words = text(raw).replace(/\s+/gu, '');
  const toward = /[（(]往([^）)]+)[）)]/u.exec(words)?.[1];
  const label = words.replace(/[（(][^）)]*[）)]/gu, '').replace(/方向$/u, '');
  return { label, ...(toward ? { toward } : {}) };
}

const DIRECTION_WORD = /^(上行|下行|順行|逆行)/u;

export interface KrtcTimetableTrain {
  /** Minutes after the service day's midnight; past midnight runs on (24:11 = 1451). */
  minutes: number;
  /** The page's span classes (`noUplink`, `noDownlink`). */
  flags: readonly string[];
}

export interface KrtcTimetable {
  label: string;
  toward?: string;
  trains: readonly KrtcTimetableTrain[];
}

/** Every direction table on a station timetable page, in page order. */
export function parseKrtcTimetable(html: string): KrtcTimetable[] {
  const tabs = [...html.matchAll(/<a href="#([\w-]+)"><strong>([\s\S]*?)<\/strong><\/a>/gu)];
  const out: KrtcTimetable[] = [];
  for (const [, id, raw] of tabs) {
    const start = html.indexOf(`<div id="${id}"`);
    if (start < 0) continue;
    const next = html.indexOf('<div id="tabs', start + 1);
    const body = html.slice(start, next < 0 ? undefined : next);
    const trains: KrtcTimetableTrain[] = [];
    for (const row of body.split(/<tr[\s>]/u)) {
      const hour = Number(/<th>\s*(\d{1,2})\s*時\s*<\/th>/u.exec(row)?.[1]);
      if (!Number.isFinite(hour)) continue;
      for (const span of row.matchAll(/<span class="([^"]*)">\s*(\d{1,2})\s*<\/span>/gu)) {
        trains.push({ minutes: hour * 60 + Number(span[2]), flags: span[1].split(/\s+/u).filter(Boolean) });
      }
    }
    if (trains.length > 0) out.push({ ...directionLabel(raw), trains: trains.sort((a, b) => a.minutes - b.minutes) });
  }
  return out;
}

export interface KrtcFirstLast {
  label: string;
  toward?: string;
  /** By day type: first and last train, minutes, past midnight counted on. */
  days: Record<string, { first?: number; last?: number }>;
}

export interface KrtcFirstLastPage {
  directions: KrtcFirstLast[];
  /** The last train that still connects ("轉橘線(往 OT1 大寮方向)") or, on the light rail, goes round ("順行"), by day type. */
  connections: { label: string; days: Record<string, number> }[];
}

const CONNECTION_TITLE = /可轉乘其他路線之最後一班車時間|可繞行環狀回本車站之最後一班車時間/u;

export function parseKrtcFirstLast(html: string): KrtcFirstLastPage {
  const start = html.indexOf('<div class="trainTimeList">');
  if (start < 0) throw new Error('KRTC first/last train page has no train list');
  const end = html.indexOf('infoWord', start);
  const body = html.slice(start, end < 0 ? undefined : end);
  const split = CONNECTION_TITLE.exec(body);
  const main = split ? body.slice(0, split.index) : body;
  const tail = split ? body.slice(split.index) : '';
  const directions: KrtcFirstLast[] = [];
  let day = '';
  for (const m of main.matchAll(/<dt>([\s\S]*?)<\/dt>|<li><span>([^<]*)<\/span>\s*(\d{1,2}:\d{2})\s*<\/li>/gu)) {
    if (m[1] !== undefined) {
      const words = text(m[1]);
      if (DIRECTION_WORD.test(words)) directions.push({ ...directionLabel(m[1]), days: {} });
      else day = words;
      continue;
    }
    const current = directions.at(-1);
    if (!current || !day) continue;
    const slot = (current.days[day] ??= {});
    const kind = m[2].trim();
    if (kind === '首班車') slot.first = clockMinutes(m[3]);
    if (kind === '末班車') slot.last = clockMinutes(m[3]);
  }
  const connections: KrtcFirstLastPage['connections'] = [];
  for (const m of tail.matchAll(/<dt>([\s\S]*?)<\/dt>|<li><span>([^<]*)<\/span>\s*(\d{1,2}:\d{2})\s*<\/li>/gu)) {
    if (m[1] !== undefined) connections.push({ label: text(m[1]), days: {} });
    else if (connections.length > 0) connections[connections.length - 1].days[m[2].trim()] = clockMinutes(m[3]);
  }
  if (directions.length === 0) throw new Error('KRTC first/last train page lists no direction');
  return { directions, connections };
}

/** The header banner's lines: 捷運 and 輕軌. */
export function parseKrtcStatus(html: string, source: string): LineStatus[] {
  const start = html.indexOf('id="RtStatus"');
  if (start < 0) throw new Error('KRTC page has no status banner');
  const end = html.indexOf('</nav>', start);
  const block = html.slice(start, end < 0 ? start + 2_000 : end);
  const lines: LineStatus[] = [];
  for (const m of block.matchAll(/<div class=['"]([a-z]+) ci['"]><\/div>([^<]*)</gu)) {
    const words = m[2].trim();
    if (!words) continue;
    const line = words.startsWith('輕軌') ? '輕軌' : words.startsWith('捷運') ? '捷運' : words;
    const normal = m[1] === 'g' ? true : m[1] === 'y' || m[1] === 'r' ? false : null;
    lines.push({ operator: 'krtc', line, normal, text: words, source });
  }
  if (lines.length === 0) throw new Error('KRTC status banner is empty');
  return lines;
}

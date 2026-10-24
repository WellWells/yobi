/**
 * Taichung MRT read from the JSON API behind its own site (`www.tmrt.com.tw/api/public/*`, plain
 * GET, no key, no throttling met on 2026-10-22):
 *
 * - `Site/AllSite` is every station with its first and last train per direction as minutes after
 *   midnight (fields without `U` = toward 高鐵臺中站, with `U` = toward 北屯總站; weekday / holiday
 *   pairs) and the headways (peak / off-peak / late night). A terminal's own direction is 0 / 0,
 *   and a last train past midnight is a small number (舊社 toward 北屯總站 = 47 → 00:47), so it is
 *   counted on past 24:00. `ServiceStopTimeStr` says 23:00 while the last trains run to ~00:50
 *   (`ServiceRemark` "末班車凌晨0時50分抵達北屯總站"), so only the per-station fields are used. The
 *   API's headways miss the 2026-04-01 northbound 17:20–17:50 4:45 tweak announced on the site.
 * - `FareTime/<id>?stop=<id>` is one pair: `GeneralFare` is the 單程票 (token) price,
 *   `ElectronicFare` the 電子票證 (card) price, `RespectFare` the 敬老卡、愛心卡、愛心陪伴卡 price —
 *   the column headings of the site's fare table — and `SpendTime` the ride in minutes (35.5).
 *   The two full fares were equal on every pair read (北屯總站 and 舊社 to all 17 others).
 * - `runstatus` is the banner: `{"RunStatus":"全線正常營運（目前班距9分鐘）","RunColor":"Green"}`.
 *
 * Taichung MRT publishes no station timetable and no arrival board, so there are no departures;
 * the headway goes in the notes.
 */
import { browserHeaders, railJson } from '../rail/railHttp';
import type { FetchFn } from '../rail/railHttp';
import { DAY_MINUTES } from '../rail/railTime';
import type { LegQuote, LineStatus, MetroDeps, MetroStation, NetworkSource, QuoteWhen, StatusSource, TicketPrice } from './metroTypes';
import { stationNode } from './metroTypes';
import { TMRT_LINE_NAME, TMRT_TERMINALS, tidyTmrtName, tmrtIndex } from './tmrtStations';
import { calendarKnown, isOffDay, isWeekdayHoliday } from './taiwanCalendar';

const API = 'https://www.tmrt.com.tw/api/public/';
export const TMRT_HOME = 'https://www.tmrt.com.tw/';
export const TMRT_FARE_PAGE = 'https://www.tmrt.com.tw/metro-life/ride-time-and-fare';
export const TMRT_FIRST_LAST_PAGE = 'https://www.tmrt.com.tw/metro-life/first-last-train';

const DAY_MS = 86_400_000;
const SITES_TTL_MS = 12 * 3_600_000;
const STATUS_TTL_MS = 60_000;
/** A "last train" earlier than this is after midnight. */
const SMALL_HOURS = 180;

export const TMRT_CONCESSION_KIND = '敬老卡、愛心卡、愛心陪伴卡';

export type TmrtDayType = 'weekday' | 'holiday';
/** south = toward 高鐵臺中站, north = toward 北屯總站. */
export type TmrtDirection = 'south' | 'north';

export interface TmrtTimes {
  first: number;
  /** Past midnight counted on (24:47 = 1487). */
  last?: number;
}

export interface TmrtHeadway {
  /** Seconds between trains. */
  peak: number;
  offPeak: number;
  lateNight: number;
}

export interface TmrtSite {
  id: string;
  code: string;
  zh: string;
  en: string;
  trains: Record<TmrtDayType, Partial<Record<TmrtDirection, TmrtTimes>>>;
  headway: Record<TmrtDayType, TmrtHeadway>;
  /** The site's own peak-hour wording per day type ("平日(週一到週五)尖峰時段：07:00-09:00、17:00-19:00。"). */
  peakRemark: Partial<Record<TmrtDayType, string>>;
  serviceRemark?: string;
}

export interface TmrtFare {
  card: number;
  single: number;
  concession?: number;
  minutes?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function times(row: Record<string, unknown>, first: string, last: string): TmrtTimes | undefined {
  const start = num(row[first]) ?? 0;
  // A terminal has no train toward itself: both fields are 0.
  if (start <= 0) return undefined;
  const end = num(row[last]);
  if (end === undefined) return { first: start };
  return { first: start, last: end < SMALL_HOURS ? end + DAY_MINUTES : end };
}

function headway(row: Record<string, unknown>, day: 'Weekday' | 'Holiday'): TmrtHeadway {
  const seconds = (band: string) => (num(row[`${band}Minute${day}`]) ?? 0) * 60 + (num(row[`${band}Second${day}`]) ?? 0);
  return { peak: seconds('Peak'), offPeak: seconds('OffPeak'), lateNight: seconds('LateNight') };
}

function peakRemarks(text: unknown): Partial<Record<TmrtDayType, string>> {
  const lines = typeof text === 'string' ? text.split(/\r?\n/u).map((line) => line.trim()) : [];
  const weekday = lines.find((line) => line.startsWith('平日'));
  const holiday = lines.find((line) => line.startsWith('假日'));
  return { ...(weekday ? { weekday } : {}), ...(holiday ? { holiday } : {}) };
}

/** `Site/AllSite` in line order; throws on anything that is not the station list. */
export function parseTmrtSites(json: unknown): TmrtSite[] {
  if (!Array.isArray(json) || json.length === 0) throw new Error('Taichung MRT station list is empty');
  const rows = json.map(record).filter((row) => typeof row.ID === 'string' && typeof row.SiteCode === 'string');
  if (rows.length === 0) throw new Error('Taichung MRT station list has no stations');
  rows.sort((a, b) => (num(a.SequenceNo) ?? 0) - (num(b.SequenceNo) ?? 0));
  return rows.map((row) => {
    const remark = typeof row.ServiceRemark === 'string' ? row.ServiceRemark.trim() : '';
    const trains = (day: 'Weekday' | 'Holiday') => {
      const south = times(row, `First${day}Time`, `Last${day}Time`);
      const north = times(row, `First${day}TimeU`, `Last${day}TimeU`);
      return { ...(south ? { south } : {}), ...(north ? { north } : {}) };
    };
    return {
      id: String(row.ID),
      code: String(row.SiteCode).trim(),
      zh: tidyTmrtName(String(row.SiteName ?? '')),
      en: tidyTmrtName(String(row.SiteNameEn ?? '')),
      trains: { weekday: trains('Weekday'), holiday: trains('Holiday') },
      headway: { weekday: headway(row, 'Weekday'), holiday: headway(row, 'Holiday') },
      peakRemark: peakRemarks(row.TimeRemarkWeb),
      ...(remark ? { serviceRemark: remark } : {}),
    };
  });
}

/** One `FareTime/<id>?stop=<id>` answer (an object; a one-row array is accepted too). */
export function parseTmrtFare(json: unknown): TmrtFare {
  const row = record(Array.isArray(json) ? json[0] : json);
  const card = num(row.ElectronicFare);
  const single = num(row.GeneralFare);
  if (card === undefined || single === undefined || card <= 0) throw new Error('Taichung MRT fare answer has no fare');
  const concession = num(row.RespectFare);
  const minutes = num(row.SpendTime);
  return { card, single, ...(concession !== undefined ? { concession } : {}), ...(minutes !== undefined && minutes > 0 ? { minutes } : {}) };
}

export function parseTmrtStatus(json: unknown, source: string): LineStatus[] {
  const row = record(json);
  const text = typeof row.RunStatus === 'string' ? row.RunStatus.trim() : '';
  if (!text) throw new Error('Taichung MRT status answer has no status');
  const color = typeof row.RunColor === 'string' ? row.RunColor.toLowerCase() : '';
  const normal = color === 'green' ? true : color === 'yellow' || color === 'red' ? false : null;
  return [{ operator: 'tmrt', line: '臺中捷運', normal, text, source }];
}

async function getApi(fetchFn: FetchFn, path: string, signal?: AbortSignal): Promise<unknown> {
  const url = `${API}${path}`;
  return railJson(fetchFn, url, { headers: browserHeaders(url, { Accept: 'application/json' }) }, signal);
}

export async function fetchTmrtSites(fetchFn: FetchFn, signal?: AbortSignal): Promise<TmrtSite[]> {
  return parseTmrtSites(await getApi(fetchFn, 'Site/AllSite', signal));
}

export async function fetchTmrtFare(fetchFn: FetchFn, fromId: string, toId: string, signal?: AbortSignal): Promise<TmrtFare> {
  return parseTmrtFare(await getApi(fetchFn, `FareTime/${encodeURIComponent(fromId)}?stop=${encodeURIComponent(toId)}`, signal));
}

/**
 * The 假日 service runs on "週六、週日及國定假日" (the API's own `TimeRemarkWeb`: "假日(週六、週日及
 * 國定假日)尖峰時段", "平日(週一到週五)"), so on the official office calendar's days off.
 */
export function tmrtDayType(date: string): TmrtDayType {
  return isOffDay(date) ? 'holiday' : 'weekday';
}

/** What the quote says about the day type: nothing on an ordinary day the calendar covers. */
export function tmrtDayNote(date: string): string | undefined {
  if (!calendarKnown(date)) {
    return `Read as ${tmrtDayType(date) === 'weekday' ? '平日 (Mon–Fri)' : '假日'} from the weekday: the official holiday calendar for ${date.slice(0, 4)} is not bundled, so national holidays (which run the 假日 service) could not be checked.`;
  }
  return isWeekdayHoliday(date) ? `${date} is a national holiday on the official office calendar, so Taichung MRT runs its 假日 service.` : undefined;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function gap(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
}

/** The headway sentence: the only timing Taichung MRT publishes besides first and last trains. */
export function tmrtHeadwayNote(site: TmrtSite, day: TmrtDayType): string {
  const { peak, offPeak, lateNight } = site.headway[day];
  const label = day === 'weekday' ? '平日' : '假日';
  const remark = site.peakRemark[day];
  return `Taichung MRT publishes no timetable; trains run every ${gap(peak)} at peak, ${gap(offPeak)} off-peak and ${gap(lateNight)} late at night (${label})${remark ? `. ${remark}` : '.'}`;
}

function stationOf(station: MetroStation): { id: string; index: number } {
  const index = tmrtIndex(station);
  if (index < 0 || !station.ref) throw new Error(`${station.zh} is not a Taichung MRT station`);
  return { id: station.ref, index };
}

function reason(result: PromiseSettledResult<unknown>): string {
  return result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : 'no answer';
}

async function quote(from: MetroStation, to: MetroStation, when: QuoteWhen, deps: MetroDeps): Promise<LegQuote> {
  const start = stationOf(from);
  const stop = stationOf(to);
  if (start.id === stop.id) throw new Error(`${from.zh} to ${to.zh} is the same Taichung MRT station`);
  const { fetchFn, memo, signal } = deps;
  const [fareResult, sitesResult] = await Promise.allSettled([
    memo(`tmrt-fare-${start.id}-${stop.id}`, DAY_MS, () => fetchTmrtFare(fetchFn, start.id, stop.id, signal)),
    memo('tmrt-sites', SITES_TTL_MS, () => fetchTmrtSites(fetchFn, signal)),
  ]);
  if (fareResult.status === 'rejected') throw new Error(`Taichung MRT gave no fare from ${from.zh} to ${to.zh}: ${reason(fareResult)}`);
  const fare = fareResult.value;
  const direction: TmrtDirection = stop.index > start.index ? 'south' : 'north';
  const day = tmrtDayType(when.date);
  const site = sitesResult.status === 'fulfilled' ? sitesResult.value.find((s) => s.id === start.id) : undefined;
  const trains = site?.trains[day][direction];
  const tickets: TicketPrice[] = fare.concession !== undefined ? [{ kind: TMRT_CONCESSION_KIND, ntd: fare.concession }] : [];
  const notes: string[] = [];
  if (site) notes.push(tmrtHeadwayNote(site, day));
  else notes.push(`First/last train and headway unavailable: Taichung MRT's station list did not answer (${reason(sitesResult)}).`);
  const dayNote = tmrtDayNote(when.date);
  if (dayNote) notes.push(dayNote);
  const arrivalRemark = sitesResult.status === 'fulfilled' ? sitesResult.value.find((s) => s.id === stop.id)?.serviceRemark : undefined;
  if (arrivalRemark) notes.push(arrivalRemark);
  return {
    network: 'tmrt',
    from: stationNode(from),
    to: stationNode(to),
    fare: fare.card,
    ...(fare.single !== fare.card ? { singleTicket: fare.single } : {}),
    ...(tickets.length > 0 ? { tickets } : {}),
    ...(fare.minutes !== undefined ? { minutes: fare.minutes } : {}),
    route: `${TMRT_LINE_NAME}（往${TMRT_TERMINALS[direction]}）`,
    ...(trains ? { firstTrain: clock(trains.first) } : {}),
    ...(trains?.last !== undefined ? { lastTrain: clock(trains.last) } : {}),
    notes,
    sources: site ? [TMRT_FARE_PAGE, TMRT_FIRST_LAST_PAGE] : [TMRT_FARE_PAGE],
  };
}

export const tmrtSource: NetworkSource = { network: 'tmrt', quote };

export const tmrtStatus: StatusSource = {
  operator: 'tmrt',
  status: (deps) => deps.memo('tmrt-status', STATUS_TTL_MS, async () => parseTmrtStatus(await getApi(deps.fetchFn, 'runstatus', deps.signal), TMRT_HOME)),
};

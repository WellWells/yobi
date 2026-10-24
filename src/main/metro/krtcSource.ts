/**
 * Kaohsiung MRT (krtc: Red + Orange, one fare system) and the Circular Light Rail (klrt), read
 * from KRTC's own pages (see `krtcParse.ts` for what each page holds). One quote is three pages
 * at most: the origin's fare map row (kept a day, it prices every trip from that station), its
 * first/last-train page and its station timetable for the day type (both kept a day). There is
 * no live countdown here: the arrival board is an ASP.NET postback with view state (easygo), and
 * the timetable already answers "next train" for any time.
 *
 * KRTC's 一卡通 普卡 pays the 單程票 price ("車資費率：單程票價"), so one number is both; 社福單程票
 * is half of it, rounded down ("單程票半價", "不足 1 元之數值採用無條件捨去"). The light rail lists
 * one price too ("依高雄輕軌公告票價") and no other ticket kinds.
 */
import { browserHeaders, railJson, railText } from '../rail/railHttp';
import type { FetchFn } from '../rail/railHttp';
import { DAY_MINUTES, addDays } from '../rail/railTime';
import type { LegQuote, MetroDeparture, MetroDeps, MetroStation, NetworkSource, QuoteWhen, StatusSource } from './metroTypes';
import { stationNode } from './metroTypes';
import { KLRT_RING, KRTC_LINE_ORDER, krtcLineOf } from './krtcStations';
import {
  KLRT_TIMETABLE_SUFFIX, KRTC_TIMETABLE_SUFFIX, klrtDayType, krtcDayType, parseKrtcFareMap, parseKrtcFirstLast, parseKrtcStatus, parseKrtcTimetable,
} from './krtcParse';
import type { KrtcDayType, KrtcFareRow, KrtcFirstLastPage, KrtcTimetable, KrtcTimetableTrain } from './krtcParse';
import { calendarKnown, isWeekdayHoliday } from './taiwanCalendar';

const WWW = 'https://www.krtc.com.tw';
const FARE_MAP = 'https://activity.krtc.com.tw/Activity/measygo/map/';
export const KRTC_NOTICE_PAGE = `${WWW}/Information/notice`;

const DAY_MS = 86_400_000;
const STATUS_TTL_MS = 60_000;
/** Asked before this, the previous service day's last trains may still be running. */
const SMALL_HOURS = 180;
const MAX_DEPARTURES = 5;

type MrtLine = 'R' | 'O';

const LINE_NAME: Readonly<Record<MrtLine, string>> = { R: '紅線', O: '橘線' };
/** Each line's ends as the timetables sign them: 上行 runs up the code order. */
const TOWARD: Readonly<Record<MrtLine, { up: string; down: string }>> = {
  R: { up: '岡山車站', down: '小港' },
  O: { up: '大寮', down: '哈瑪星' },
};
const TRANSFER_CODE: Readonly<Record<MrtLine, string>> = { R: 'R10', O: 'O5' };

export function krtcFareApi(ref: string): string {
  return `${FARE_MAP}stationtime.ashx?stationId=${encodeURIComponent(ref)}`;
}

/** The fare map a rider opens, centred on the origin. */
export function krtcFareMapPage(ref: string): string {
  return `${FARE_MAP}ticket.aspx?issearchtime=1&station=${encodeURIComponent(ref)}`;
}

export function krtcFirstLastPage(line: string, code: string): string {
  return `${WWW}/Guide/first_and_last_train?KRTCSLLine=${line}&KRTCStation=${code}`;
}

export function klrtFirstLastPage(code: string): string {
  return `${WWW}/KLRT/first_and_last_train?KRTCStation=${code}`;
}

export function krtcTimetablePage(code: string, suffix: string): string {
  return `${WWW}/Guide/train_times${suffix}?n=${code}`;
}

export function klrtTimetablePage(code: string, suffix: string): string {
  return `${WWW}/KLRT/train_timesLRT${suffix}?n=${code}`;
}

async function page(fetchFn: FetchFn, url: string, signal?: AbortSignal): Promise<string> {
  return railText(fetchFn, url, { headers: browserHeaders(url) }, signal);
}

export async function fetchKrtcFareMap(fetchFn: FetchFn, ref: string, signal?: AbortSignal): Promise<Map<string, KrtcFareRow>> {
  const url = krtcFareApi(ref);
  const rows = parseKrtcFareMap(await railJson(fetchFn, url, { headers: browserHeaders(url, { Accept: 'application/json' }) }, signal));
  if (rows.size === 0) throw new Error(`KRTC fare map knows no station ${ref}`);
  return rows;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function reason(result: PromiseSettledResult<unknown>): string {
  return result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : 'no answer';
}

function value<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}

/**
 * The next trains at or after the asked time, earliest first, as times of the asked date. Asked in
 * the small hours, the previous service day's tail ("24:11") comes first, as 00:11.
 */
export async function nextTrains(
  tableFor: (date: string) => Promise<KrtcTimetable | undefined>,
  keep: (train: KrtcTimetableTrain) => boolean,
  when: QuoteWhen,
): Promise<number[]> {
  const times: number[] = [];
  if (when.minutes < SMALL_HOURS) {
    const before = await tableFor(addDays(when.date, -1));
    for (const train of before?.trains ?? []) if (keep(train) && train.minutes - DAY_MINUTES >= when.minutes) times.push(train.minutes - DAY_MINUTES);
  }
  const today = await tableFor(when.date);
  for (const train of today?.trains ?? []) if (keep(train) && train.minutes >= when.minutes) times.push(train.minutes);
  return times.slice(0, MAX_DEPARTURES);
}

/** KRTC's own words on its timetable pages: 除夕, 跨年 and the like do not follow the timetable. */
const SPECIAL_HOLIDAYS = 'KRTC adjusts headways on special holidays (除夕, 跨年…) and the timetable does not apply then.';

/** Whether the official calendar covers the date and the day after (假日前一日 looks a day ahead). */
function holidaysKnown(date: string): boolean {
  return calendarKnown(date) && calendarKnown(addDays(date, 1));
}

/** What the quote says about the day type: nothing on an ordinary day the calendar covers. */
export function krtcDayNote(date: string, day: KrtcDayType): string | undefined {
  if (!holidaysKnown(date)) {
    return `Read as KRTC's ${day} timetable from the weekday: the official holiday calendar for ${date.slice(0, 4)} is not bundled, so national holidays could not be checked (a workday before a day off runs 假日前一日, holidays run holiday timetables); around holidays check the official page.`;
  }
  if (!isWeekdayHoliday(date)) return undefined;
  return `${date} is a national holiday on the official office calendar. KRTC does not say which of its 週六/週日 timetables a weekday holiday runs; read as ${day} (週六 when the next day is off too, else 週日). ${SPECIAL_HOLIDAYS}`;
}

export function klrtDayNote(date: string): string | undefined {
  if (!calendarKnown(date)) {
    return `Read as the light rail's ${klrtDayType(date)} timetable from the weekday: the official holiday calendar for ${date.slice(0, 4)} is not bundled, so national holidays (which may run 假日) could not be checked.`;
  }
  if (!isWeekdayHoliday(date)) return undefined;
  return `${date} is a national holiday on the official office calendar, read as the light rail's 假日 timetable. ${SPECIAL_HOLIDAYS}`;
}

function departures(times: readonly number[], toward?: string): MetroDeparture[] {
  return times.map((minutes) => ({ time: clock(minutes), ...(toward ? { toward } : {}) }));
}

interface MrtRide {
  line: MrtLine;
  code: string;
  up: boolean;
}

function codeOn(station: MetroStation, line: MrtLine): string | undefined {
  return station.codes.find((code) => krtcLineOf(code) === line);
}

function ride(line: MrtLine, fromCode: string, toCode: string): MrtRide {
  const order = KRTC_LINE_ORDER[line];
  return { line, code: fromCode, up: order.indexOf(toCode) > order.indexOf(fromCode) };
}

/** The first ride from `from` and, across the two lines, the second from 美麗島. */
export function krtcPlan(from: MetroStation, to: MetroStation): { first: MrtRide; second?: MrtRide } {
  const shared = (['R', 'O'] as const).find((line) => codeOn(from, line) && codeOn(to, line));
  if (shared) return { first: ride(shared, codeOn(from, shared) ?? '', codeOn(to, shared) ?? '') };
  const a = krtcLineOf(from.codes[0]) as MrtLine;
  const b = krtcLineOf(to.codes[0]) as MrtLine;
  return { first: ride(a, from.codes[0], TRANSFER_CODE[a]), second: ride(b, TRANSFER_CODE[b], to.codes[0]) };
}

function towardOf(r: MrtRide): string {
  return r.up ? TOWARD[r.line].up : TOWARD[r.line].down;
}

/** The last train from this station that still makes the change, for the day type. */
export function connectionLast(page: KrtcFirstLastPage, second: MrtRide, day: string): number | undefined {
  const lineWord = `轉${LINE_NAME[second.line]}`;
  const toward = towardOf(second);
  const ofLine = page.connections.filter((c) => c.label.startsWith(lineWord));
  const ranked = [
    ...ofLine.filter((c) => c.label.includes(toward)),
    ...ofLine.filter((c) => c.label.includes('全') || !/[(（]/u.test(c.label)),
  ];
  return ranked.find((c) => c.days[day] !== undefined)?.days[day];
}

function mrtStation(station: MetroStation): string {
  if (station.network !== 'krtc' || !station.ref) throw new Error(`${station.zh} is not a Kaohsiung MRT station`);
  return station.ref;
}

async function quoteKrtc(from: MetroStation, to: MetroStation, when: QuoteWhen, deps: MetroDeps): Promise<LegQuote> {
  const fromRef = mrtStation(from);
  const toRef = mrtStation(to);
  if (fromRef === toRef) throw new Error(`${from.zh} to ${to.zh} is the same Kaohsiung MRT station`);
  const { fetchFn, memo, signal } = deps;
  const { first, second } = krtcPlan(from, to);
  const toward = towardOf(first);
  const day = krtcDayType(when.date);
  const blocked = second ? (second.up ? 'noUplink' : 'noDownlink') : undefined;
  const tableFor = async (date: string) => {
    const suffix = KRTC_TIMETABLE_SUFFIX[krtcDayType(date)];
    const tables = await memo(`krtc-tt-${first.code}${suffix}`, DAY_MS, async () =>
      parseKrtcTimetable(await page(fetchFn, krtcTimetablePage(first.code, suffix), signal)));
    return tables.find((t) => t.toward === toward);
  };
  const [fares, flt, next] = await Promise.allSettled([
    memo(`krtc-fares-${fromRef}`, DAY_MS, () => fetchKrtcFareMap(fetchFn, fromRef, signal)),
    memo(`krtc-flt-${first.line}-${first.code}`, DAY_MS, async () =>
      parseKrtcFirstLast(await page(fetchFn, krtcFirstLastPage(first.line, first.code), signal))),
    nextTrains(tableFor, (train) => !blocked || !train.flags.includes(blocked), when),
  ]);
  const row = value(fares)?.get(toRef.toUpperCase());
  if (!row) throw new Error(`KRTC gave no fare from ${from.zh} to ${to.zh}: ${fares.status === 'rejected' ? reason(fares) : 'pair not on the fare map'}`);
  const notes: string[] = [];
  const pageOf = value(flt);
  const times = pageOf?.directions.find((d) => d.toward === toward)?.days[day];
  const connects = pageOf && second ? connectionLast(pageOf, second, day) : undefined;
  const last = connects ?? times?.last;
  const route = second
    ? `${LINE_NAME[first.line]}（往${toward}）→ 美麗島轉${LINE_NAME[second.line]}（往${towardOf(second)}）`
    : `${LINE_NAME[first.line]}（往${toward}）`;
  if (second) notes.push(`Change at 美麗島; trains whose riders cannot make the change to the ${LINE_NAME[second.line]} are left out, and the last train is the last that connects.`);
  const dayNote = krtcDayNote(when.date, day);
  if (dayNote) notes.push(dayNote);
  if (next.status === 'rejected') notes.push(`Departures unavailable: KRTC's station timetable did not answer (${reason(next)}).`);
  if (flt.status === 'rejected') notes.push(`First/last train unavailable: KRTC's first/last train page did not answer (${reason(flt)}).`);
  const list = departures(value(next) ?? [], toward);
  return {
    network: 'krtc',
    from: stationNode(from),
    to: stationNode(to),
    fare: row.fare,
    tickets: [{ kind: '社福單程票', ntd: Math.floor(row.fare / 2) }],
    ...(row.minutes !== undefined ? { minutes: row.minutes } : {}),
    route,
    ...(list.length > 0 ? { departures: list } : {}),
    ...(times?.first !== undefined ? { firstTrain: clock(times.first) } : {}),
    ...(last !== undefined ? { lastTrain: clock(last) } : {}),
    notes,
    sources: [krtcFareMapPage(fromRef), krtcTimetablePage(first.code, KRTC_TIMETABLE_SUFFIX[day]), krtcFirstLastPage(first.line, first.code)],
  };
}

/** Which way round the ring is shorter (順行 on a tie), and whether the ride passes C1, where trains start and end. */
export function klrtPlan(fromCode: string, toCode: string): { direction: '順行' | '逆行'; stops: number; passesC1: boolean } {
  const n = KLRT_RING.length;
  const i = KLRT_RING.indexOf(fromCode);
  const j = KLRT_RING.indexOf(toCode);
  const ahead = (j - i + n) % n;
  const back = (i - j + n) % n;
  if (ahead <= back) return { direction: '順行', stops: ahead, passesC1: i !== 0 && j !== 0 && j < i };
  return { direction: '逆行', stops: back, passesC1: i !== 0 && j !== 0 && j > i };
}

async function quoteKlrt(from: MetroStation, to: MetroStation, when: QuoteWhen, deps: MetroDeps): Promise<LegQuote> {
  if (from.network !== 'klrt' || to.network !== 'klrt' || !from.ref || !to.ref) throw new Error(`${from.zh} to ${to.zh} is not a Kaohsiung light rail trip`);
  if (from.ref === to.ref) throw new Error(`${from.zh} to ${to.zh} is the same light rail stop`);
  const { fetchFn, memo, signal } = deps;
  const code = from.codes[0];
  const plan = klrtPlan(code, to.codes[0]);
  const day = klrtDayType(when.date);
  const [fltResult] = await Promise.allSettled([
    memo(`klrt-flt-${code}`, DAY_MS, async () => parseKrtcFirstLast(await page(fetchFn, klrtFirstLastPage(code), signal))),
  ]);
  const flt = value(fltResult);
  // A ride through C1 needs a train that goes on round; after the last such train they end at C1.
  const roundLast = plan.passesC1 ? flt?.connections.find((c) => c.label === plan.direction)?.days[day] : undefined;
  const tableFor = async (date: string) => {
    const suffix = KLRT_TIMETABLE_SUFFIX[klrtDayType(date)];
    const tables = await memo(`klrt-tt-${code}${suffix}`, DAY_MS, async () =>
      parseKrtcTimetable(await page(fetchFn, klrtTimetablePage(code, suffix), signal)));
    return tables.find((t) => t.label === plan.direction);
  };
  const [fares, next] = await Promise.allSettled([
    memo(`klrt-fares-${from.ref}`, DAY_MS, () => fetchKrtcFareMap(fetchFn, from.ref ?? '', signal)),
    nextTrains(tableFor, (train) => roundLast === undefined || train.minutes <= roundLast, when),
  ]);
  const row = value(fares)?.get(to.codes[0]);
  if (!row) throw new Error(`KRTC gave no light rail fare from ${from.zh} to ${to.zh}: ${fares.status === 'rejected' ? reason(fares) : 'pair not on the fare map'}`);
  const times = flt?.directions.find((d) => d.label === plan.direction)?.days[day];
  const last = plan.passesC1 ? roundLast ?? times?.last : times?.last;
  const notes: string[] = [];
  if (plan.passesC1) notes.push('This ride passes C1 籬仔內, where late trains end; departures and the last train are those that go on round.');
  const dayNote = klrtDayNote(when.date);
  if (dayNote) notes.push(dayNote);
  if (next.status === 'rejected') notes.push(`Departures unavailable: KRTC's light rail timetable did not answer (${reason(next)}).`);
  if (fltResult.status === 'rejected') notes.push(`First/last train unavailable: KRTC's light rail first/last page did not answer (${reason(fltResult)}).`);
  const list = departures(value(next) ?? []);
  return {
    network: 'klrt',
    from: stationNode(from),
    to: stationNode(to),
    fare: row.fare,
    ...(row.minutes !== undefined ? { minutes: row.minutes } : {}),
    route: `環狀輕軌（${plan.direction}）`,
    ...(list.length > 0 ? { departures: list } : {}),
    ...(times?.first !== undefined ? { firstTrain: clock(times.first) } : {}),
    ...(last !== undefined ? { lastTrain: clock(last) } : {}),
    notes,
    sources: [krtcFareMapPage(from.ref), klrtTimetablePage(code, KLRT_TIMETABLE_SUFFIX[day]), klrtFirstLastPage(code)],
  };
}

export const krtcSource: NetworkSource = { network: 'krtc', quote: quoteKrtc };

export const klrtSource: NetworkSource = { network: 'klrt', quote: quoteKlrt };

export const krtcStatus: StatusSource = {
  operator: 'krtc',
  status: (deps) => deps.memo('krtc-status', STATUS_TTL_MS, async () =>
    parseKrtcStatus(await page(deps.fetchFn, KRTC_NOTICE_PAGE, deps.signal), KRTC_NOTICE_PAGE)),
};

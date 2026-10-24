/**
 * Fetching a 淡海 / 安坑 station's official timetable and picking the version in force on a date.
 * The station's 搭乘時刻表 page lists the file(s) (`parseTimetablePage`); while the 淡海 pages carry
 * the old and the new file (until the switch on 2026-10-24, news node 911), a date before the
 * switch reads the old one. Both the page and each file are memoized 6 hours: the page is where a
 * new version appears, the file never changes under its name.
 */
import type { MetroDeps } from './metroTypes';
import { browserHeaders, railFetch, railText } from '../rail/railHttp';
import { taipeiClock } from '../rail/railTime';
import type { StationTimetable, TimetableFiles } from './ntmetroTimetableParse';
import { effectiveFrom, odtText, parseStationTimetable, parseTimetablePage } from './ntmetroTimetableParse';

const SITE = 'https://www.ntmetro.com.tw';
const TIMETABLE_TTL_MS = 6 * 60 * 60_000;

/** Each station's 搭乘時刻表 page (`?mode=detail&node=`), from the tabs on node 460 / 602. */
const TIMETABLE_NODE: Readonly<Record<string, number>> = {
  V01: 460, V02: 459, V03: 458, V04: 457, V05: 456, V06: 455, V07: 454, V08: 453, V09: 452, V10: 451, V11: 450,
  V28: 449, V27: 448, V26: 447,
  K09: 602, K08: 603, K07: 604, K06: 605, K05: 606, K04: 607, K03: 608, K02: 601, K01: 600,
};

export const TIMETABLE_STATIONS: readonly string[] = Object.keys(TIMETABLE_NODE);

export function timetablePage(code: string): string | undefined {
  const node = TIMETABLE_NODE[code];
  return node ? `${SITE}/basic/?mode=detail&node=${node}` : undefined;
}

/** A path as the page writes it ("/archive/file/%E6%B7%A1…(4).odt") as a URL with every segment encoded once. */
export function timetableFileUrl(path: string): string {
  return `${SITE}${path.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/')}`;
}

interface LoadedFile {
  table: StationTimetable;
  /** Taipei date of the file's Last-Modified, when the server sends one. */
  uploadedOn?: string;
}

/** The timetable in force on the asked date, and where it came from. */
export interface ChosenTimetable {
  station: string;
  table: StationTimetable;
  page: string;
  file: string;
  /** Set when the page lists two versions: the date the newer one starts. */
  switchOn?: string;
  /** Which of the two this is. */
  version?: 'old' | 'new';
}

export async function timetableFiles(code: string, deps: MetroDeps): Promise<TimetableFiles> {
  const page = timetablePage(code);
  if (!page) throw new Error(`No New Taipei Metro timetable page for ${code}`);
  return deps.memo(`ntm-tt-page-${code}`, TIMETABLE_TTL_MS, async () =>
    parseTimetablePage(await railText(deps.fetchFn, page, { headers: browserHeaders(page) }, deps.signal)));
}

async function loadFile(code: string, path: string, deps: MetroDeps): Promise<LoadedFile> {
  const url = timetableFileUrl(path);
  return deps.memo(`ntm-tt-file-${url}`, TIMETABLE_TTL_MS, async () => {
    const res = await railFetch(deps.fetchFn, url, { headers: browserHeaders(url, { Referer: timetablePage(code) ?? SITE }) }, deps.signal);
    if (!res.ok) throw new Error(`New Taipei Metro timetable file answered HTTP ${res.status}`);
    const table = parseStationTimetable(odtText(Buffer.from(await res.arrayBuffer())), code);
    const modified = Date.parse(res.headers.get('last-modified') ?? '');
    return { table, ...(Number.isFinite(modified) ? { uploadedOn: taipeiClock(new Date(modified)).date } : {}) };
  });
}

/** The station's timetable for `date` (`YYYY-MM-DD`, Taipei); `today` stands in for a missing Last-Modified. */
export async function stationTimetable(code: string, date: string, deps: MetroDeps, today: string = taipeiClock(new Date()).date): Promise<ChosenTimetable> {
  const files = await timetableFiles(code, deps);
  const page = timetablePage(code) ?? SITE;
  const latest = await loadFile(code, files.latest, deps);
  if (!files.previous || files.fromDay === undefined) {
    return { station: code, table: latest.table, page, file: timetableFileUrl(files.latest) };
  }
  const switchOn = effectiveFrom(files.fromDay, latest.uploadedOn ?? today);
  if (date >= switchOn) return { station: code, table: latest.table, page, file: timetableFileUrl(files.latest), switchOn, version: 'new' };
  const previous = await loadFile(code, files.previous, deps);
  return { station: code, table: previous.table, page, file: timetableFileUrl(files.previous), switchOn, version: 'old' };
}

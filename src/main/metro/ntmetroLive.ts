/**
 * New Taipei Metro's live train boards (trainstatus.ntmetro.com.tw/roadmap/, the "列車動態" pages).
 * Their own JSON requests, not a published API; read the way the pages read them.
 *
 * - 淡海 / 安坑 (`danhai_data.php`, `ankeng_data.php`; the page POSTs with no body): `gpsData` is a
 *   list of segments, each an object of stations in the order trains pass them (淡海: V01→V09,
 *   V10→V11, V28→V26, V11→V10, V26→V28, V09→V01; 安坑: K01→K09, K09→K01). Per station: the NEXT
 *   train only — `time` = seconds until it arrives (0 = at the platform, -1 = none), `routeId`
 *   (null on some inbound rows, then `timeRouteId`) = 3 for 綠山線 (to 崁頂), 4 for 藍海線 (to 淡水漁人碼頭),
 *   1 on 安坑; `drivingTime` "-" where trains end. `time3`/`time4` are not per-route (both read 0 for
 *   a route-4 train at V01 on 2026-10-22 21:16), so they are not used.
 * - 環狀線 (`circular_time.php`, GET): one row per station and direction, the next train only.
 *   `PDir` 1 = toward Y20 新北產業園區 (codes rising), 2 = toward Y07 大坪林 — the times step up
 *   Y10 → Y11 → Y12 in PDir 1 and Y18 → Y17 → Y16 in PDir 2 (captures 21:14 and 21:16). A terminus
 *   row heading out of the line reads "00:00:00"/0; a row left over from a train already gone keeps
 *   its old time with `seconds` 0 (Y20 "20:48:02" at 21:14), so seconds 0 counts only within a minute.
 *   It does not say where a train ends (TDX: 板橋–新北產業園區 every ~23 min, 中和–大坪林 ~10), so no `toward`.
 */
import type { MetroDeparture, MetroDeps, MetroStation } from './metroTypes';
import { browserHeaders, railJson } from '../rail/railHttp';
import { clockMinutes, DAY_MINUTES, taipeiClock } from '../rail/railTime';

const BOARD_BASE = 'https://trainstatus.ntmetro.com.tw/roadmap/';
export const LRT_BOARD_PAGES = { danhai: `${BOARD_BASE}danhai.php`, ankeng: `${BOARD_BASE}ankeng.php` } as const;
export const CIRCULAR_BOARD_PAGE = `${BOARD_BASE}circular.php`;
export const CIRCULAR_BOARD_DATA = `${BOARD_BASE}circular_time.php`;
const BOARD_TTL_MS = 15_000;

export interface LrtBoardEntry {
  station: string;
  /** Seconds until the next train reaches the station; -1 = none shown. */
  seconds: number;
  routeId: number | null;
  /** The board shows "-": trains end here, nothing leaves in this direction. */
  terminus: boolean;
}

/** Segments in feed order, each in the order its trains pass the stations. */
export type LrtBoard = LrtBoardEntry[][];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function routeOf(row: Record<string, unknown>): number | null {
  for (const value of [row.routeId, row.timeRouteId]) if (typeof value === 'number' && value > 0) return value;
  return null;
}

export function parseLrtBoard(json: unknown): LrtBoard {
  const body = record(json);
  const data = record(body?.data);
  if (body?.code !== 0 || !Array.isArray(data?.gpsData)) throw new Error('New Taipei Metro live board answered without gpsData');
  return data.gpsData.map((segment) => Object.entries(record(segment) ?? {}).flatMap(([station, value]) => {
    const row = record(value);
    if (!row || typeof row.time !== 'number') return [];
    return [{ station, seconds: row.time, routeId: routeOf(row), terminus: row.drivingTime === '-' }];
  }));
}

/**
 * The board's entry for trains at `from` heading along `order` (a line in travel direction, e.g.
 * V11 … V01): the segment where `from`'s neighbour sits on the same side as in `order`.
 */
export function boardEntry(board: LrtBoard, order: readonly string[], from: string): LrtBoardEntry | undefined {
  const pos = (code: string | undefined) => (code === undefined ? -1 : order.indexOf(code));
  const at = pos(from);
  for (const segment of board) {
    const i = segment.findIndex((e) => e.station === from);
    if (i < 0) continue;
    const next = pos(segment[i + 1]?.station);
    const prev = pos(segment[i - 1]?.station);
    if ((next >= 0 && next > at) || (next < 0 && prev >= 0 && prev < at)) return segment[i];
  }
  return undefined;
}

export async function fetchLrtBoard(network: 'danhai' | 'ankeng', deps: MetroDeps): Promise<LrtBoard> {
  return deps.memo(`${network}:board`, BOARD_TTL_MS, async () => {
    const url = `${BOARD_BASE}${network}_data.php`;
    const headers = browserHeaders(url, { Accept: 'application/json', Referer: LRT_BOARD_PAGES[network] });
    return parseLrtBoard(await railJson(deps.fetchFn, url, { method: 'POST', headers }, deps.signal));
  });
}

/** 1439 → "23:59"; 1450 → "24:10" (the contract keeps counting past midnight). */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface CircularRow {
  station: string;
  /** 1 = toward Y20, 2 = toward Y07. */
  dir: number;
  clock: string;
  seconds: number;
}

export function parseCircularBoard(json: unknown): CircularRow[] {
  if (!Array.isArray(json)) throw new Error('New Taipei Metro circular board is not a list');
  return json.flatMap((value) => {
    const row = record(value);
    if (!row || typeof row.SID !== 'string' || typeof row.Estimated_Arrivaltime !== 'string') return [];
    return [{ station: row.SID, dir: Number(row.PDir), clock: row.Estimated_Arrivaltime, seconds: Number(row.seconds) }];
  });
}

/** The row's train as a departure, or null when the row is empty or left over (see the header). */
export function circularDeparture(row: CircularRow, now: Date): MetroDeparture | null {
  const at = clockMinutes(row.clock);
  if (!Number.isFinite(at) || !Number.isFinite(row.seconds) || row.seconds < 0) return null;
  if (row.clock === '00:00:00' && row.seconds === 0) return null;
  const nowMinutes = taipeiClock(now).minutes;
  // A time far behind "now" belongs to after midnight.
  const time = at < nowMinutes - DAY_MINUTES / 2 ? at + DAY_MINUTES : at;
  if (row.seconds === 0 && Math.abs(time - nowMinutes) > 1) return null;
  return { time: hhmm(time), inMinutes: Math.round(row.seconds / 60) };
}

function yCode(station: MetroStation): number {
  const code = station.codes.find((c) => /^Y\d{2}$/u.test(c));
  if (!code) throw new Error(`${station.zh} is not on the Circular line`);
  return Number(code.slice(1));
}

/** The next train at `from` toward `to`, both Circular-line (Y) stations; the board shows one per direction. */
export async function circularDepartures(from: MetroStation, to: MetroStation, deps: MetroDeps, now: Date = new Date()): Promise<MetroDeparture[]> {
  const [a, b] = [yCode(from), yCode(to)];
  if (a === b) return [];
  const rows = await deps.memo('trtc:ntmetro-circular-board', BOARD_TTL_MS, async () => {
    const headers = browserHeaders(CIRCULAR_BOARD_DATA, { Accept: 'application/json', Referer: CIRCULAR_BOARD_PAGE });
    return parseCircularBoard(await railJson(deps.fetchFn, CIRCULAR_BOARD_DATA, { headers }, deps.signal));
  });
  const station = `Y${String(a).padStart(2, '0')}`;
  const dir = b > a ? 1 : 2;
  return rows
    .filter((row) => row.station === station && row.dir === dir)
    .map((row) => circularDeparture(row, now))
    .filter((d): d is MetroDeparture => d !== null)
    .slice(0, 5);
}

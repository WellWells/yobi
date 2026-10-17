/**
 * What the connector reads from TDX, parsed into the connector's own shapes. Paths are TDX's
 * documented ones.
 */
import { clockMinutes, rollStops } from './railTime';
import { railNode } from './railTypes';
import type { RailMode, RailNode, RailTrain } from './railTypes';

export const TDX_PATHS = {
  thsrDaily: (date: string) => `v2/Rail/THSR/DailyTimetable/TrainDate/${date}`,
  traDelay: 'v2/Rail/TRA/LiveTrainDelay',
  thsrSeats: (stationId: string) => `v2/Rail/THSR/AvailableSeatStatusList/${stationId}`,
  thsrAlert: 'v2/Rail/THSR/AlertInfo',
  traAlert: 'v3/Rail/TRA/Alert',
} as const;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function zh(value: unknown): string {
  return text((value as { Zh_tw?: unknown } | null)?.Zh_tw);
}

interface TdxStopTime {
  StopSequence?: unknown;
  StationID?: unknown;
  ArrivalTime?: unknown;
  DepartureTime?: unknown;
}

export function parseThsrDaily(json: unknown): RailTrain[] {
  if (!Array.isArray(json)) throw new Error('TDX THSR timetable is not a list');
  const trains: RailTrain[] = [];
  for (const entry of json as { DailyTrainInfo?: { TrainNo?: unknown }; StopTimes?: unknown }[]) {
    const no = text(entry.DailyTrainInfo?.TrainNo);
    if (!no || !Array.isArray(entry.StopTimes)) continue;
    const raw = (entry.StopTimes as TdxStopTime[])
      .map((s) => ({ seq: Number(s.StopSequence), id: text(s.StationID), arr: clockMinutes(text(s.ArrivalTime)), dep: clockMinutes(text(s.DepartureTime)) }))
      .filter((s) => s.id && Number.isFinite(s.seq))
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({ node: railNode('thsr', s.id), arr: s.arr, dep: s.dep }));
    const stops = rollStops(raw);
    if (stops.length >= 2) trains.push({ mode: 'thsr', no, type: '高鐵', typeEn: 'THSR', stops });
  }
  return trains;
}

export interface TraDelay {
  minutes: number;
  /** The station TRA last reported the train at. */
  station: string;
  at: string;
}

/** Train number → its latest delay report. A train not in the list is not running now. */
export function parseTraDelays(json: unknown): Map<string, TraDelay> {
  if (!Array.isArray(json)) throw new Error('TDX TRA delay list is not a list');
  const delays = new Map<string, TraDelay>();
  for (const entry of json as { TrainNo?: unknown; StationName?: unknown; DelayTime?: unknown; SrcUpdateTime?: unknown }[]) {
    const no = text(entry.TrainNo);
    const minutes = Number(entry.DelayTime);
    if (!no || !Number.isFinite(minutes)) continue;
    delays.set(no, { minutes, station: zh(entry.StationName), at: text(entry.SrcUpdateTime) });
  }
  return delays;
}

export type SeatStatus = 'available' | 'limited' | 'sold_out' | 'unknown';

function seatStatus(code: unknown): SeatStatus {
  if (code === 'O') return 'available';
  if (code === 'L') return 'limited';
  if (code === 'X') return 'sold_out';
  return 'unknown';
}

export interface SeatInfo {
  standard: SeatStatus;
  business: SeatStatus;
}

/** `${trainNo}>${destination node}` → seats from the station asked about to that destination. */
export function parseThsrSeats(json: unknown): Map<string, SeatInfo> {
  const list = (json as { AvailableSeats?: unknown } | null)?.AvailableSeats;
  if (!Array.isArray(list)) throw new Error('TDX THSR seat list has no AvailableSeats');
  const seats = new Map<string, SeatInfo>();
  for (const train of list as { TrainNo?: unknown; StopStations?: unknown }[]) {
    const no = text(train.TrainNo);
    if (!no || !Array.isArray(train.StopStations)) continue;
    for (const stop of train.StopStations as { StationID?: unknown; StandardSeatStatus?: unknown; BusinessSeatStatus?: unknown }[]) {
      const id = text(stop.StationID);
      if (!id) continue;
      seats.set(seatKey(no, railNode('thsr', id)), { standard: seatStatus(stop.StandardSeatStatus), business: seatStatus(stop.BusinessSeatStatus) });
    }
  }
  return seats;
}

export function seatKey(trainNo: string, to: RailNode): string {
  return `${trainNo}>${to}`;
}

/** The whole title says service is normal — not a notice that mentions it. */
const NORMAL_TITLE = /^(全線)?營運正常\s*(\(normal\))?$/iu;

/** The operator's current notices; empty while it says service is normal. */
export function parseAlerts(json: unknown, mode: RailMode): string[] {
  const list = mode === 'thsr' ? json : (json as { Alerts?: unknown } | null)?.Alerts;
  if (!Array.isArray(list)) return [];
  return (list as { Title?: unknown; Description?: unknown }[])
    .filter((alert) => !NORMAL_TITLE.test(text(alert.Title)))
    .map((alert) => [text(alert.Title), text(alert.Description)].filter(Boolean).join(': '))
    .filter(Boolean);
}

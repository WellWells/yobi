/**
 * 三鶯線 has no live arrivals anywhere (trainstatus.ntmetro.com.tw has no 三鶯 board; TDX LiveBoard
 * rejects NTMC, 2026-10-22), so its answers come from what New Taipei Metro publishes, baked:
 *
 * - First / last trains: the chart on node 863 (1150814-1, Last-Modified 2026-08-14), cell for cell
 *   the same as TDX FirstLastTimetable NTMC LB (44 rows, SrcUpdateTime 2026-09-11). Last trains run
 *   past midnight ("00:31"); the chart's 轉乘板南線最後搭車時間 column is kept for the Bannan link.
 * - Ride minutes: the 列車運行時間 chart on node 10165 (Last-Modified 2026-07-13), LB01 → LB12 32 min.
 *   Its matrix is the sum of these adjacent steps in every cell. TDX S2STravelTime adds up to less
 *   (1,423 s running + 25 s dwell × 10 ≈ 28 min), so the operator's chart is the one used.
 * - Headway: node 863 "以尖峰(06:30~08:30；17:30~19:30)約6分鐘、離峰及假日約8分鐘的班距運行",
 *   service 06:00–24:00 on both day types (TDX Frequency, the same numbers).
 */
import { SANYING_LINE } from './ntmetroStations';
import { isOffDay } from './taiwanCalendar';

export const SANYING_TIMETABLE_PAGE = 'https://www.ntmetro.com.tw/basic/?mode=detail&node=863';
export const SANYING_RUNTIME_PAGE = 'https://www.ntmetro.com.tw/basic/?node=10165';

/** Minutes from LB01→LB02, LB02→LB03, … LB11→LB12 (the same both ways). */
const STEP_MINUTES = [2, 3, 2, 3, 3, 3, 5, 2, 2, 4, 3] as const;

export type SanyingDayType = 'weekday' | 'holiday';

/** [station, toward terminus, first on 平常日, first on 例假日, last (both day types), last connecting to 板南線]. */
type FirstLastRow = readonly [string, 'LB01' | 'LB12', string, string, string, string?];

export const SANYING_FIRST_LAST: readonly FirstLastRow[] = [
  ['LB01', 'LB12', '06:00', '06:00', '00:00'],
  ['LB02', 'LB12', '06:02', '06:02', '00:02'],
  ['LB02', 'LB01', '06:03', '06:03', '00:31', '23:46'],
  ['LB03', 'LB12', '06:00', '06:00', '00:05'],
  ['LB03', 'LB01', '06:00', '06:00', '00:28', '23:43'],
  ['LB04', 'LB12', '06:03', '06:03', '00:08'],
  ['LB04', 'LB01', '06:03', '06:06', '00:25', '23:40'],
  ['LB05', 'LB12', '06:00', '06:05', '00:11'],
  ['LB05', 'LB01', '06:00', '06:03', '00:23', '23:37'],
  ['LB06', 'LB12', '06:03', '06:00', '00:14'],
  ['LB06', 'LB01', '06:03', '06:00', '00:20', '23:34'],
  ['LB07', 'LB12', '06:00', '06:03', '00:17'],
  ['LB07', 'LB01', '06:00', '06:00', '00:16', '23:31'],
  ['LB08', 'LB12', '06:05', '06:00', '00:22'],
  ['LB08', 'LB01', '06:00', '06:02', '00:11', '23:26'],
  ['LB09', 'LB12', '06:00', '06:02', '00:25'],
  ['LB09', 'LB01', '06:03', '06:00', '00:09', '23:24'],
  ['LB10', 'LB12', '06:02', '06:00', '00:27'],
  ['LB10', 'LB01', '06:00', '06:06', '00:06', '23:21'],
  ['LB11', 'LB12', '06:00', '06:04', '00:31'],
  ['LB11', 'LB01', '06:03', '06:03', '00:03', '23:18'],
  ['LB12', 'LB01', '06:00', '06:00', '00:00', '23:15'],
];

/** Weekday peaks, 6 min; every other hour, and all day on 例假日, 8 min. */
export const SANYING_HEADWAY = {
  peak: ['06:30–08:30', '17:30–19:30'],
  peakMinutes: 6,
  offPeakMinutes: 8,
  service: '06:00–24:00',
} as const;

/** 例假日 = a day off by the official office calendar (weekends, national holidays, not make-up workdays). */
export function sanyingDayType(date: string): SanyingDayType {
  return isOffDay(date) ? 'holiday' : 'weekday';
}

/** "00:31" on the chart is half past midnight of the same service day: "24:31", so the order stays right. */
export function serviceDayClock(text: string): string {
  const [h, m] = text.split(':');
  const hour = Number(h);
  return hour < 4 ? `${hour + 24}:${m}` : text;
}

function lineIndex(code: string): number {
  const index = SANYING_LINE.indexOf(code);
  if (index < 0) throw new Error(`Unknown Sanying station ${code}`);
  return index;
}

/** Published ride minutes between two 三鶯 stations (no waiting). */
export function sanyingMinutes(fromCode: string, toCode: string): number {
  const [a, b] = [lineIndex(fromCode), lineIndex(toCode)].sort((x, y) => x - y);
  return STEP_MINUTES.slice(a, b).reduce((sum, step) => sum + step, 0);
}

export interface SanyingFirstLast {
  toward: 'LB01' | 'LB12';
  first: string;
  last: string;
  lastToBannan?: string;
}

/** First and last train from `fromCode` toward `toCode`, on the day type asked. */
export function sanyingFirstLast(fromCode: string, toCode: string, dayType: SanyingDayType): SanyingFirstLast | undefined {
  const toward = lineIndex(toCode) > lineIndex(fromCode) ? 'LB12' : 'LB01';
  const row = SANYING_FIRST_LAST.find(([station, dir]) => station === fromCode && dir === toward);
  if (!row) return undefined;
  const [, , weekday, holiday, last, bannan] = row;
  return {
    toward,
    first: dayType === 'weekday' ? weekday : holiday,
    last: serviceDayClock(last),
    ...(bannan ? { lastToBannan: bannan } : {}),
  };
}

/**
 * THSR's own timetable search (its timetable and fare page posts to `/TimeTable/Search`). Not a
 * published API — the page's own request — so it is used for what TDX lacks (fares and the
 * early-bird / student discounts per train) and as the THSR timetable when TDX cannot be reached.
 */
import { browserHeaders, railJson } from './railHttp';
import type { FetchFn } from './railHttp';
import { clockMinutes, rollStops } from './railTime';
import type { RailNode, RailTrain } from './railTypes';
import { thsrNodeByName } from './stations';

export const THSR_SEARCH_PAGE = 'https://www.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c';
const THSR_SEARCH_URL = 'https://www.thsrc.com.tw/TimeTable/Search';

/** Adult and child/senior fares, in NT$. */
export interface ThsrFares {
  standard: [number, number];
  business: [number, number];
  unreserved: [number, number];
}

export interface ThsrSearchResult {
  trains: RailTrain[];
  fares: ThsrFares | null;
  /** Per train number: the discounts a rider can buy (early-bird, university student); group fares left out. */
  discounts: Record<string, string[]>;
}

interface WebStation {
  StationName?: unknown;
  DepartureTime?: unknown;
  Show?: unknown;
}

interface WebTrain {
  TrainNumber?: unknown;
  DepartureTime?: unknown;
  DestinationTime?: unknown;
  Discount?: unknown;
  StationInfo?: unknown;
}

const RIDER_DISCOUNTS = /早鳥|大學生/u;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function price(value: unknown): number {
  const n = Number(text(value).replace(/[$,\s]/gu, ''));
  return Number.isFinite(n) ? n : Number.NaN;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const adult = price(value[0]);
  const child = price(value[1]);
  return Number.isFinite(adult) && Number.isFinite(child) ? [adult, child] : null;
}

function parseFares(table: unknown): ThsrFares | null {
  const t = table as { Coach?: unknown; Business?: unknown; Unreserved?: unknown } | null;
  const standard = pair(t?.Coach);
  const business = pair(t?.Business);
  const unreserved = pair(t?.Unreserved);
  return standard && business && unreserved ? { standard, business, unreserved } : null;
}

/** The train as the page lists it; `to` is the destination asked for, whose time is the arrival. */
function parseWebTrain(item: WebTrain, to: RailNode): RailTrain | null {
  const no = text(item.TrainNumber);
  if (!no || !Array.isArray(item.StationInfo)) return null;
  const raw: { node: RailNode; arr: number; dep: number }[] = [];
  for (const station of item.StationInfo as WebStation[]) {
    if (station.Show !== true) continue;
    const node = thsrNodeByName(text(station.StationName));
    const time = clockMinutes(text(station.DepartureTime));
    if (!node || !Number.isFinite(time)) continue;
    raw.push({ node, arr: time, dep: time });
  }
  const arrival = clockMinutes(text(item.DestinationTime));
  const last = raw.findIndex((stop) => stop.node === to);
  if (last >= 0 && Number.isFinite(arrival)) raw[last] = { node: to, arr: arrival, dep: arrival };
  const stops = rollStops(raw);
  if (stops.length < 2) return null;
  return { mode: 'thsr', no, type: '高鐵', typeEn: 'THSR', stops };
}

function parseDiscounts(item: WebTrain): string[] {
  if (!Array.isArray(item.Discount)) return [];
  return (item.Discount as { Name?: unknown; Value?: unknown }[])
    .map((d) => ({ name: text(d.Name), value: text(d.Value) }))
    .filter((d) => d.name && RIDER_DISCOUNTS.test(d.name))
    .map((d) => `${d.name} ${d.value}`.trim());
}

export function parseThsrSearch(json: unknown, to: RailNode): ThsrSearchResult {
  const body = json as { success?: unknown; data?: { DepartureTable?: { TrainItem?: unknown }; PriceTable?: unknown } } | null;
  if (body?.success !== true || !body.data) throw new Error('THSR timetable search returned no result');
  const items = Array.isArray(body.data.DepartureTable?.TrainItem) ? (body.data.DepartureTable.TrainItem as WebTrain[]) : [];
  const trains: RailTrain[] = [];
  const discounts: Record<string, string[]> = {};
  for (const item of items) {
    const train = parseWebTrain(item, to);
    if (!train) continue;
    trains.push(train);
    const offers = parseDiscounts(item);
    if (offers.length > 0) discounts[train.no] = offers;
  }
  return { trains, fares: parseFares(body.data.PriceTable), discounts };
}

/** The form the page posts: one-way, Chinese, any discount; dates as YYYY/MM/DD. */
export function thsrSearchBody(fromWeb: string, toWeb: string, date: string, time: string): URLSearchParams {
  const day = date.replaceAll('-', '/');
  return new URLSearchParams({
    SearchType: 'S',
    Lang: 'TW',
    StartStation: fromWeb,
    EndStation: toWeb,
    OutWardSearchDate: day,
    OutWardSearchTime: time,
    ReturnSearchDate: day,
    ReturnSearchTime: time,
    DiscountType: '',
  });
}

export async function searchThsrWeb(
  fetchFn: FetchFn,
  q: { fromWeb: string; toWeb: string; to: RailNode; date: string; time: string },
  signal?: AbortSignal,
): Promise<ThsrSearchResult> {
  const json = await railJson(fetchFn, THSR_SEARCH_URL, {
    method: 'POST',
    headers: browserHeaders(THSR_SEARCH_URL, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: THSR_SEARCH_PAGE,
    }),
    body: thsrSearchBody(q.fromWeb, q.toWeb, q.date, q.time).toString(),
  }, signal);
  return parseThsrSearch(json, q.to);
}

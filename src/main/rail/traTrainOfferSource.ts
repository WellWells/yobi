/**
 * TRA's own query-by-time page: the day's direct trains between two stations, each with its own fare
 * and the discounts TRA sells on it. Unlike the fare page, which prices the shortest route, this one
 * prices the route the train runs, and only it has unreserved-seat fares. One GET, then one POST
 * per tab: ordinary, and unreserved when asked.
 */
import { browserHeaders, railFetch, railText } from './railHttp';
import type { FetchFn } from './railHttp';
import type { TraFare } from './traFareSource';
import { TRA_TIME_PAGE, cookieHeader, csrfToken } from './traWebSource';

export const TRA_TIME_QUERY = 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip112/querybytime';

type Tab = 'NORMAL' | 'FREE_SEAT';

export interface TraTrainOffer {
  /** Ordinary seat on this train's own route. */
  fare?: TraFare;
  /** The unreserved-seat fare, when the train has it. */
  unreserved?: TraFare;
  /** The discounts TRA lists on the train, in its words. */
  discounts: string[];
}

/** Per train number. */
export type TraTrainOffers = Record<string, TraTrainOffer>;

function decode(value: string): string {
  return value.replace(/<[^>]*>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** The price a rider pays: the last "$ n" in the cell (a struck-through list price comes first). */
function price(cell: string): number {
  const all = [...decode(cell).matchAll(/\$\s*([\d,]+)/gu)];
  return all.length > 0 ? Number(all[all.length - 1][1].replaceAll(',', '')) : Number.NaN;
}

/** One tab's direct trains: number, the two fares (adult, child), and the badges on the train. */
export function parseTraTimePage(html: string): Map<string, { fare?: TraFare; discounts: string[] }> {
  const trains = new Map<string, { fare?: TraFare; discounts: string[] }>();
  for (const part of html.split('<tr class="trip-column">').slice(1)) {
    const end = part.indexOf('detail-box-td');
    const row = end >= 0 ? part.slice(0, end) : part;
    // A row with a second train is a change, not a direct train.
    if (row.includes('transferList[1].trainNo')) continue;
    const no = /name="transferList\[0\]\.trainNo"\s+value="(\d+)"/u.exec(row)?.[1] ?? /trainNo=(\d+)/u.exec(row)?.[1];
    if (!no) continue;
    const head = row.slice(0, row.indexOf('</ul>') >= 0 ? row.indexOf('</ul>') : 0);
    const discounts = [...head.matchAll(/<div[^>]*>([^<]+)<\/div>/gu)].map((m) => m[1].trim()).filter(Boolean);
    const priced = row.slice(Math.max(0, row.indexOf('時刻表依時刻價格')));
    const cells = [...priced.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gu)].map((m) => m[1]);
    const adult = price(cells[0] ?? '');
    const half = price(cells[1] ?? '');
    trains.set(no, { ...(Number.isFinite(adult) && Number.isFinite(half) ? { fare: { adult, half } } : {}), discounts });
  }
  return trains;
}

export function traTimeBody(token: string, from: string, to: string, date: string, tab: Tab): string {
  return new URLSearchParams({
    _csrf: token,
    startStation: from,
    endStation: to,
    transfer: 'ONE',
    rideDate: date.replaceAll('-', '/'),
    startOrEndTime: 'true',
    startTime: '00:00',
    endTime: '23:59',
    trainTypeList: 'ALL',
    queryClassification: tab,
    query: '查詢',
  }).toString();
}

/**
 * Every direct train between two TRA stations (`"<id>-<name>"`) on a date (`YYYY-MM-DD`), with its
 * fare and discounts, and its unreserved-seat fare when `unreserved` is set.
 */
export async function fetchTraTrainOffers(fetchFn: FetchFn, from: string, to: string, date: string, opts: { unreserved: boolean }, signal?: AbortSignal): Promise<TraTrainOffers> {
  const form = await railFetch(fetchFn, TRA_TIME_PAGE, { headers: browserHeaders(TRA_TIME_PAGE) }, signal);
  if (!form.ok) throw new Error(`TRA timetable page answered HTTP ${form.status}`);
  const token = csrfToken(await form.text());
  if (!token) throw new Error('TRA timetable page has no form token');
  const cookie = cookieHeader(form);
  const query = (tab: Tab) => railText(fetchFn, TRA_TIME_QUERY, {
    method: 'POST',
    headers: browserHeaders(TRA_TIME_QUERY, { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Referer: TRA_TIME_PAGE }),
    body: traTimeBody(token, from, to, date, tab),
  }, signal).then(parseTraTimePage);

  const offers: TraTrainOffers = {};
  for (const [no, train] of await query('NORMAL')) offers[no] = { ...(train.fare ? { fare: train.fare } : {}), discounts: train.discounts };
  if (opts.unreserved) {
    for (const [no, train] of await query('FREE_SEAT')) {
      if (!train.fare) continue;
      offers[no] = { ...(offers[no] ?? { discounts: train.discounts }), unreserved: train.fare };
    }
  }
  return offers;
}

/**
 * TRA's own fare-calculator page, since TRA's open data has no fares. It is a CSRF-protected form
 * (GET for the token and cookie, then POST) and one POST takes many rows, so every train type
 * between two stations — adult and half fare, plus the Tze-Chiang 3000 business seat — is one
 * query. It prices the shortest route; `traTrainOfferSource.ts` has each train's own.
 */
import { browserHeaders, railFetch, railText } from './railHttp';
import type { FetchFn } from './railHttp';
import { traTypeFromLabel } from './traTrainTypes';
import { cookieHeader, csrfToken } from './traWebSource';

export const TRA_FARE_PAGE = 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip114/query';

/**
 * The page's train-type options, which use TDX's TrainTypeID codes: Tze-Chiang 3000, Taroko,
 * Puyuma, Tze-Chiang, Chu-Kuang, Fu-Hsing, Local Express, Local. Ordinary (7) has no option, so
 * its legs go unpriced.
 */
export const TRA_FARE_TRAIN_TYPES = ['11', '1', '2', '3', '4', '5', '10', '6'] as const;

/** Adult, then child: children, seniors, riders with disabilities and their companions all pay the same reduced fare. */
const TICKET_TYPES = { adult: '1', half: '2' } as const;

const SEAT = { ordinary: '301', business: '310' } as const;

/** Only Tze-Chiang 3000 has the business seat; asked for another type, the page quietly prices an ordinary seat. */
const BUSINESS_TRAIN_TYPE = '11';

/** NT$ for one rider. */
export interface TraFare {
  adult: number;
  half: number;
}

export interface TraFares {
  km: number;
  /** Ordinary seat, per train category the way the timetable names it. */
  byType: Record<string, TraFare>;
  /** The Tze-Chiang 3000 business seat. */
  business?: TraFare;
}

function formRows(): { trainType: string; ticket: string; seat: string }[] {
  const ticketRows = (trainType: string, seat: string) => Object.values(TICKET_TYPES).map((ticket) => ({ trainType, ticket, seat }));
  return [...TRA_FARE_TRAIN_TYPES.flatMap((type) => ticketRows(type, SEAT.ordinary)), ...ticketRows(BUSINESS_TRAIN_TYPE, SEAT.business)];
}

function decode(value: string): string {
  return value.replace(/<[^>]*>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function cells(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => decode(m[1]));
}

/** The result table's priced rows; null when the page priced nothing (an unknown station, a changed page). */
export function parseTraFarePage(html: string): TraFares | null {
  const start = html.indexOf('fare-table');
  if (start < 0) return null;
  const byType: Record<string, Partial<TraFare>> = {};
  const business: Partial<TraFare> = {};
  let km = Number.NaN;
  for (const row of html.slice(start).split(/<tr[\s>]/u)) {
    const values = cells(row);
    const ticket = values.findIndex((v) => /^(全票|孩童)\s*\d+\s*張$/u.test(v));
    const distance = values.findIndex((v) => /^[\d.]+\s*km$/u.test(v));
    if (ticket < 0 || distance < 1) continue;
    // Fares from NT$1,000 up carry a thousands separator ("1,008").
    const price = Number(/^([\d,]+)/u.exec(values[ticket + 1] ?? '')?.[1]?.replaceAll(',', ''));
    if (!Number.isFinite(price)) continue;
    // The page writes the train type with parentheses; the timetable's category has none.
    const type = traTypeFromLabel(values[distance - 1].replace(/[()（）\s]/gu, ''));
    // The ticket-kind cell names the business seat; otherwise it is an ordinary one.
    const fare = values.some((v) => v.startsWith('騰雲座艙')) ? business : (byType[type] ??= {});
    fare[values[ticket].startsWith('全票') ? 'adult' : 'half'] = price;
    km = Number.parseFloat(values[distance]);
  }
  const full = (fare: Partial<TraFare>): fare is TraFare => fare.adult !== undefined && fare.half !== undefined;
  const complete = Object.entries(byType).filter((entry): entry is [string, TraFare] => full(entry[1]));
  if (complete.length === 0 || !Number.isFinite(km)) return null;
  return { km, byType: Object.fromEntries(complete), ...(full(business) ? { business } : {}) };
}

/** The form the page posts: one row per train type and ticket type, then the business seat; stations by TRA id. */
export function traFareBody(token: string, fromId: string, toId: string, date: string): string {
  const form = new URLSearchParams({ _csrf: token });
  formRows().forEach(({ trainType, ticket, seat }, row) => {
    const field = (name: string, value: string) => form.append(`tip114QueryVOs[${row}].${name}`, value);
    field('ticketDeadlineType', 'ONCE');
    field('trnDate', date.replaceAll('-', '/'));
    field('SpecLineExtEnum', 'TIP_SPEC_LINE_OTHERS');
    field('directionExtEnum', 'TIP_DIR_UNUSED');
    field('startStation', fromId);
    field('endStation', toId);
    field('trainType', trainType);
    field('ticketPriceType', ticket);
    field('seatTypeCode', seat);
    field('ticketCount', '1');
  });
  form.append('query', '');
  return form.toString();
}

/** Every train type's fare between two TRA stations (ids) on a date (`YYYY-MM-DD`). */
export async function fetchTraFares(fetchFn: FetchFn, fromId: string, toId: string, date: string, signal?: AbortSignal): Promise<TraFares> {
  const form = await railFetch(fetchFn, TRA_FARE_PAGE, { headers: browserHeaders(TRA_FARE_PAGE) }, signal);
  if (!form.ok) throw new Error(`TRA fare page answered HTTP ${form.status}`);
  const token = csrfToken(await form.text());
  if (!token) throw new Error('TRA fare page has no form token');
  const html = await railText(fetchFn, TRA_FARE_PAGE, {
    method: 'POST',
    headers: browserHeaders(TRA_FARE_PAGE, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(form),
      Referer: TRA_FARE_PAGE,
    }),
    body: traFareBody(token, fromId, toId, date),
  }, signal);
  const fares = parseTraFarePage(html);
  if (!fares) throw new Error(`TRA priced nothing from ${fromId} to ${toId}`);
  return fares;
}

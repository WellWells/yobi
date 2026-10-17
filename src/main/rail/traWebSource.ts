/**
 * TRA's own query-by-train-number page: one train's stops and, while it runs, where it is and how
 * late. The form is CSRF-protected, so a query is two requests (GET for the token and cookie, then
 * POST). It is a web page, not an API — used only when someone asks about one TRA train, so it
 * costs TDX nothing.
 */
import { browserHeaders, railFetch, railText } from './railHttp';
import type { FetchFn } from './railHttp';
import { traTypeFromLabel } from './traTrainTypes';

export const TRA_TRAIN_PAGE = 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip112/querybytrainno';
export const TRA_TIME_PAGE = 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip112/gobytime';

export interface TraLiveStop {
  station: string;
  arr: string;
  dep: string;
  /** TRA's delay text ("3 min late", "on time") as written, or '' where TRA shows nothing. */
  status: string;
}

export interface TraTrainLive {
  no: string;
  type: string;
  from: string;
  to: string;
  departs: string;
  arrives: string;
  /** The Mountain or Coast line as TRA writes it, or ''. */
  line: string;
  note: string;
  stops: TraLiveStop[];
  /**
   * Where the train is, as TRA marks it: one station while it stands there, the two stations it is
   * between while it runs. Absent when TRA marks none (not running yet, or already arrived).
   */
  position?: { stations: string[]; status: string };
  /** TRA's own query time, `YYYY/MM/DD HH:MM:SS`. */
  queriedAt: string;
}

function decode(value: string): string {
  return value.replace(/<[^>]*>/gu, '').replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').trim();
}

function cells(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => decode(m[1]));
}

export function parseTraTrainPage(html: string): TraTrainLive | null {
  const label = /icon-train[^>]*>\s*<\/span>\s*<span>([^<]+)<\/span>/u.exec(html)?.[1]?.trim();
  if (!label) return null;
  const no = /(\d+)\s*$/u.exec(label)?.[1] ?? '';
  const ends = [...html.matchAll(/<span class="time">([^<]*)<\/span>\s*<span class="location">([^<]*)<\/span>/gu)];
  const tableStart = html.indexOf('<table class="itinerary-controls');
  const tableEnd = tableStart >= 0 ? html.indexOf('</table>', tableStart) : -1;
  const table = tableStart >= 0 && tableEnd > tableStart ? html.slice(tableStart, tableEnd) : '';
  const stops: TraLiveStop[] = [];
  for (const row of table.split(/<tr>/u).slice(1)) {
    const values = cells(row);
    if (values.length < 3 || !/^\d{1,2}:\d{2}$/u.test(values[1] || values[2])) continue;
    stops.push({ station: values[0], arr: values[1], dep: values[2], status: values.slice(3).find(Boolean) ?? '' });
  }
  if (!no || stops.length === 0) return null;
  const marked = stops.filter((stop) => stop.status);
  const info = html.slice(html.indexOf('trip-info'), tableStart >= 0 ? tableStart : undefined);
  return {
    no,
    type: traTypeFromLabel(label),
    from: ends[0]?.[2]?.trim() ?? stops[0].station,
    to: ends[1]?.[2]?.trim() ?? stops.at(-1)?.station ?? '',
    departs: ends[0]?.[1]?.trim() ?? stops[0].dep,
    arrives: ends[1]?.[1]?.trim() ?? stops.at(-1)?.arr ?? '',
    line: /<td width="10%">([^<]*)<\/td>/u.exec(info)?.[1]?.trim() ?? '',
    note: decode(/<span class="note">([\s\S]*?)<\/span>/u.exec(info)?.[1] ?? ''),
    stops,
    ...(marked.length > 0 ? { position: { stations: marked.map((s) => s.station), status: marked[0].status } } : {}),
    queriedAt: /查詢時間\s*[:：]\s*([\d/]+\s+[\d:]+)/u.exec(html)?.[1] ?? '',
  };
}

/** The `name=value` pairs of every Set-Cookie, ready for a Cookie header. */
export function cookieHeader(res: Response): string {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return all.map((line) => line.split(';')[0].trim()).filter(Boolean).join('; ');
}

export function csrfToken(html: string): string {
  return /name="_csrf"\s+value="([^"]+)"/u.exec(html)?.[1] ?? '';
}

/** One TRA train on a date (`YYYY-MM-DD`); null when TRA has no such train that day. */
export async function fetchTraTrainLive(fetchFn: FetchFn, trainNo: string, date: string, signal?: AbortSignal): Promise<TraTrainLive | null> {
  const form = await railFetch(fetchFn, TRA_TRAIN_PAGE, { headers: browserHeaders(TRA_TRAIN_PAGE) }, signal);
  if (!form.ok) throw new Error(`TRA train page answered HTTP ${form.status}`);
  const token = csrfToken(await form.text());
  if (!token) throw new Error('TRA train page has no form token');
  const html = await railText(fetchFn, TRA_TRAIN_PAGE, {
    method: 'POST',
    headers: browserHeaders(TRA_TRAIN_PAGE, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(form),
      Referer: TRA_TRAIN_PAGE,
    }),
    body: new URLSearchParams({ _csrf: token, rideDate: date.replaceAll('-', '/'), trainNo }).toString(),
  }, signal);
  return parseTraTrainPage(html);
}

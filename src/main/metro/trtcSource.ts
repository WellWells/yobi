/**
 * Taipei Metro (incl. the Circular line) read from its own site, no key needed (2026-10-22):
 *
 * - `apis/metrostationapi/*` are the JSON calls behind its fare query page (POST, JSON body).
 *   `ticketroutetimesinglestationinfo` answers one origin with every destination's fare and ride
 *   time (~40 KB, ~0.2 s), so one call per origin, kept a day, prices every trip from it.
 *   `routetimepathinfo` words the route ("搭乘板南線（往亞東醫院/往頂埔） => 忠孝復興站轉乘文湖線（往動物園）").
 * - The route planner (pages2026/WebRoutePlan, ASP.NET) answers a postback with the next departure
 *   by the server's clock, the arrival, and the pair's first and last train — so only for "now".
 *   Node fetch POSTs without a cookie or view state got 200 with an answer every time (10 of 10);
 *   one curl POST earlier the same day got a bare 302 with no body. A page that is not an answer
 *   is retried once after a GET that sets the session cookies.
 * - pages2026/WebAbnormal is the per-line status the site's own status widget opens.
 *
 * Cloudflare is in front; ~100 plain requests over the day met no challenge.
 */
import { cookieHeader } from '../rail/traWebSource';
import { browserHeaders, railFetch, railJson, railText } from '../rail/railHttp';
import type { FetchFn } from '../rail/railHttp';
import { clockMinutes, DAY_MINUTES } from '../rail/railTime';
import type { LegQuote, MetroDeparture, MetroDeps, MetroStation, NetworkSource, QuoteWhen, StatusSource, TicketPrice } from './metroTypes';
import { stationNode } from './metroTypes';
import { TRTC_PROMOTE_NOTE, TRTC_TICKET_KINDS, parseAbnormal, parseFareList, parseMenuline, parseRoutePath, parseRoutePlan } from './trtcParse';
import type { TrtcFare, TrtcMenuStation, TrtcRoutePlan } from './trtcParse';

const API = 'https://web.metro.taipei/apis/metrostationapi/';
export const TRTC_ROUTE_PLAN_PAGE = 'https://web.metro.taipei/pages2026/WebRoutePlan';
export const TRTC_STATUS_PAGE = 'https://web.metro.taipei/pages2026/WebAbnormal';

const DAY_MS = 86_400_000;
const PLAN_TTL_MS = 30_000;
const STATUS_TTL_MS = 60_000;

/** The fare query page for one pair, the way the page itself links it (SIDs). */
export function trtcFarePage(fromSid: string, toSid: string): string {
  return `https://web.metro.taipei/pages/tw/ticketroutetime/${fromSid}/${toSid}`;
}

async function postApi(fetchFn: FetchFn, name: string, body: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const url = `${API}${name}`;
  return railJson(fetchFn, url, {
    method: 'POST',
    headers: browserHeaders(url, { 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(body),
  }, signal);
}

/** The live station menu in both languages (the self-test compares it with `TRTC_STATIONS`). */
export async function fetchTrtcMenuline(fetchFn: FetchFn, signal?: AbortSignal): Promise<TrtcMenuStation[]> {
  const [tw, en] = await Promise.all(['tw', 'en'].map((Lang) => postApi(fetchFn, 'menuline', { LineID: '0', Lang }, signal)));
  return parseMenuline(tw, en);
}

export async function fetchTrtcFares(fetchFn: FetchFn, fromSid: string, signal?: AbortSignal): Promise<Map<string, TrtcFare>> {
  return parseFareList(await postApi(fetchFn, 'ticketroutetimesinglestationinfo', { StartSID: fromSid, Lang: 'tw' }, signal));
}

export async function fetchTrtcPath(fetchFn: FetchFn, fromSid: string, toSid: string, signal?: AbortSignal): Promise<{ minutes?: number; route?: string } | null> {
  return parseRoutePath(await postApi(fetchFn, 'routetimepathinfo', { StartSID: fromSid, EndSID: toSid, Lang: 'tw' }, signal));
}

function planBody(fromCode: string, toCode: string): string {
  return new URLSearchParams({ __VIEWSTATE: '', __EVENTTARGET: 'query', __EVENTARGUMENT: `${fromCode}-${toCode}` }).toString();
}

async function postPlan(fetchFn: FetchFn, body: string, cookie: string, signal?: AbortSignal): Promise<TrtcRoutePlan | null> {
  const headers = browserHeaders(TRTC_ROUTE_PLAN_PAGE, {
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: TRTC_ROUTE_PLAN_PAGE,
    ...(cookie ? { Cookie: cookie } : {}),
  });
  const res = await railFetch(fetchFn, TRTC_ROUTE_PLAN_PAGE, { method: 'POST', headers, body }, signal);
  return res.ok ? parseRoutePlan(await res.text()) : null;
}

/** The planner's answer for two station codes, by the server's clock. */
export async function fetchTrtcRoutePlan(fetchFn: FetchFn, fromCode: string, toCode: string, signal?: AbortSignal): Promise<TrtcRoutePlan> {
  const body = planBody(fromCode, toCode);
  const first = await postPlan(fetchFn, body, '', signal);
  if (first) return first;
  const page = await railFetch(fetchFn, TRTC_ROUTE_PLAN_PAGE, { headers: browserHeaders(TRTC_ROUTE_PLAN_PAGE) }, signal);
  await page.text();
  const again = await postPlan(fetchFn, body, cookieHeader(page), signal);
  if (!again) throw new Error(`Taipei Metro route planner gave no answer for ${fromCode}-${toCode}`);
  return again;
}

/** HH:MM with hours past 23 kept counting ("24:36"). */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A clock time read as the first time at or after `floor` (within a day), past midnight counting on. */
function after(text: string, floor: number): number {
  const minutes = clockMinutes(text);
  return minutes < floor ? minutes + DAY_MINUTES : minutes;
}

function departureOf(plan: TrtcRoutePlan, when: QuoteWhen): MetroDeparture | null {
  if (!plan.departure) return null;
  // The planner may already plan past midnight (23:58 → 00:03); 12 h back means "tomorrow", not late.
  const dep = after(plan.departure, when.minutes - DAY_MINUTES / 2);
  return {
    time: clock(dep),
    ...(plan.arrive ? { arrive: clock(after(plan.arrive, dep)) } : {}),
    ...(plan.toward ? { toward: plan.toward } : {}),
  };
}

function ticketsOf(elderly: number | undefined, child: number | undefined): TicketPrice[] {
  const out: TicketPrice[] = [];
  if (elderly !== undefined) out.push({ kind: TRTC_TICKET_KINDS.elderly, ntd: elderly });
  if (child !== undefined) out.push({ kind: TRTC_TICKET_KINDS.child, ntd: child });
  return out;
}

function settled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}

function reason(result: PromiseSettledResult<unknown>): string {
  return result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : 'no answer';
}

/** The station's SID, refusing anything not Taipei Metro's. */
function sidOf(station: MetroStation): string {
  if (station.network !== 'trtc' || !station.ref) throw new Error(`${station.zh} is not a Taipei Metro station`);
  return station.ref;
}

async function quote(from: MetroStation, to: MetroStation, when: QuoteWhen, deps: MetroDeps): Promise<LegQuote> {
  const fromSid = sidOf(from);
  const toSid = sidOf(to);
  if (fromSid === toSid) throw new Error(`${from.zh} to ${to.zh} is the same Taipei Metro station`);
  const { fetchFn, memo, signal } = deps;
  const [fares, path, plan] = await Promise.allSettled([
    memo(`trtc-fares-${fromSid}`, DAY_MS, () => fetchTrtcFares(fetchFn, fromSid, signal)),
    memo(`trtc-path-${fromSid}-${toSid}`, DAY_MS, () => fetchTrtcPath(fetchFn, fromSid, toSid, signal)),
    // Asked for another time too: the planner only plans "now", but its first and last train for
    // the pair are the day's, which is what a later leg or a station's last train needs.
    memo(`trtc-plan-${from.codes[0]}-${to.codes[0]}`, PLAN_TTL_MS, () => fetchTrtcRoutePlan(fetchFn, from.codes[0], to.codes[0], signal)),
  ]);
  const listed = settled(fares)?.get(toSid);
  const planned = settled(plan) ?? undefined;
  // An answer for other stations (the page fell back to a blank form, say) is no answer.
  const answer = planned && from.codes.includes(planned.fromCode) && to.codes.includes(planned.toCode) ? planned : undefined;
  const fare = listed?.fare ?? answer?.fare;
  if (fare === undefined) throw new Error(`Taipei Metro gave no fare from ${from.zh} to ${to.zh}: ${reason(fares)}`);
  const tickets = listed ? ticketsOf(listed.elderly, listed.child) : ticketsOf(answer?.elderly, answer?.child);
  const route = settled(path)?.route;
  const minutes = listed?.minutes ?? settled(path)?.minutes ?? answer?.minutes;
  const departure = answer && when.isNow ? departureOf(answer, when) : null;
  const notes: string[] = [];
  if (listed?.promote) notes.push(TRTC_PROMOTE_NOTE);
  if (!answer) notes.push(`${when.isNow ? 'Next train and first/last train' : 'First/last train'} unavailable: Taipei Metro's route planner did not answer (${reason(plan)}).`);
  if (!when.isNow) notes.push('Taipei Metro gives next trains only for now.');
  const first = answer?.firstTrain;
  const last = answer?.lastTrain;
  return {
    network: 'trtc',
    from: stationNode(from),
    to: stationNode(to),
    fare,
    ...(tickets.length > 0 ? { tickets } : {}),
    ...(minutes !== undefined ? { minutes } : {}),
    ...(route ? { route } : {}),
    ...(departure ? { departures: [departure] } : {}),
    ...(first ? { firstTrain: first } : {}),
    // The last train runs past midnight (00:36); counted on so it sorts after the first.
    ...(last ? { lastTrain: first ? clock(after(last, clockMinutes(first))) : last } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    sources: answer ? [trtcFarePage(fromSid, toSid), TRTC_ROUTE_PLAN_PAGE] : [trtcFarePage(fromSid, toSid)],
  };
}

export const trtcSource: NetworkSource = { network: 'trtc', quote };

export const trtcStatus: StatusSource = {
  operator: 'trtc',
  status: (deps) => deps.memo('trtc-status', STATUS_TTL_MS, async () => {
    const html = await railText(deps.fetchFn, TRTC_STATUS_PAGE, { headers: browserHeaders(TRTC_STATUS_PAGE) }, deps.signal);
    return parseAbnormal(html, TRTC_STATUS_PAGE);
  }),
};

/**
 * Taoyuan Airport MRT (TYMC) quotes and status from TYMC's own site — the page's own requests, not
 * a published API (2026-10-22):
 *
 * - "票價與時刻表查詢" posts the station ids (and a date) to timetable-search.php and gets one HTML
 *   page with the pair's whole service day and its full fare row. Without a Referer on
 *   www.tymetro.com.tw it quietly serves the blank form instead (HTTP 200, no rows). A date past
 *   the banner's "時刻表更新至" comes back with fares but no trains and no error: that is a
 *   timetable not published yet, never "no trains". Only trains stopping at both ends are listed,
 *   so the peak 直達車 that run on to A18/A21 show up for those stations as plain 直達車.
 * - The homepage carries one 最新營運狀態 for the whole line.
 *
 * The live board (PIDS_cache.php) is not used: in four snapshots its EstDepartureTime equalled
 * the schedule for 208 of 208 trains, DelayTime ran to -1,682 s, and from 21:13 it answered
 * {"error":"No sites found!"} — it adds nothing the timetable does not say.
 */
import { browserHeaders, railText } from '../rail/railHttp';
import { DAY_MINUTES, addDays, isIsoDate } from '../rail/railTime';
import { stationNode } from './metroTypes';
import type { LegQuote, MetroDeparture, MetroDeps, MetroStation, NetworkSource, QuoteWhen, StatusSource } from './metroTypes';
import { parseTymcSearch, parseTymcStatus } from './tymcParse';
import type { TymcRow, TymcSearchPage } from './tymcParse';

export const TYMC_SEARCH_URL = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-search.php';
export const TYMC_HOME_URL = 'https://www.tymetro.com.tw/tymetro-new/tw/index.php';

const SEARCH_TTL_MS = 6 * 60 * 60_000;
const STATUS_TTL_MS = 60_000;
const MAX_DEPARTURES = 5;
/** Before 04:00 the previous service day's last trains may still be to come (A12 → A13 runs until 00:28). */
const SMALL_HOURS = 4 * 60;

/** The form the page posts; `advanced-status` is what makes it read `godate`. */
export function tymcSearchBody(fromRef: string, toRef: string, date: string): URLSearchParams {
  return new URLSearchParams({ start_station: fromRef, end_station: toRef, godate: date, 'advanced-status': 'visible' });
}

/** One search per pair per date, shared by everyone asking for six hours. */
export async function fetchTymcSearch(fromRef: string, toRef: string, date: string, deps: MetroDeps): Promise<TymcSearchPage> {
  return deps.memo(`tymc-${fromRef}-${toRef}-${date}`, SEARCH_TTL_MS, async () => {
    const html = await railText(deps.fetchFn, TYMC_SEARCH_URL, {
      method: 'POST',
      headers: browserHeaders(TYMC_SEARCH_URL, {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: TYMC_SEARCH_URL,
      }),
      body: tymcSearchBody(fromRef, toRef, date).toString(),
    }, deps.signal);
    return parseTymcSearch(html);
  });
}

function departureOf(row: TymcRow, shift: number): MetroDeparture {
  return { time: serviceClock(row.depart - shift), arrive: serviceClock(row.arrive - shift), type: row.type };
}

function mostCommonMinutes(rows: readonly TymcRow[]): number | undefined {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.minutes, (counts.get(row.minutes) ?? 0) + 1);
  let best: number | undefined;
  for (const [minutes, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0)) best = minutes;
  }
  return best;
}

/** 1450 → "24:10": past midnight keeps counting, as `MetroDeparture` asks. */
function serviceClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timetableNotes(page: TymcSearchPage, date: string): string[] {
  if (page.date !== date) return [`TYMC's timetable search would not answer for ${date} (it answered for ${page.date ?? 'no date'}); no trains are given.`];
  if (page.rows.length > 0) return [];
  if (page.horizon && date > page.horizon) {
    const ahead = page.checkDaysAhead ? ` TYMC asks riders to check again ${page.checkDaysAhead} days before travel.` : '';
    return [`TYMC has published its timetable up to ${page.horizon}; trains for ${date} are not out yet.${ahead}`];
  }
  return [`TYMC's timetable search listed no trains between these stations on ${date}.`];
}

/**
 * The quote from the asked day's search and, in the small hours, the previous day's (its trains
 * after midnight). `previous` is ignored unless TYMC answered it for the day before.
 */
export function tymcQuote(page: TymcSearchPage, previous: TymcSearchPage | null, from: MetroStation, to: MetroStation, when: QuoteWhen): LegQuote {
  // A stored-value card (悠遊卡/一卡通 普通卡) pays 全票, the single-ticket price (TYMC's 電子票證 page).
  const full = page.fares.find((ticket) => ticket.kind === '全票');
  const tickets = page.fares.filter((ticket) => ticket !== full);
  const notes = timetableNotes(page, when.date);
  const rows = page.date === when.date ? page.rows : [];
  const leftovers = previous && previous.date === addDays(when.date, -1)
    ? previous.rows.filter((row) => row.depart >= when.minutes + DAY_MINUTES)
    : [];
  const departures = [
    ...leftovers.map((row) => departureOf(row, DAY_MINUTES)),
    ...rows.filter((row) => row.depart >= when.minutes).map((row) => departureOf(row, 0)),
  ].slice(0, MAX_DEPARTURES);
  const next = leftovers[0] ?? rows.find((row) => row.depart >= when.minutes);
  const minutes = next?.minutes ?? mostCommonMinutes(rows);
  return {
    network: 'tymc',
    from: stationNode(from),
    to: stationNode(to),
    ...(full ? { fare: full.ntd } : {}),
    ...(tickets.length > 0 ? { tickets } : {}),
    ...(minutes === undefined ? {} : { minutes }),
    ...(departures.length > 0 ? { departures } : {}),
    ...(rows.length > 0 ? { firstTrain: serviceClock(rows[0].depart), lastTrain: serviceClock(rows[rows.length - 1].depart) } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    sources: [TYMC_SEARCH_URL],
  };
}

function checkStation(station: MetroStation): string {
  if (station.network !== 'tymc' || !station.ref) throw new Error(`${station.codes[0]} is not a TYMC station`);
  return station.ref;
}

export const tymcSource: NetworkSource = {
  network: 'tymc',
  async quote(from, to, when, deps) {
    const fromRef = checkStation(from);
    const toRef = checkStation(to);
    if (fromRef === toRef) throw new Error('A TYMC quote needs two different stations');
    // TYMC answers an unreadable date with today's timetable, silently; refuse it here instead.
    if (!isIsoDate(when.date)) throw new Error(`Not a date: ${when.date}`);
    const [page, previous] = await Promise.all([
      fetchTymcSearch(fromRef, toRef, when.date, deps),
      when.minutes < SMALL_HOURS
        ? fetchTymcSearch(fromRef, toRef, addDays(when.date, -1), deps).catch(() => null)
        : Promise.resolve(null),
    ]);
    return tymcQuote(page, previous, from, to, when);
  },
};

export const tymcStatus: StatusSource = {
  operator: 'tymc',
  async status(deps) {
    const status = await deps.memo('tymc-status', STATUS_TTL_MS, async () => {
      const html = await railText(deps.fetchFn, TYMC_HOME_URL, { headers: browserHeaders(TYMC_HOME_URL) }, deps.signal);
      return parseTymcStatus(html);
    });
    return [{ operator: 'tymc', line: '機場捷運', normal: status.normal, text: status.text, source: TYMC_HOME_URL }];
  },
};

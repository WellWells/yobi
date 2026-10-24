/**
 * What the two tools answer. "Now" is decided here — Taipei time when the question gives none —
 * and echoed as `query_time`, because the model only knows today's date, not the clock.
 */
import { errorText } from '../../shared/errorText';
import { RailData } from './railData';
import type { Live, RailDataDeps } from './railData';
import { byPair, pairKey, priceTra } from './railFares';
import { formatJourney, formatLeg, formatTraFares, officialLinks, placeLabel } from './railFormat';
import type { LegLive } from './railFormat';
import { planJourneys } from './router';
import { addDays, clockMinutes, dateArg, DAY_MINUTES, daysBetween, formatClock, formatQueryTime, isIsoDate, taipeiClock, timeArg } from './railTime';
import { nodeMode } from './railTypes';
import type { Leg, RailMode, RailNode, RailTrain, TimeIs, TripSort } from './railTypes';
import { isResolved, resolvePlace, stationName } from './stations';
import { seatKey } from './tdxSources';
import type { SeatInfo, TraDelay } from './tdxSources';
import type { TraTrainLive } from './traWebSource';

/** How far ahead the operators publish: THSR about four weeks, TRA about two months. */
export const PUBLISHED_DAYS: Readonly<Record<RailMode, number>> = { thsr: 28, tra: 60 };
const LIVE_AHEAD_MIN = 180;
const MAX_LIMIT = 8;

/**
 * Without TDX, the THSR searches that list the day's full-length trains, both ways: 南港–左營, and
 * 台北–左營 for the trains that start or end at 台北 instead of 南港.
 */
export const THSR_WHOLE_LINE: readonly [RailNode, RailNode][] = [
  ['thsr:0990', 'thsr:1070'], ['thsr:1070', 'thsr:0990'],
  ['thsr:1000', 'thsr:1070'], ['thsr:1070', 'thsr:1000'],
];

function uniquePairs(pairs: readonly [RailNode, RailNode][]): [RailNode, RailNode][] {
  const seen = new Set<string>();
  return pairs.filter(([from, to]) => {
    const key = `${from}>${to}`;
    if (seen.has(key) || from === to) return false;
    seen.add(key);
    return true;
  });
}

/** Without TDX, TRA's train page is asked about trains leaving within this many minutes, at most this many. */
const TRA_PAGE_AHEAD_MIN = 30;
const TRA_PAGE_MAX_TRAINS = 3;

/**
 * Until when the previous service day's TRA trains may still be on their way: ODS keeps a train in
 * the file of the day it starts, its calls after midnight past 1440 (the real files run to 07:52).
 */
const OVERNIGHT_REACH_MIN = 8 * 60;

/**
 * The trains of service day `serviceDay` from midnight on, as times of the next day, each marked
 * with the day it started; trains done by then are left out.
 */
export function afterMidnight(trains: readonly RailTrain[], serviceDay: string): RailTrain[] {
  return trains.flatMap((train) => {
    const stops = train.stops
      .filter((stop) => stop.dep >= DAY_MINUTES)
      .map((stop) => ({ ...stop, arr: Math.max(0, stop.arr - DAY_MINUTES), dep: stop.dep - DAY_MINUTES }));
    return stops.length >= 2 ? [{ ...train, stops, serviceDay }] : [];
  });
}

/** TRA's own page's "誤點 5 分" / "準點" as a delay report; null when the train is not running. */
export function pageDelay(page: TraTrainLive | null): TraDelay | null {
  if (!page?.position) return null;
  const late = /誤點\s*(\d+)\s*分/u.exec(page.position.status);
  if (!late && !/準點/u.test(page.position.status)) return null;
  return {
    minutes: late ? Number(late[1]) : 0,
    station: page.position.stations.join('–'),
    at: page.queriedAt.replace(/\//gu, '-'),
  };
}

/** One entry per train number: several searches list the same train, the one with the most stops is kept. */
export function mergeTrains(trains: readonly RailTrain[]): RailTrain[] {
  const byNo = new Map<string, RailTrain>();
  for (const train of trains) {
    const held = byNo.get(train.no);
    if (!held || train.stops.length > held.stops.length) byNo.set(train.no, train);
  }
  return [...byNo.values()];
}

export interface TripArgs {
  from: string;
  to: string;
  date?: string;
  time?: string;
  time_is?: TimeIs;
  sort?: TripSort;
  modes?: 'any' | RailMode;
  limit?: number;
}

export interface TrainArgs {
  train: string;
  date?: string;
  mode?: 'auto' | RailMode;
}

function liveNote(name: string, live: Live<unknown>, now: number): string | undefined {
  if (live.value !== undefined && live.at !== undefined && !live.unavailable) return `${name}: as of ${Math.round((now - live.at) / 60_000)} min ago`;
  if (live.value !== undefined && live.at !== undefined) return `${name}: from ${Math.round((now - live.at) / 60_000)} min ago (${live.unavailable})`;
  return live.unavailable ? `${name}: unavailable (${live.unavailable})` : undefined;
}

function checkDate(date: string, today: string, modes: readonly RailMode[]): void {
  if (!isIsoDate(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}"`);
  const ahead = daysBetween(today, date);
  if (ahead < 0) throw new Error(`${date} is in the past (today is ${today} in Taipei)`);
  if (modes.every((mode) => ahead > PUBLISHED_DAYS[mode])) {
    throw new Error(`Timetables for ${date} are not published yet (THSR about ${PUBLISHED_DAYS.thsr} days ahead, TRA about ${PUBLISHED_DAYS.tra})`);
  }
}

/** The TRA stations the question names: the first TRA match on each side, the exact name before neighbours. */
function askedTraPair(from: readonly RailNode[], to: readonly RailNode[]): { from: RailNode; to: RailNode } | undefined {
  const start = from.find((node) => nodeMode(node) === 'tra');
  const end = to.find((node) => nodeMode(node) === 'tra');
  return start && end && start !== end ? { from: start, to: end } : undefined;
}

function resolveOrThrow(text: string, modes: readonly RailMode[]): RailNode[] {
  const place = resolvePlace(String(text ?? ''), modes);
  if (isResolved(place)) return place.nodes;
  const close = place.suggestions.length > 0 ? ` Close names: ${place.suggestions.join(', ')}.` : '';
  throw new Error(`Unknown station "${place.query}".${close}`);
}

export function createRailService(deps: RailDataDeps) {
  const data = new RailData(deps);
  let sweptFor = '';

  /** Drops earlier days' timetables once a day: Yobi stays on for weeks, a day's TRA file is ~2 MB. */
  function sweepOnNewDay(today: string): void {
    if (sweptFor === today) return;
    sweptFor = today;
    void data.sweep(today).catch(() => undefined);
  }

  /**
   * The TRA trains of the service day before `date`, for a question about its small hours; a note
   * says so when that file cannot be read (ODS lists today onward only, so after a first launch
   * past midnight there is no copy to fall back on).
   */
  async function previousDayTra(date: string, notes: string[], signal?: AbortSignal): Promise<RailTrain[]> {
    const previous = addDays(date, -1);
    return data.traTimetable(previous, signal).then((r) => r.value, (err: unknown) => {
      notes.push(`TRA trains of ${previous} still running after midnight are not included: ${errorText(err)}`);
      return [];
    });
  }

  /** The day's trains for the modes asked, with a note for each source that could not be read. */
  async function dayTrains(date: string, modes: readonly RailMode[], thsrPairs: [RailNode, RailNode][], notes: string[], signal?: AbortSignal): Promise<RailTrain[]> {
    const trains: RailTrain[] = [];
    const today = taipeiClock(deps.now()).date;
    const ahead = daysBetween(today, date);
    const tasks: Promise<void>[] = [];
    if (modes.includes('tra') && ahead <= PUBLISHED_DAYS.tra) {
      tasks.push(data.traTimetable(date, signal).then((r) => { trains.push(...r.value); }, (err) => { notes.push(`TRA timetable unavailable: ${errorText(err)}`); }));
    }
    if (modes.includes('thsr') && ahead <= PUBLISHED_DAYS.thsr) {
      tasks.push(data.thsrTimetable(date, signal).then((r) => { trains.push(...r.value); }, async (err) => {
        // THSR's own search lists each train with every station it calls at, so the whole-line
        // searches give the day's full-length trains (and a change to or from TRA anywhere on
        // the line); the pairs asked about add the trains that do not run end to end.
        const pairs = uniquePairs([...thsrPairs, ...THSR_WHOLE_LINE]);
        const fallback = await Promise.all(pairs.map(([from, to]) => data.thsrWeb(from, to, date, signal).then((r) => r.value.trains, () => [] as RailTrain[])));
        const found = mergeTrains(fallback.flat());
        trains.push(...found);
        notes.push(found.length > 0
          ? `THSR timetable from thsrc.com.tw: whole-line trains and the stations asked (TDX: ${errorText(err)})`
          : `THSR timetable unavailable: ${errorText(err)}`);
      }));
    }
    await Promise.all(tasks);
    return trains;
  }

  async function legLives(legs: Leg[], date: string, nowMin: number, isToday: boolean, signal?: AbortSignal) {
    const lives = new Map<Leg, LegLive>(legs.map((leg) => [leg, {}]));
    const live: Record<string, string> = {};
    const now = deps.now().getTime();
    const thsrLegs = legs.filter((leg) => nodeMode(leg.from) === 'thsr');
    // Fares and offers: one THSR search per THSR pair in the answer, cached for hours.
    const searches = await byPair(thsrLegs, (from, to) => data.thsrWeb(from, to, date, signal));
    for (const leg of thsrLegs) {
      const search = searches.get(pairKey(leg));
      const entry = lives.get(leg) as LegLive;
      if (search?.fares) entry.fares = search.fares;
      if (search?.discounts[leg.train.no]) entry.discounts = search.discounts[leg.train.no];
    }
    if (!isToday) return { lives, live };

    const traLegs = legs.filter((leg) => nodeMode(leg.from) === 'tra' && leg.dep <= nowMin + LIVE_AHEAD_MIN && leg.arr >= nowMin);
    if (traLegs.length > 0 && !data.hasTdxKey()) {
      // No TDX key: TRA's own train-status page, one request per train, for the few trains
      // already running or about to leave (a train not yet out has no position to report).
      // The page reports one run, picked by its ride date: a train still running from last night
      // is asked about by the day it started, or the page answers for today's run of that number.
      const runOf = (leg: Leg) => ({ no: leg.train.no, day: leg.train.serviceDay ?? date });
      const runKey = (run: { no: string; day: string }) => `${run.day}|${run.no}`;
      const runs = new Map(traLegs.filter((leg) => leg.dep <= nowMin + TRA_PAGE_AHEAD_MIN).map((leg) => [runKey(runOf(leg)), runOf(leg)] as const));
      const running = [...runs.values()].slice(0, TRA_PAGE_MAX_TRAINS);
      const pages = await Promise.all(running.map((run) => data.traTrainLive(run.no, run.day, signal).then((r) => r.value, () => null)));
      const delays = new Map(running.flatMap((run, i) => {
        const delay = pageDelay(pages[i]);
        return delay ? [[runKey(run), delay] as const] : [];
      }));
      const labels = running.map((run) => (run.day === date ? run.no : `${run.no} (left on ${run.day})`));
      live.tra_delay = running.length > 0
        ? `from TRA's train-status page for ${labels.join(', ')} (no TDX key; other trains not checked)`
        : 'not checked: no train in these plans is running yet (no TDX key; TRA\'s train-status page reports running trains)';
      for (const leg of traLegs) {
        const delay = delays.get(runKey(runOf(leg)));
        if (delay) (lives.get(leg) as LegLive).delay = delay;
      }
    } else if (traLegs.length > 0) {
      const delays = await data.traDelays(signal);
      const note = liveNote('tra_delay', delays, now);
      if (note) live.tra_delay = note;
      for (const leg of traLegs) {
        const delay: TraDelay | undefined = delays.value?.get(leg.train.no);
        if (delay) (lives.get(leg) as LegLive).delay = delay;
      }
    }
    const boarding = [...new Set(thsrLegs.filter((leg) => leg.dep >= nowMin).map((leg) => leg.from))].slice(0, 2);
    for (const station of boarding) {
      const seats = await data.thsrSeats(station, signal);
      const note = liveNote(`thsr_seats_${stationName(station)}`, seats, now);
      if (note) live[`thsr_seats_${stationName(station)}`] = note;
      for (const leg of thsrLegs.filter((l) => l.from === station)) {
        const info: SeatInfo | undefined = seats.value?.get(seatKey(leg.train.no, leg.to));
        if (info) (lives.get(leg) as LegLive).seats = info;
      }
    }
    return { lives, live };
  }

  async function alertsFor(modes: readonly RailMode[], signal?: AbortSignal): Promise<string[]> {
    const alerts = await data.alerts(signal);
    if (!alerts.value) return [];
    return [...(modes.includes('thsr') ? alerts.value.thsr : []), ...(modes.includes('tra') ? alerts.value.tra : [])];
  }

  async function planTrip(args: TripArgs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const now = deps.now();
    const clock = taipeiClock(now);
    sweepOnNewDay(clock.date);
    const modes: RailMode[] = args.modes === 'thsr' || args.modes === 'tra' ? [args.modes] : ['thsr', 'tra'];
    const from = resolveOrThrow(args.from, modes);
    const to = resolveOrThrow(args.to, modes);
    let date = dateArg(args.date, clock.date);
    checkDate(date, clock.date, modes);
    const timeIs: TimeIs = args.time_is === 'arrive' ? 'arrive' : 'depart';
    const sort: TripSort = args.sort === 'shortest' || args.sort === 'earliest_departure' ? args.sort : 'earliest_arrival';
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(args.limit) || 5)));
    const asked = timeArg(args.time);
    let time = asked ? clockMinutes(asked) : date === clock.date ? clock.minutes : timeIs === 'arrive' ? 24 * 60 : 0;
    if (!Number.isFinite(time)) throw new Error(`time must be HH:MM, got "${asked}"`);

    const thsrFrom = from.filter((n) => nodeMode(n) === 'thsr');
    const thsrTo = to.filter((n) => nodeMode(n) === 'thsr');
    const thsrPairs = thsrFrom.flatMap((f) => thsrTo.map((t): [RailNode, RailNode] => [f, t]));
    const notes: string[] = [];
    let trains = await dayTrains(date, modes, thsrPairs, notes, signal);
    if (modes.includes('tra') && time < OVERNIGHT_REACH_MIN) {
      // Asked for the small hours: last night's trains are still running (THSR stops before midnight).
      trains = [...afterMidnight(await previousDayTra(date, notes, signal), addDays(date, -1)), ...trains];
    }
    if (trains.length === 0) throw new Error(`No timetable could be read for ${date}. ${notes.join('; ')}`);
    let journeys = planJourneys(trains, { from, to, time, timeIs, sort, limit });
    if (journeys.length === 0 && timeIs === 'depart') {
      const next = addDays(date, 1);
      const nextTrains = await dayTrains(next, modes, thsrPairs, notes, signal).catch(() => [] as RailTrain[]);
      const nextJourneys = planJourneys(nextTrains, { from, to, time: 0, timeIs, sort, limit });
      if (nextJourneys.length > 0) {
        notes.push(`No more trains on ${date} after ${formatClock(time)}; showing ${next}`);
        date = next;
        time = 0;
        trains = nextTrains;
        journeys = nextJourneys;
      }
    }
    const isToday = date === clock.date;
    const [{ lives, live }, tra] = await Promise.all([
      legLives(journeys.flatMap((j) => j.legs), date, clock.minutes, isToday, signal),
      priceTra(journeys, {
        fares: (f, t) => data.traFares(f, t, date, signal),
        offers: (f, t, unreserved) => data.traTrainOffers(f, t, date, unreserved, signal),
      }, askedTraPair(from, to)),
    ]);
    for (const [leg, fare] of tra.legs) (lives.get(leg) as LegLive).traFare = fare;
    const alerts = isToday ? await alertsFor(modes, signal) : [];
    return {
      query_time: formatQueryTime(now),
      date,
      from: placeLabel(from),
      to: placeLabel(to),
      [timeIs === 'arrive' ? 'arrive_by' : 'depart_after']: formatClock(time),
      sort,
      journeys: journeys.map((j) => formatJourney(j, (leg) => lives.get(leg) ?? {}, tra.tickets.get(j))),
      ...(tra.tables.length > 0 ? { tra_fares: tra.tables.map(formatTraFares) } : {}),
      ...(journeys.length === 0 ? { no_journey: 'No train connects these stations in the 6 hours searched (at most one change).' } : {}),
      ...(Object.keys(live).length > 0 ? { live } : {}),
      ...(alerts.length > 0 ? { alerts } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      official_links: officialLinks(modes, { traFares: tra.tickets.size > 0 || tra.legs.size > 0 || tra.tables.length > 0 }),
    };
  }

  async function trainInfo(args: TrainArgs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const now = deps.now();
    const clock = taipeiClock(now);
    sweepOnNewDay(clock.date);
    const raw = String(args.train ?? '').replace(/[次號号車车\s]/gu, '');
    if (!/^\d{1,4}$/u.test(raw)) throw new Error(`train must be a train number such as 1006 or 0803, got "${args.train}"`);
    const modes: RailMode[] = args.mode === 'thsr' || args.mode === 'tra' ? [args.mode] : ['thsr', 'tra'];
    const date = dateArg(args.date, clock.date);
    checkDate(date, clock.date, modes);
    const notes: string[] = [];
    const trains = await dayTrains(date, modes, [], notes, signal);
    const wanted = (train: RailTrain) => (train.mode === 'thsr' ? train.no === raw.padStart(4, '0') : train.no === raw.replace(/^0+(?=\d)/u, ''));
    const isToday = date === clock.date;
    // In the small hours a train of the previous service day may still be running (its file holds it).
    const previousDay = isToday && modes.includes('tra') && clock.minutes < OVERNIGHT_REACH_MIN
      ? (await previousDayTra(date, notes, signal)).filter((train) => wanted(train) && (train.stops.at(-1)?.arr ?? 0) > DAY_MINUTES + clock.minutes)
      : [];
    const found = [...previousDay.map((train) => ({ train, day: addDays(date, -1) })), ...trains.filter(wanted).map((train) => ({ train, day: date }))];
    if (found.length === 0) {
      throw new Error(`No train ${raw} on ${date}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`);
    }
    if (previousDay.length > 0) notes.push(`A train with service_day left on ${addDays(date, -1)} and is still running; its times marked (+1) are on ${date}`);
    const results = await Promise.all(found.map(async ({ train, day }) => {
      const whole = {
        ...formatLeg({ train, from: train.stops[0].node, to: train.stops.at(-1)?.node as RailNode, dep: train.stops[0].dep, arr: train.stops.at(-1)?.arr ?? 0 }),
        ...(day !== date ? { service_day: day } : {}),
      };
      const stops = train.stops.map((s) => ({ station: stationName(s.node), arrive: formatClock(s.arr), depart: formatClock(s.dep) }));
      if (!isToday || train.mode !== 'tra') return { ...whole, stops };
      const page = await data.traTrainLive(train.no, day, signal).catch((err: unknown) => ({ error: errorText(err) }));
      if ('error' in page) return { ...whole, stops, live: `unavailable from TRA's site (${page.error})` };
      const position = page.value?.position;
      return {
        ...whole,
        stops,
        live: position
          ? { at_or_between: position.stations, status: position.status, reported_by_tra_at: page.value?.queriedAt ?? '' }
          : 'TRA reports no position now (not running yet, or already arrived)',
      };
    }));
    const alerts = isToday ? await alertsFor(modes, signal) : [];
    return {
      query_time: formatQueryTime(now),
      date,
      trains: results,
      ...(alerts.length > 0 ? { alerts } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      official_links: officialLinks(found.map((f) => f.train.mode), { train: true }),
    };
  }

  return { planTrip, trainInfo, data };
}

export type RailService = ReturnType<typeof createRailService>;

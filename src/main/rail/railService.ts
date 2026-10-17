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
import { addDays, clockMinutes, daysBetween, formatClock, formatQueryTime, isIsoDate, taipeiClock } from './railTime';
import { nodeMode } from './railTypes';
import type { Leg, RailMode, RailNode, RailTrain, TimeIs, TripSort } from './railTypes';
import { isResolved, resolvePlace, stationName } from './stations';
import { seatKey } from './tdxSources';
import type { SeatInfo, TraDelay } from './tdxSources';

/** How far ahead the operators publish: THSR about four weeks, TRA about two months. */
export const PUBLISHED_DAYS: Readonly<Record<RailMode, number>> = { thsr: 28, tra: 60 };
const LIVE_AHEAD_MIN = 180;
const MAX_LIMIT = 8;

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
        // THSR's own search still has the direct trains between the stations asked about.
        const fallback = await Promise.all(thsrPairs.map(([from, to]) => data.thsrWeb(from, to, date, signal).then((r) => r.value.trains, () => [] as RailTrain[])));
        const found = fallback.flat();
        trains.push(...found);
        notes.push(found.length > 0
          ? `THSR timetable from thsrc.com.tw for these stations only (TDX: ${errorText(err)})`
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
    if (traLegs.length > 0) {
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
    let date = args.date?.trim() || clock.date;
    checkDate(date, clock.date, modes);
    const timeIs: TimeIs = args.time_is === 'arrive' ? 'arrive' : 'depart';
    const sort: TripSort = args.sort === 'shortest' || args.sort === 'earliest_departure' ? args.sort : 'earliest_arrival';
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(args.limit) || 5)));
    const asked = args.time?.trim();
    let time = asked ? clockMinutes(asked) : date === clock.date ? clock.minutes : timeIs === 'arrive' ? 24 * 60 : 0;
    if (!Number.isFinite(time)) throw new Error(`time must be HH:MM, got "${asked}"`);

    const thsrFrom = from.filter((n) => nodeMode(n) === 'thsr');
    const thsrTo = to.filter((n) => nodeMode(n) === 'thsr');
    const thsrPairs = thsrFrom.flatMap((f) => thsrTo.map((t): [RailNode, RailNode] => [f, t]));
    const notes: string[] = [];
    let trains = await dayTrains(date, modes, thsrPairs, notes, signal);
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
    const date = args.date?.trim() || clock.date;
    checkDate(date, clock.date, modes);
    const notes: string[] = [];
    const trains = await dayTrains(date, modes, [], notes, signal);
    const wanted = (train: RailTrain) => (train.mode === 'thsr' ? train.no === raw.padStart(4, '0') : train.no === raw.replace(/^0+(?=\d)/u, ''));
    const found = trains.filter(wanted);
    if (found.length === 0) {
      throw new Error(`No train ${raw} on ${date}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`);
    }
    const isToday = date === clock.date;
    const results = await Promise.all(found.map(async (train) => {
      const whole = formatLeg({ train, from: train.stops[0].node, to: train.stops.at(-1)?.node as RailNode, dep: train.stops[0].dep, arr: train.stops.at(-1)?.arr ?? 0 });
      const stops = train.stops.map((s) => ({ station: stationName(s.node), arrive: formatClock(s.arr), depart: formatClock(s.dep) }));
      if (!isToday || train.mode !== 'tra') return { ...whole, stops };
      const page = await data.traTrainLive(train.no, date, signal).catch((err: unknown) => ({ error: errorText(err) }));
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
      official_links: officialLinks(found.map((t) => t.mode), { train: true }),
    };
  }

  return { planTrip, trainInfo, data };
}

export type RailService = ReturnType<typeof createRailService>;

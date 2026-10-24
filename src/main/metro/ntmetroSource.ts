/**
 * New Taipei Metro's three fare systems as `NetworkSource`s, plus the façade for its Circular-line
 * board and status banner. Fares are baked (`ntmetroFares.ts`); 淡海 / 安坑 departures and first /
 * last trains come from each station's official timetable file (`ntmetroTimetable.ts`, the version
 * in force on the asked date), with the live board's next train first when the rider asks about
 * now; 三鶯線 has a baked first/last-train table and published ride minutes but no live board.
 */
import type { LegQuote, MetroDeparture, MetroDeps, MetroStation, NetworkSource, QuoteWhen } from './metroTypes';
import { stationNode } from './metroTypes';
import { NTMETRO_FARE_PAGES, NTMETRO_TICKETS_PAGE, fareBetween, ntmetroTickets } from './ntmetroFares';
import { ANKENG_LINE, DANHAI_BLUE, DANHAI_GREEN, DANHAI_JUNCTION } from './ntmetroStations';
import { LRT_BOARD_PAGES, boardEntry, fetchLrtBoard, hhmm } from './ntmetroLive';
import type { LrtBoardEntry } from './ntmetroLive';
import type { LrtSchedule } from './ntmetroTimetable';
import { TERMINUS_ZH, lrtSchedule, timetablePage } from './ntmetroTimetable';
import { SANYING_HEADWAY, SANYING_RUNTIME_PAGE, SANYING_TIMETABLE_PAGE, sanyingDayType, sanyingFirstLast, sanyingMinutes } from './sanyingTimetable';
import { calendarKnown } from './taiwanCalendar';

export { circularDepartures } from './ntmetroLive';
export { ntmetroStatus } from './ntmetroStatus';
export { NTMETRO_STATIONS } from './ntmetroStations';
export { fareBetween } from './ntmetroFares';
export { timetablePage } from './ntmetroTimetable';

/** How to ride an LRT leg and which board entry answers "the next train". */
export interface LrtPlan {
  /** The line in travel direction, from end to end. */
  order: readonly string[];
  /** Only this routeId reaches the destination (淡海 trunk → a branch). */
  route?: number;
  inbound: boolean;
  /** Operator-style direction words (往崁頂). */
  ride: string;
  /** Change at 濱海沙崙 between the two 淡海 branches. */
  change?: string;
}

const DANHAI_ROUTES = [
  { codes: DANHAI_GREEN, id: 3, name: '綠山線', end: '崁頂' },
  { codes: DANHAI_BLUE, id: 4, name: '藍海線', end: '淡水漁人碼頭' },
] as const;

const ROUTE_END: Record<number, string> = { 3: '崁頂', 4: '淡水漁人碼頭' };

export function danhaiPlan(from: string, to: string): LrtPlan {
  const junction = DANHAI_GREEN.indexOf(DANHAI_JUNCTION);
  const has = (codes: readonly string[], code: string) => codes.includes(code);
  const both = DANHAI_ROUTES.find((r) => has(r.codes, from) && has(r.codes, to));
  if (!both) {
    const own = DANHAI_ROUTES.find((r) => has(r.codes, from)) ?? DANHAI_ROUTES[0];
    const other = DANHAI_ROUTES.find((r) => r !== own) ?? DANHAI_ROUTES[1];
    return { order: [...own.codes].reverse(), inbound: true, ride: `往紅樹林方向，於濱海沙崙轉乘${other.name}（往${other.end}）`, change: DANHAI_JUNCTION };
  }
  const codes: readonly string[] = both.codes;
  const outbound = codes.indexOf(to) > codes.indexOf(from);
  if (!outbound) return { order: [...codes].reverse(), inbound: true, ride: '往紅樹林' };
  if (codes.indexOf(to) > junction) return { order: codes, route: both.id, inbound: false, ride: `${both.name}（往${both.end}）` };
  return { order: codes, inbound: false, ride: '綠山線（往崁頂）或藍海線（往淡水漁人碼頭）' };
}

export function ankengPlan(from: string, to: string): LrtPlan {
  const line: readonly string[] = ANKENG_LINE;
  return line.indexOf(to) > line.indexOf(from)
    ? { order: ANKENG_LINE, inbound: false, ride: '往十四張' }
    : { order: [...ANKENG_LINE].reverse(), inbound: true, ride: '往雙城' };
}

/** The board's next train at the leg's start, if it serves the leg; `when` gives Taipei "now". */
export function lrtDeparture(entry: LrtBoardEntry | undefined, plan: LrtPlan, when: QuoteWhen, network: 'danhai' | 'ankeng'): MetroDeparture | null {
  if (!entry || entry.terminus || entry.seconds < 0) return null;
  if (plan.route !== undefined && entry.routeId !== plan.route) return null;
  const inMinutes = Math.round(entry.seconds / 60);
  const toward = network === 'ankeng'
    ? plan.order[plan.order.length - 1] === 'K09' ? '十四張' : '雙城'
    : plan.inbound ? '紅樹林' : ROUTE_END[entry.routeId ?? 0];
  return { time: hhmm(when.minutes + inMinutes), inMinutes, ...(toward ? { toward } : {}) };
}

function codeOf(station: MetroStation, network: string): string {
  if (station.network !== network) throw new Error(`${station.zh} is not a ${network} station`);
  return station.codes[0];
}

function fareNotes(network: string, from: string, to: string, fare: number | undefined): string[] {
  const notes: string[] = [];
  if (network === 'danhai' && [from, to].sort().join() === 'V01,V26') {
    notes.push("New Taipei Metro's fare text gives 紅樹林→淡水漁人碼頭 NT$30 but 淡水漁人碼頭→紅樹林 NT$25; the fare chart image on the same page shows NT$30 both ways.");
  }
  if (fare !== undefined && !Number.isInteger(fare / 2)) {
    notes.push('優待單程票 (65+, disability) is 50% of the posted fare; the page does not say how an odd half is rounded.');
  }
  return notes;
}

/** The termini (timetable direction codes) whose trains serve the leg's first ride. */
export function lrtTowards(network: 'danhai' | 'ankeng', plan: LrtPlan): string[] {
  if (network === 'ankeng') return [plan.inbound ? 'K01' : 'K09'];
  if (plan.inbound) return ['V01'];
  if (plan.route === undefined) return ['V11', 'V26'];
  return [plan.route === 3 ? 'V11' : 'V26'];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The live board's next train, or null with the reason in `notes`. */
async function liveNext(network: 'danhai' | 'ankeng', plan: LrtPlan, from: string, fromZh: string, toZh: string, when: QuoteWhen, deps: MetroDeps, notes: string[]): Promise<MetroDeparture | null> {
  try {
    const entry = boardEntry(await fetchLrtBoard(network, deps), plan.order, from);
    const next = lrtDeparture(entry, plan, when, network);
    if (!next && entry && plan.route !== undefined && entry.routeId !== null && entry.routeId !== plan.route && !entry.terminus && entry.seconds >= 0) {
      notes.push(`The live board's next train at ${fromZh} (in ${Math.round(entry.seconds / 60)} min) runs toward ${ROUTE_END[entry.routeId] ?? 'the other branch'}, not toward ${toZh}.`);
    }
    return next;
  } catch (err) {
    notes.push(`The live board did not answer (${message(err)}).`);
    return null;
  }
}

/** For a trip across the 淡海 branches: the other branch's first and last trains at 濱海沙崙. */
async function changeNote(to: string, when: QuoteWhen, deps: MetroDeps): Promise<string> {
  const end = (DANHAI_GREEN as readonly string[]).includes(to) ? 'V11' : 'V26';
  const endZh = TERMINUS_ZH[end];
  const base = `Change at 濱海沙崙 (${DANHAI_JUNCTION}) to a train toward ${endZh}: the two 淡海 branches meet there; the fare is one fare for the whole trip.`;
  try {
    const leg = await lrtSchedule('danhai', DANHAI_JUNCTION, '濱海沙崙', [end], { ...when, minutes: 12 * 60, isNow: false }, deps);
    return `${base} Trains toward ${endZh} leave 濱海沙崙 from ${leg.firstTrain} to ${leg.lastTrain} that day (the ride to 濱海沙崙 is not in the timetable).`;
  } catch {
    return base;
  }
}

async function lrtQuote(network: 'danhai' | 'ankeng', fromStation: MetroStation, toStation: MetroStation, when: QuoteWhen, deps: MetroDeps): Promise<LegQuote> {
  const from = codeOf(fromStation, network);
  const to = codeOf(toStation, network);
  if (from === to) throw new Error('Origin and destination are the same station');
  const plan = network === 'danhai' ? danhaiPlan(from, to) : ankengPlan(from, to);
  const fare = fareBetween(network, from, to);
  const notes = fareNotes(network, from, to, fare);
  const sources: string[] = [NTMETRO_FARE_PAGES[network], NTMETRO_TICKETS_PAGE];
  if (plan.change) notes.push(await changeNote(to, when, deps));
  let schedule: LrtSchedule | null = null;
  try {
    schedule = await lrtSchedule(network, from, fromStation.zh, lrtTowards(network, plan), when, deps);
    notes.push(...schedule.notes);
    sources.push(...schedule.sources);
  } catch (err) {
    const page = timetablePage(from);
    notes.push(`The official timetable could not be used (${message(err)})${page ? `; ${fromStation.zh}'s timetable page: ${page}` : ''}.`);
    if (page) sources.push(page);
  }
  let departures = schedule?.departures;
  if (when.isNow) {
    sources.push(LRT_BOARD_PAGES[network]);
    const live = await liveNext(network, plan, from, fromStation.zh, toStation.zh, when, deps, notes);
    if (live) {
      departures = [live, ...(departures ?? []).filter((d) => d.time > live.time)].slice(0, 5);
      notes.push(schedule
        ? 'The first departure (with inMinutes) is the live board; the others are the official timetable.'
        : 'The live board shows only the next train at each station.');
    }
  }
  return {
    network,
    from: stationNode(fromStation),
    to: stationNode(toStation),
    ...(fare !== undefined ? { fare, tickets: ntmetroTickets(network, fare) } : {}),
    route: plan.ride,
    ...(departures ? { departures } : {}),
    ...(schedule?.firstTrain ? { firstTrain: schedule.firstTrain } : {}),
    ...(schedule?.lastTrain ? { lastTrain: schedule.lastTrain } : {}),
    ...(notes.length ? { notes } : {}),
    sources,
  };
}

export const danhaiSource: NetworkSource = {
  network: 'danhai',
  quote: (from, to, when, deps) => lrtQuote('danhai', from, to, when, deps),
};

export const ankengSource: NetworkSource = {
  network: 'ankeng',
  quote: (from, to, when, deps) => lrtQuote('ankeng', from, to, when, deps),
};

function sanyingQuote(fromStation: MetroStation, toStation: MetroStation, when: QuoteWhen): LegQuote {
  const from = codeOf(fromStation, 'sanying');
  const to = codeOf(toStation, 'sanying');
  if (from === to) throw new Error('Origin and destination are the same station');
  const fare = fareBetween('sanying', from, to);
  const dayType = sanyingDayType(when.date);
  const firstLast = sanyingFirstLast(from, to, dayType);
  const notes = [
    'No live arrivals are published for 三鶯線; first/last trains and ride minutes are the official timetable.',
    dayType === 'weekday'
      ? `Weekday headway: about ${SANYING_HEADWAY.peakMinutes} min at peaks (${SANYING_HEADWAY.peak.join(', ')}), about ${SANYING_HEADWAY.offPeakMinutes} min otherwise; service ${SANYING_HEADWAY.service}.`
      : `Weekend/holiday headway: about ${SANYING_HEADWAY.offPeakMinutes} min all day; service ${SANYING_HEADWAY.service}.`,
    `Read as ${dayType === 'weekday' ? 'a weekday (平常日)' : 'a day off (例假日: weekend or national holiday)'} by the official office calendar.`,
    ...(calendarKnown(when.date) ? [] : [`National holidays of ${when.date.slice(0, 4)} are not known here: ${when.date} is read by the day of the week.`]),
    ...fareNotes('sanying', from, to, fare),
  ];
  if (firstLast?.lastToBannan) {
    notes.push(`Last train from ${fromStation.zh} that still connects to Taipei Metro's 板南線 at 頂埔: ${firstLast.lastToBannan}.`);
  }
  return {
    network: 'sanying',
    from: stationNode(fromStation),
    to: stationNode(toStation),
    ...(fare !== undefined ? { fare, tickets: ntmetroTickets('sanying', fare) } : {}),
    minutes: sanyingMinutes(from, to),
    route: firstLast?.toward === 'LB01' ? '往頂埔' : '往鶯桃福德',
    ...(firstLast ? { firstTrain: firstLast.first, lastTrain: firstLast.last } : {}),
    notes,
    sources: [NTMETRO_FARE_PAGES.sanying, NTMETRO_TICKETS_PAGE, SANYING_TIMETABLE_PAGE, SANYING_RUNTIME_PAGE],
  };
}

export const sanyingSource: NetworkSource = {
  network: 'sanying',
  quote: async (from, to, when) => sanyingQuote(from, to, when),
};

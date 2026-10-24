/**
 * 淡海 / 安坑 departures, first and last trains from the official station timetables
 * (`ntmetroTimetableFetch.ts` picks the file in force, `ntmetroTimetableParse.ts` reads it).
 *
 * Which 淡海 branch a train runs to matters only on the shared track (V01–V09), and there the
 * files are not always right (read 2026-10-22): the new V05 file signs 148 of 151 weekday trains
 * 往崁頂, V06's 假日 table (old and new) lists every minute under both branches, V01's new 假日 table
 * has 66 / 66 where 濱海沙崙 and the branch stations count 68 往崁頂 and 64 往淡水漁人碼頭. So a trunk
 * station's labels are used only when their counts match the branches' own stations (淡海新市鎮
 * for 崁頂, 沙崙 for 淡水漁人碼頭). Otherwise, when the station lists exactly as many trains as
 * 濱海沙崙 at a steady lead, each train takes the branch of the train in the same place at 濱海沙崙
 * (one track, no overtaking); failing that the branch is not given, and a trip to one branch from
 * that station gets no timetable rather than a wrong one.
 */
import type { MetroDeparture, MetroDeps, QuoteWhen } from './metroTypes';
import { addDays } from '../rail/railTime';
import { hhmm } from './ntmetroLive';
import { DANHAI_GREEN, DANHAI_JUNCTION } from './ntmetroStations';
import type { ChosenTimetable } from './ntmetroTimetableFetch';
import { stationTimetable } from './ntmetroTimetableFetch';
import type { DayKind, DirectionTimes } from './ntmetroTimetableParse';
import { TERMINUS_ZH } from './ntmetroTimetableParse';
import { calendarKnown, isOffDay } from './taiwanCalendar';

export { TIMETABLE_STATIONS, stationTimetable, timetablePage } from './ntmetroTimetableFetch';
export { TERMINUS_ZH } from './ntmetroTimetableParse';

/** Before this, an asked time also looks at the previous service day's trains after midnight. */
const EARLY_MINUTES = 4 * 60;
const MAX_DEPARTURES = 5;
/** A trunk station's train k leaves this many minutes before 濱海沙崙's train k, give or take `LEAD_SPREAD`. */
const MAX_LEAD = 45;
const LEAD_SPREAD = 8;

const BRANCH_ENDS = ['V11', 'V26'] as const;
const TRUNK: readonly string[] = DANHAI_GREEN.slice(0, DANHAI_GREEN.indexOf(DANHAI_JUNCTION) + 1);

export interface Train {
  /** Minutes after the service day's midnight. */
  minute: number;
  /** Terminus code; null when the branch is not known. */
  toward: string | null;
}

type Labels = 'file' | 'derived' | 'none';

export function dayKindOf(date: string): DayKind {
  return isOffDay(date) ? 'offday' : 'weekday';
}

export function trainsToward(times: DirectionTimes, towards: readonly string[]): Train[] {
  return towards.flatMap((toward) => (times[toward] ?? []).map((minute) => ({ minute, toward })))
    .sort((a, b) => a.minute - b.minute);
}

function sameCounts(times: DirectionTimes, reference: Readonly<Record<string, number>>): boolean {
  return BRANCH_ENDS.every((end) => (times[end]?.length ?? 0) === reference[end]);
}

/** Another trunk station's outbound table whose branch labels may be borrowed. */
export interface TrunkReference {
  zh: string;
  times: DirectionTimes;
}

export interface LabelledTrains {
  trains: Train[];
  labels: Labels;
  /** The station whose train order gave the branches, when `labels` is 'derived'. */
  via?: string;
}

function borrowLabels(minutes: readonly number[], reference: TrunkReference, counts: Readonly<Record<string, number>>): Train[] | null {
  if (!sameCounts(reference.times, counts)) return null;
  const theirs = trainsToward(reference.times, BRANCH_ENDS);
  if (theirs.length !== minutes.length) return null;
  const leads = minutes.map((minute, k) => theirs[k].minute - minute);
  const [low, high] = [Math.min(...leads), Math.max(...leads)];
  const steady = (low >= 0 || high <= 0) && Math.max(-low, high) <= MAX_LEAD && high - low <= LEAD_SPREAD;
  return steady ? minutes.map((minute, k) => ({ minute, toward: theirs[k].toward })) : null;
}

/**
 * A trunk station's outbound trains with their branch (see the header). `counts` is how many
 * trains each branch's own station lists; `references` (濱海沙崙, then 紅樹林) lend their labels
 * when they agree with `counts` and run in step with this station.
 */
export function labelTrunkTrains(times: DirectionTimes, references: readonly TrunkReference[], counts: Readonly<Record<string, number>>): LabelledTrains {
  const listed = trainsToward(times, BRANCH_ENDS);
  if (sameCounts(times, counts)) return { trains: listed, labels: 'file' };
  const minutes = [...new Set(listed.map((t) => t.minute))].sort((a, b) => a - b);
  for (const reference of references) {
    const trains = borrowLabels(minutes, reference, counts);
    if (trains) return { trains, labels: 'derived', via: reference.zh };
  }
  return { trains: minutes.map((minute) => ({ minute, toward: null })), labels: 'none' };
}

interface DayTrains extends LabelledTrains {
  chosen: ChosenTimetable;
}

async function dayTrains(network: 'danhai' | 'ankeng', from: string, towards: readonly string[], date: string, deps: MetroDeps): Promise<DayTrains> {
  const chosen = await stationTimetable(from, date, deps);
  const day = dayKindOf(date);
  const outbound = network === 'danhai' && TRUNK.includes(from) && towards.every((t) => t === 'V11' || t === 'V26');
  if (!outbound) return { trains: trainsToward(chosen.table[day], towards), chosen, labels: 'file' };
  const [junction, origin, green, blue] = await Promise.all(['V09', 'V01', 'V10', 'V27'].map((code) => stationTimetable(code, date, deps)));
  const counts = { V11: green.table[day].V11?.length ?? 0, V26: blue.table[day].V26?.length ?? 0 };
  const references = [{ zh: '濱海沙崙', times: junction.table[day] }, { zh: '紅樹林', times: origin.table[day] }];
  const labelled = labelTrunkTrains(chosen.table[day], references, counts);
  if (towards.length === BRANCH_ENDS.length) return { ...labelled, chosen };
  if (labelled.labels === 'none') {
    throw new Error(`The official timetable of ${from} does not say reliably which trains run toward ${TERMINUS_ZH[towards[0]]}`);
  }
  const wanted = new Set<string>(towards);
  return { ...labelled, trains: labelled.trains.filter((t) => t.toward !== null && wanted.has(t.toward)), chosen };
}

export interface LrtSchedule {
  departures: MetroDeparture[];
  firstTrain?: string;
  lastTrain?: string;
  notes: string[];
  sources: string[];
}

function departure(train: Train, shift = 0): MetroDeparture {
  return { time: hhmm(train.minute - shift), ...(train.toward ? { toward: TERMINUS_ZH[train.toward] } : {}) };
}

function scheduleNotes(fromZh: string, date: string, today: DayTrains): string[] {
  const day = dayKindOf(date);
  const { chosen } = today;
  const notes = [`Departures and first/last trains are ${fromZh}'s official timetable (${day === 'offday' ? '週六、週日及國定假日' : '平常日'} table); trains may run a few minutes off it.`];
  if (chosen.switchOn && chosen.version === 'old') {
    notes.push(`This is the timetable in force until ${addDays(chosen.switchOn, -1)}; a new timetable starts on ${chosen.switchOn}.`);
  } else if (chosen.switchOn) {
    notes.push(`This is the new timetable, in force from ${chosen.switchOn}.`);
  }
  if (today.labels === 'derived') {
    notes.push(`${fromZh}'s timetable file signs trains for branches that do not add up to the branch stations' own counts; each train's branch here is that of the train in the same order at ${today.via}.`);
  } else if (today.labels === 'none') {
    notes.push(`${fromZh}'s timetable file does not say reliably which branch each train runs to; the times are right for any stop up to 濱海沙崙.`);
  }
  if (!calendarKnown(date)) notes.push(`National holidays of ${date.slice(0, 4)} are not known here: ${date} is read by the day of the week.`);
  return notes;
}

/**
 * The timetable's answer for a leg from `from` on trains toward any of `towards` (terminus codes:
 * V11, V26, V01, K01, K09), at or after `when`. An early-morning time also gets the previous
 * service day's trains after midnight. Throws when the timetable cannot be read.
 */
export async function lrtSchedule(network: 'danhai' | 'ankeng', from: string, fromZh: string, towards: readonly string[], when: QuoteWhen, deps: MetroDeps): Promise<LrtSchedule> {
  const today = await dayTrains(network, from, towards, when.date, deps);
  let upcoming = today.trains.filter((t) => t.minute >= when.minutes).map((t) => departure(t));
  if (when.minutes < EARLY_MINUTES) {
    const before = await dayTrains(network, from, towards, addDays(when.date, -1), deps);
    const tail = before.trains.filter((t) => t.minute - 1_440 >= when.minutes).map((t) => departure(t, 1_440));
    upcoming = [...tail, ...upcoming];
  }
  const first = today.trains[0];
  const last = today.trains[today.trains.length - 1];
  return {
    departures: upcoming.slice(0, MAX_DEPARTURES),
    ...(first ? { firstTrain: hhmm(first.minute) } : {}),
    ...(last ? { lastTrain: hhmm(last.minute) } : {}),
    notes: scheduleNotes(fromZh, when.date, today),
    sources: [today.chosen.page, today.chosen.file],
  };
}

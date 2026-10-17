/**
 * Journey planning over one service day's THSR + TRA trains: a direct ride, or one change — at
 * the same station, or between THSR and TRA at a linked pair (Zuoying ↔ Xinzuoying …). Computed here, not
 * by the model: comparing hundreds of calling times by reading them is where answers go wrong.
 */
import { TRANSFER_LINKS } from './stations';
import { nodeMode } from './railTypes';
import type { Journey, Leg, RailNode, RailTrain, TimeIs, TripSort } from './railTypes';

export const SAME_STATION_TRANSFER_MIN = 4;
export const MAX_TRANSFER_WAIT_MIN = 90;
export const SEARCH_WINDOW_MIN = 6 * 60;

export interface JourneyQuery {
  from: readonly RailNode[];
  to: readonly RailNode[];
  /** Minutes after 00:00 of the service day. */
  time: number;
  timeIs: TimeIs;
  sort: TripSort;
  limit: number;
}

interface Departure {
  train: RailTrain;
  index: number;
  dep: number;
}

/** Where a rider standing at `node` can board, with the least time the change takes. */
function changeOptions(node: RailNode): { node: RailNode; minutes: number }[] {
  const options = [{ node, minutes: SAME_STATION_TRANSFER_MIN }];
  for (const link of TRANSFER_LINKS) {
    if (link.thsr === node) options.push({ node: link.tra, minutes: link.minutes });
    if (link.tra === node) options.push({ node: link.thsr, minutes: link.minutes });
  }
  return options;
}

function indexDepartures(trains: readonly RailTrain[]): Map<RailNode, Departure[]> {
  const byNode = new Map<RailNode, Departure[]>();
  for (const train of trains) {
    train.stops.forEach((stop, index) => {
      if (index === train.stops.length - 1) return;
      const list = byNode.get(stop.node) ?? [];
      list.push({ train, index, dep: stop.dep });
      byNode.set(stop.node, list);
    });
  }
  for (const list of byNode.values()) list.sort((a, b) => a.dep - b.dep);
  return byNode;
}

/** The earliest-arriving stop of `train` after `index` that is a destination. */
function bestArrival(train: RailTrain, index: number, to: ReadonlySet<RailNode>): { index: number; arr: number } | null {
  let best: { index: number; arr: number } | null = null;
  for (let i = index + 1; i < train.stops.length; i++) {
    const stop = train.stops[i];
    if (to.has(stop.node) && (!best || stop.arr < best.arr)) best = { index: i, arr: stop.arr };
  }
  return best;
}

function leg(train: RailTrain, from: number, to: number): Leg {
  return { train, from: train.stops[from].node, to: train.stops[to].node, dep: train.stops[from].dep, arr: train.stops[to].arr };
}

function journey(legs: Leg[]): Journey {
  return { legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, transfers: legs.length - 1 };
}

function dominates(a: Journey, b: Journey): boolean {
  const noWorse = a.dep >= b.dep && a.arr <= b.arr && a.transfers <= b.transfers;
  const better = a.dep > b.dep || a.arr < b.arr || a.transfers < b.transfers;
  return noWorse && better;
}

function compare(sort: TripSort, timeIs: TimeIs): (a: Journey, b: Journey) => number {
  const duration = (j: Journey) => j.arr - j.dep;
  if (sort === 'shortest') return (a, b) => duration(a) - duration(b) || a.arr - b.arr || a.transfers - b.transfers;
  if (sort === 'earliest_departure') return (a, b) => a.dep - b.dep || a.arr - b.arr;
  // Arriving by a time, the best plan is the one that leaves last.
  if (timeIs === 'arrive') return (a, b) => b.dep - a.dep || a.arr - b.arr || a.transfers - b.transfers;
  return (a, b) => a.arr - b.arr || b.dep - a.dep || a.transfers - b.transfers;
}

function inWindow(j: Journey, q: JourneyQuery): boolean {
  if (q.timeIs === 'arrive') return j.arr <= q.time && j.arr >= q.time - SEARCH_WINDOW_MIN;
  return j.dep >= q.time && j.dep <= q.time + SEARCH_WINDOW_MIN;
}

export function planJourneys(trains: readonly RailTrain[], q: JourneyQuery): Journey[] {
  const from = new Set(q.from);
  const to = new Set(q.to);
  const departures = indexDepartures(trains);
  const candidates: Journey[] = [];

  for (const origin of from) {
    for (const first of departures.get(origin) ?? []) {
      const direct = bestArrival(first.train, first.index, to);
      if (direct) candidates.push(journey([leg(first.train, first.index, direct.index)]));
      // Change trains at any later stop of the first train.
      for (let k = first.index + 1; k < first.train.stops.length; k++) {
        const reached = first.train.stops[k];
        if (to.has(reached.node)) break;
        for (const option of changeOptions(reached.node)) {
          const earliest = reached.arr + option.minutes;
          for (const next of departures.get(option.node) ?? []) {
            if (next.dep < earliest) continue;
            if (next.dep > reached.arr + MAX_TRANSFER_WAIT_MIN) break;
            if (next.train === first.train) continue;
            const end = bestArrival(next.train, next.index, to);
            if (!end) continue;
            // A change only belongs in the answer if it beats staying on the first train.
            if (direct && end.arr >= direct.arr) continue;
            candidates.push(journey([leg(first.train, first.index, k), leg(next.train, next.index, end.index)]));
          }
        }
      }
    }
  }

  const windowed = candidates.filter((j) => inWindow(j, q));
  // One plan per first train boarded: its best continuation.
  const byFirst = new Map<string, Journey>();
  for (const j of windowed) {
    const key = `${j.legs[0].train.mode}:${j.legs[0].train.no}@${j.legs[0].from}`;
    const held = byFirst.get(key);
    if (!held || j.arr < held.arr || (j.arr === held.arr && j.transfers < held.transfers)) byFirst.set(key, j);
  }
  let plans = [...byFirst.values()];
  // "Next train" means the next one even when a later one arrives first; otherwise drop plans
  // another beats on every count (leaves later, arrives earlier, no more changes) — but only
  // against plans on the same operators: TRA all the way is slower than THSR and far cheaper,
  // and "THSR or TRA?" is exactly the comparison the rider asked for.
  if (q.sort !== 'earliest_departure') {
    plans = plans.filter((j) => !plans.some((other) => other !== j && journeyModes(other) === journeyModes(j) && dominates(other, j)));
  }
  const sorted = plans.sort(compare(q.sort, q.timeIs));
  const picked = sorted.slice(0, Math.max(1, q.limit));
  // Each operator mix keeps its best plan in the answer, even past the limit.
  for (const j of sorted) {
    if (!picked.some((p) => journeyModes(p) === journeyModes(j))) picked.push(j);
  }
  return picked;
}

/** The operators a journey rides, in order: "thsr", "tra", "tra>thsr" … */
export function journeyModes(j: Journey): string {
  return [...new Set(j.legs.map((l) => nodeMode(l.from)))].join('>');
}

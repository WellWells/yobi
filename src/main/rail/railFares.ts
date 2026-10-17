/**
 * What a rider pays. THSR prices each leg. TRA sells one ticket per trip, and a ticket for one class
 * also rides every lower class, so a TRA-only plan is priced once — first station to last, at the
 * dearest class ridden — never as its legs added up (a Local leg then a Tze-Chiang leg is one
 * Tze-Chiang ticket). A TRA leg in a plan that also rides THSR is a ticket of its own. A direct TRA
 * plan also gets its train's own fare, business-car and non-reserved fares and discounts from TRA's
 * timetable page.
 */
import type { Cached } from './railCache';
import { nodeMode } from './railTypes';
import type { Journey, Leg, RailNode } from './railTypes';
import type { TraFare, TraFares } from './traFareSource';
import type { TraTrainOffers } from './traTrainOfferSource';

/** Station pairs priced per operator in one answer; each is a request to the operator's own site. */
export const MAX_PRICED_PAIRS = 4;

interface Pair {
  from: RailNode;
  to: RailNode;
}

export function pairKey(pair: Pair): string {
  return `${pair.from}>${pair.to}`;
}

/** One lookup per station pair, for the first `cap`; a failed one leaves its pair unpriced. */
export async function byPair<T>(pairs: readonly Pair[], load: (from: RailNode, to: RailNode) => Promise<Cached<T>>, cap = MAX_PRICED_PAIRS): Promise<Map<string, T>> {
  const unique = [...new Map(pairs.map((pair) => [pairKey(pair), pair])).values()].slice(0, cap);
  const found = new Map<string, T>();
  await Promise.all(unique.map(async (pair) => {
    const result = await load(pair.from, pair.to).catch(() => null);
    if (result) found.set(pairKey(pair), result.value);
  }));
  return found;
}

export interface TraTicket extends Pair {
  /** The class the ticket is bought for, as TRA names it. */
  type: string;
  fare: TraFare;
  km: number;
  /** Direct trains only: the EMU3000 business car, the train's non-reserved seats, and the discounts TRA sells on it. */
  business?: TraFare;
  unreserved?: TraFare;
  discounts?: string[];
}

export interface TraLoaders {
  fares: (from: RailNode, to: RailNode) => Promise<Cached<TraFares>>;
  offers: (from: RailNode, to: RailNode, unreserved: boolean) => Promise<Cached<TraTrainOffers>>;
}

/** Pairs whose direct trains are read from TRA's timetable page per answer; each is 2–3 requests. */
export const MAX_OFFER_PAIRS = 2;

/** The only class with a business car and non-reserved seats. */
const PREMIUM_CLASS = '自強3000';

export interface TraPricing {
  tickets: Map<Journey, TraTicket>;
  /** TRA legs of plans that also ride THSR. */
  legs: Map<Leg, TraFare & { km: number }>;
  /** Every class between the stations asked and the TRA-only plans' ends: what "how much is the train" asks. */
  tables: (Pair & { fares: TraFares })[];
}

export function isTraOnly(journey: Journey): boolean {
  return journey.legs.every((leg) => nodeMode(leg.from) === 'tra');
}

function ends(journey: Journey): Pair {
  return { from: journey.legs[0].from, to: (journey.legs.at(-1) as Leg).to };
}

/**
 * `asked` is the pair of TRA stations named in the question. Plans may end at a neighbour instead
 * (expresses stop at Xinzuoying, not at the Zuoying station a rider may name), so its fares are
 * listed too whenever TRA is part of the answer.
 */
export async function priceTra(journeys: readonly Journey[], loaders: TraLoaders, asked?: Pair): Promise<TraPricing> {
  const traOnly = journeys.filter(isTraOnly);
  const direct = traOnly.filter((j) => j.legs.length === 1);
  const mixedLegs = journeys.filter((j) => !isTraOnly(j)).flatMap((j) => j.legs.filter((leg) => nodeMode(leg.from) === 'tra'));
  const tablePairs = traOnly.length > 0 ? [...(asked ? [asked] : []), ...traOnly.map(ends)] : [];
  const premium = new Set(direct.filter((j) => j.legs[0].train.type === PREMIUM_CLASS).map((j) => pairKey(ends(j))));
  // Whole trips first, so the cap never costs the fare the question is about.
  const [found, offers] = await Promise.all([
    byPair<TraFares>([...tablePairs, ...mixedLegs], loaders.fares),
    byPair<TraTrainOffers>(direct.map(ends), (from, to) => loaders.offers(from, to, premium.has(pairKey({ from, to }))), MAX_OFFER_PAIRS),
  ]);

  const tickets = new Map<Journey, TraTicket>();
  for (const journey of traOnly) {
    const pair = ends(journey);
    const table = found.get(pairKey(pair));
    if (!table) continue;
    const priced = journey.legs
      .map((leg) => ({ type: leg.train.type, fare: table.byType[leg.train.type] }))
      .filter((p): p is { type: string; fare: TraFare } => p.fare !== undefined);
    if (priced.length === 0) continue;
    const top = priced.reduce((best, p) => (p.fare.adult > best.fare.adult ? p : best));
    const ticket: TraTicket = { ...pair, type: top.type, fare: top.fare, km: table.km };
    if (journey.legs.length === 1) {
      // The train's own fare wins: the fare page prices the shortest route, not the one it runs.
      const offer = offers.get(pairKey(pair))?.[journey.legs[0].train.no];
      if (offer?.fare) ticket.fare = offer.fare;
      if (offer?.unreserved) ticket.unreserved = offer.unreserved;
      if (offer?.discounts.length) ticket.discounts = offer.discounts;
      if (top.type === PREMIUM_CLASS && table.business) ticket.business = table.business;
    }
    tickets.set(journey, ticket);
  }

  const legs = new Map<Leg, TraFare & { km: number }>();
  for (const leg of mixedLegs) {
    const table = found.get(pairKey(leg));
    const fare = table?.byType[leg.train.type];
    if (table && fare) legs.set(leg, { ...fare, km: table.km });
  }

  const tables = [...new Map(tablePairs.map((pair) => [pairKey(pair), pair])).values()]
    .flatMap((pair) => {
      const fares = found.get(pairKey(pair));
      return fares ? [{ ...pair, fares }] : [];
    });
  return { tickets, legs, tables };
}

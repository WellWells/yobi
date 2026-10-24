/**
 * Trips across networks, worked out in code: the model only reads the result (the rail connector
 * learnt this when a model added two TRA legs into a fare that does not exist). A trip is a chain
 * of legs, one per network, joined at the transfer stations in `metroNetworks.ts`; each leg is
 * quoted by its own operator, and the fares add up — less New Taipei's card discount where it
 * applies. Every way through is quoted and the quickest few are kept.
 */
import { NETWORK_INFO, NTMETRO_TRANSFER_DISCOUNT_NTD, TRANSFER_ALLOWANCE_MIN } from './metroNetworks';
import type { TransferLink } from './metroNetworks';
import { stationNode } from './metroTypes';
import type { LegQuote, MetroDeps, MetroNetwork, MetroStation, NetworkSource, QuoteWhen } from './metroTypes';

export interface PlanDeps extends MetroDeps {
  sources: Readonly<Record<MetroNetwork, NetworkSource>>;
  transfers: readonly TransferLink[];
  stationByCode: (network: MetroNetwork, code: string) => MetroStation | undefined;
}

interface LegPlan {
  network: MetroNetwork;
  from: MetroStation;
  to: MetroStation;
}

export interface PlannedLeg extends LegPlan {
  quote?: LegQuote;
  error?: string;
}

export interface PlannedOption {
  legs: PlannedLeg[];
  /** Transfers that get New Taipei's card discount. */
  discounted: number;
  /** What a full-fare stored-value card pays for the whole trip, discount taken off. */
  cardFare?: number;
  /** The same trip on single-journey tickets (no transfer discount). */
  ticketFare?: number;
  ridingMin?: number;
  /** Riding plus `TRANSFER_ALLOWANCE_MIN` per change. */
  estimatedMin?: number;
}

const MAX_NETWORKS_PER_TRIP = 3;
const MAX_PLANS = 8;
export const MAX_OPTIONS = 3;

/** The network chains from one network to another, shortest first, at most three networks long. */
function networkPaths(from: MetroNetwork, to: MetroNetwork, links: readonly TransferLink[]): MetroNetwork[][] {
  const paths: MetroNetwork[][] = [];
  const walk = (path: MetroNetwork[]): void => {
    const last = path[path.length - 1];
    if (last === to) {
      paths.push(path);
      return;
    }
    if (path.length >= MAX_NETWORKS_PER_TRIP) return;
    const next = new Set(links.flatMap((link) => {
      if (link.a.network === last) return [link.b.network];
      if (link.b.network === last) return [link.a.network];
      return [];
    }));
    for (const network of next) if (!path.includes(network)) walk([...path, network]);
  };
  walk([from]);
  return paths.sort((a, b) => a.length - b.length);
}

/** The links between two networks, each oriented from `from` to `to`. */
function linksBetween(from: MetroNetwork, to: MetroNetwork, deps: PlanDeps): { out: MetroStation; in: MetroStation }[] {
  return deps.transfers.flatMap((link) => {
    const [x, y] = link.a.network === from && link.b.network === to ? [link.a, link.b]
      : link.b.network === from && link.a.network === to ? [link.b, link.a] : [undefined, undefined];
    const out = x && deps.stationByCode(x.network, x.code);
    const into = y && deps.stationByCode(y.network, y.code);
    return out && into ? [{ out, in: into }] : [];
  });
}

/** Every chain of legs from `start` to `end`, legs that go nowhere dropped, duplicates removed. */
export function legPlans(start: MetroStation, end: MetroStation, deps: PlanDeps): LegPlan[][] {
  const plans: LegPlan[][] = [];
  const seen = new Set<string>();
  for (const path of networkPaths(start.network, end.network, deps.transfers)) {
    let partial: { legs: LegPlan[]; at: MetroStation }[] = [{ legs: [], at: start }];
    for (let i = 1; i < path.length; i++) {
      const choices = linksBetween(path[i - 1], path[i], deps);
      partial = partial.flatMap(({ legs, at }) => choices.map((link) => ({
        legs: [...legs, { network: path[i - 1], from: at, to: link.out }],
        at: link.in,
      })));
    }
    for (const { legs, at } of partial) {
      const all = [...legs, { network: end.network, from: at, to: end }].filter((leg) => leg.from !== leg.to);
      if (all.length === 0) continue;
      const key = all.map((leg) => `${stationNode(leg.from)}>${stationNode(leg.to)}`).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      plans.push(all);
    }
  }
  return plans;
}

function isAt(station: MetroStation, side: TransferLink['a']): boolean {
  return station.network === side.network && station.codes.includes(side.code);
}

/** The changes in `legs` that New Taipei's card discount covers. */
function discountedTransfers(legs: readonly LegPlan[], links: readonly TransferLink[]): number {
  let count = 0;
  for (let i = 1; i < legs.length; i++) {
    const out = legs[i - 1].to;
    const into = legs[i].from;
    const link = links.find((l) => (isAt(out, l.a) && isAt(into, l.b)) || (isAt(out, l.b) && isAt(into, l.a)));
    if (link?.cardDiscount) count++;
  }
  return count;
}

function sum(values: readonly (number | undefined)[]): number | undefined {
  return values.every((value): value is number => typeof value === 'number') ? values.reduce((a, b) => a + b, 0) : undefined;
}

/** Quotes one chain leg by leg; a later leg is asked about the time the rider reaches it. */
async function quotePlan(plan: readonly LegPlan[], when: QuoteWhen, deps: PlanDeps): Promise<PlannedOption> {
  const legs: PlannedLeg[] = [];
  let at: QuoteWhen = when;
  for (const leg of plan) {
    try {
      const quote = await deps.sources[leg.network].quote(leg.from, leg.to, at, deps);
      legs.push({ ...leg, quote });
      const ride = quote.minutes ?? 0;
      at = { date: at.date, minutes: at.minutes + ride + TRANSFER_ALLOWANCE_MIN, isNow: false };
    } catch (err) {
      legs.push({ ...leg, error: err instanceof Error ? err.message : String(err) });
      at = { ...at, isNow: false };
    }
  }
  const discounted = discountedTransfers(plan, deps.transfers);
  const fares = legs.map((leg) => leg.quote?.fare);
  const card = sum(fares);
  const ticket = sum(legs.map((leg) => leg.quote?.singleTicket ?? leg.quote?.fare));
  const riding = sum(legs.map((leg) => leg.quote?.minutes));
  return {
    legs,
    discounted,
    ...(card !== undefined ? { cardFare: card - discounted * NTMETRO_TRANSFER_DISCOUNT_NTD } : {}),
    ...(ticket !== undefined ? { ticketFare: ticket } : {}),
    ...(riding !== undefined ? { ridingMin: riding, estimatedMin: riding + (legs.length - 1) * TRANSFER_ALLOWANCE_MIN } : {}),
  };
}

function byQuickest(a: PlannedOption, b: PlannedOption): number {
  const failed = (o: PlannedOption): number => o.legs.filter((leg) => leg.error).length;
  return failed(a) - failed(b)
    || (a.estimatedMin ?? Infinity) - (b.estimatedMin ?? Infinity)
    || a.legs.length - b.legs.length
    || (a.cardFare ?? Infinity) - (b.cardFare ?? Infinity);
}

/**
 * The quickest ways from any of `starts` to any of `ends` in the same city. Throws when the two
 * places are in different cities, are the same station, or no operator could answer.
 */
export async function planMetroTrip(
  starts: readonly MetroStation[],
  ends: readonly MetroStation[],
  when: QuoteWhen,
  deps: PlanDeps,
): Promise<PlannedOption[]> {
  const pairs = starts.flatMap((start) => ends.map((end) => [start, end] as const))
    .filter(([start, end]) => NETWORK_INFO[start.network].region === NETWORK_INFO[end.network].region);
  if (pairs.length === 0) {
    throw new Error('The two stations are on metro systems in different cities; no metro trip joins them (use rail_trip for THSR/TRA between cities).');
  }
  if (pairs.every(([start, end]) => start === end || start.zh === end.zh)) throw new Error('The start and the destination are the same station.');
  // One name can be two stations (台北車站 is Taipei Metro's and the airport line's), and both
  // readings can reach the same chain of legs once a leg that goes nowhere is dropped: keep one.
  const seen = new Set<string>();
  const plans = pairs.flatMap(([start, end]) => (start.zh === end.zh ? [] : legPlans(start, end, deps)))
    .filter((plan) => {
      const key = plan.map((leg) => `${stationNode(leg.from)}>${stationNode(leg.to)}`).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_PLANS);
  if (plans.length === 0) throw new Error('No metro route joins these two stations.');
  const options = await Promise.all(plans.map((plan) => quotePlan(plan, when, deps)));
  if (options.every((option) => option.legs.every((leg) => leg.error))) {
    const first = options[0].legs.find((leg) => leg.error)?.error ?? 'unknown error';
    throw new Error(`The operators' sites did not answer: ${first}`);
  }
  return options.sort(byQuickest).slice(0, MAX_OPTIONS);
}

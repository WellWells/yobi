/**
 * The shapes the model reads. Keys are English, values keep the operators' own station and train
 * names (that is what the rider sees on the platform), times are Taipei clock times with "(+1)"
 * past midnight, and every answer carries the operators' own query pages to point the rider to.
 */
import { formatClock, formatDuration } from './railTime';
import { stationName } from './stations';
import { nodeMode } from './railTypes';
import type { Journey, Leg, RailMode, RailNode } from './railTypes';
import type { SeatInfo, TraDelay } from './tdxSources';
import type { ThsrFares } from './thsrWebSource';
import { TRA_FARE_PAGE } from './traFareSource';
import type { TraFare, TraFares } from './traFareSource';
import type { TraTicket } from './railFares';
import { THSR_SEARCH_PAGE } from './thsrWebSource';
import { TRA_TIME_PAGE, TRA_TRAIN_PAGE } from './traWebSource';

export const OPERATOR_LABEL: Readonly<Record<RailMode, string>> = { thsr: '高鐵 THSR', tra: '台鐵 TRA' };

export function officialLinks(modes: Iterable<RailMode>, opts: { train?: boolean; traFares?: boolean } = {}): Record<string, string> {
  const set = new Set(modes);
  return {
    ...(set.has('thsr') ? { thsr_timetable: THSR_SEARCH_PAGE } : {}),
    ...(set.has('tra') ? { tra_timetable: TRA_TIME_PAGE } : {}),
    ...(set.has('tra') && opts.train ? { tra_train_status: TRA_TRAIN_PAGE } : {}),
    ...(set.has('tra') && opts.traFares ? { tra_fares: TRA_FARE_PAGE } : {}),
  };
}

export interface LegLive {
  delay?: TraDelay;
  seats?: SeatInfo;
  /** THSR's adult fares for this leg's two stations. */
  fares?: ThsrFares;
  /** THSR's discounts on this train (early-bird, as THSR words them). */
  discounts?: string[];
  /** In a plan that also rides THSR: TRA's fare for this leg as a ticket of its own, and its distance. */
  traFare?: TraFare & { km: number };
}

export function formatLeg(leg: Leg, live: LegLive = {}): Record<string, unknown> {
  const mode = nodeMode(leg.from);
  return {
    operator: OPERATOR_LABEL[mode],
    train: leg.train.no,
    type: leg.train.type,
    from: stationName(leg.from),
    depart: formatClock(leg.dep),
    to: stationName(leg.to),
    arrive: formatClock(leg.arr),
    ...(leg.train.note ? { note: leg.train.note } : {}),
    ...(live.delay ? { delay_minutes: live.delay.minutes, delay_reported_at: `${live.delay.station} ${live.delay.at.slice(11, 16)}` } : {}),
    ...(live.seats ? { seats: live.seats } : {}),
    ...(live.fares ? { fare_ntd: { standard: live.fares.standard[0], business: live.fares.business[0], unreserved: live.fares.unreserved[0] } } : {}),
    ...(live.discounts?.length ? { discounts: live.discounts } : {}),
    ...(live.traFare ? { fare_ntd: { adult: live.traFare.adult, child_senior_disabled: live.traFare.half }, distance_km: live.traFare.km } : {}),
  };
}

/** TRA's fare for every class between two stations, classes with the same fare merged. */
export function formatTraFares(table: { from: RailNode; to: RailNode; fares: TraFares }): Record<string, unknown> {
  const classes: { types: string[]; adult: number; child_senior_disabled: number }[] = [];
  for (const [type, fare] of Object.entries(table.fares.byType)) {
    const same = classes.find((c) => c.adult === fare.adult && c.child_senior_disabled === fare.half);
    if (same) same.types.push(type);
    else classes.push({ types: [type], adult: fare.adult, child_senior_disabled: fare.half });
  }
  classes.sort((a, b) => b.adult - a.adult);
  const business = table.fares.business;
  return {
    from: stationName(table.from),
    to: stationName(table.to),
    distance_km: table.fares.km,
    fare_ntd: classes,
    ...(business ? { business_fare_ntd: { types: ['自強3000 騰雲座艙'], ...fareNtd(business) } } : {}),
  };
}

function fareNtd(fare: TraFare): { adult: number; child_senior_disabled: number } {
  return { adult: fare.adult, child_senior_disabled: fare.half };
}

function formatTicket(ticket: TraTicket): Record<string, unknown> {
  return {
    operator: OPERATOR_LABEL.tra,
    from: stationName(ticket.from),
    to: stationName(ticket.to),
    class: ticket.type,
    distance_km: ticket.km,
    fare_ntd: fareNtd(ticket.fare),
    ...(ticket.business ? { business_fare_ntd: fareNtd(ticket.business) } : {}),
    ...(ticket.unreserved ? { unreserved_fare_ntd: fareNtd(ticket.unreserved) } : {}),
    ...(ticket.discounts?.length ? { discounts: ticket.discounts } : {}),
  };
}

export function formatJourney(j: Journey, liveFor: (leg: Leg) => LegLive, ticket?: TraTicket): Record<string, unknown> {
  const lives = j.legs.map(liveFor);
  // A late last train makes the arrival late; a late first train may still make its connection,
  // which the timetable alone cannot tell, so only the last leg's delay moves the arrival.
  const lastDelay = lives.at(-1)?.delay?.minutes ?? 0;
  return {
    depart: formatClock(j.dep),
    arrive: formatClock(j.arr),
    ...(lastDelay > 0 ? { arrive_estimated: formatClock(j.arr + lastDelay) } : {}),
    duration: formatDuration(j.arr - j.dep),
    transfers: j.transfers,
    legs: j.legs.map((leg, i) => formatLeg(leg, lives[i])),
    ...(ticket ? { ticket: formatTicket(ticket) } : {}),
  };
}

export function placeLabel(nodes: readonly RailNode[]): string {
  return nodes.map((node) => `${stationName(node)} (${OPERATOR_LABEL[nodeMode(node)]})`).join(', ');
}

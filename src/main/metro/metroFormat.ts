/**
 * What the model reads from the metro tools: compact JSON (a browser provider keeps about 3,500
 * characters of one observation), station names the way the operator prints them, fares already
 * added up, and the rule behind every total, so the answer never has to do arithmetic.
 */
import { concessionTotals } from './metroConcessions';
import { NETWORK_INFO, NTMETRO_TRANSFER_DISCOUNT_NTD, TRANSFER_ALLOWANCE_MIN, networkName } from './metroNetworks';
import type { PlannedLeg, PlannedOption } from './metroPlanner';
import type { MetroDeparture, MetroStation } from './metroTypes';

export function stationText(station: MetroStation): string {
  return `${station.codes.join('/')} ${station.zh}`;
}

/** Sources count past midnight on (24:28) so lists stay in order; the model reads "00:28 (+1)". */
export function clockText(time: string): string {
  const match = /^(\d{2}):(\d{2})$/u.exec(time);
  if (!match || Number(match[1]) < 24) return time;
  return `${String(Number(match[1]) - 24).padStart(2, '0')}:${match[2]} (+1)`;
}

function departureText(d: MetroDeparture): string {
  const parts = [d.inMinutes !== undefined ? `${clockText(d.time)} (in ${d.inMinutes} min)` : clockText(d.time)];
  if (d.type) parts.push(d.type);
  if (d.toward) parts.push(`往${d.toward}`);
  if (d.arrive) parts.push(`arrives ${clockText(d.arrive)}`);
  return parts.join(' ');
}

const MAX_DEPARTURES_SHOWN = 3;

/** `full` = the first option's legs: every ticket kind and note; later options keep fares and times only. */
export function formatLeg(leg: PlannedLeg, full = true): Record<string, unknown> {
  const head = { network: networkName(leg.network), from: stationText(leg.from), to: stationText(leg.to) };
  if (!leg.quote) return { ...head, error: leg.error ?? 'no answer' };
  const q = leg.quote;
  return {
    ...head,
    ...(q.fare !== undefined ? { fare_ntd: q.fare } : {}),
    ...(q.singleTicket !== undefined && q.singleTicket !== q.fare ? { single_ticket_ntd: q.singleTicket } : {}),
    ...(full && q.tickets?.length ? { other_tickets_ntd: Object.fromEntries(q.tickets.map((t) => [t.kind, t.ntd])) } : {}),
    ...(q.minutes !== undefined ? { ride_min: q.minutes } : {}),
    ...(q.route ? { route: q.route } : {}),
    ...(q.departures?.length ? { next: q.departures.slice(0, MAX_DEPARTURES_SHOWN).map(departureText) } : {}),
    ...(q.firstTrain ? { first_train: clockText(q.firstTrain) } : {}),
    ...(q.lastTrain ? { last_train: clockText(q.lastTrain) } : {}),
    ...(full && q.notes?.length ? { notes: q.notes } : {}),
  };
}

/**
 * One way to ride. Only the first option (`full`) lists every ticket kind and note: the airport
 * line alone lists 11 ticket kinds, and a browser provider keeps about 3,500 characters.
 */
export function formatOption(option: PlannedOption, full = true): Record<string, unknown> {
  const changes = option.legs.slice(1).map((leg) => stationText(leg.from));
  const concessions = option.legs.length > 1 && option.legs.every((leg) => leg.quote)
    ? concessionTotals(option.legs.map((leg) => ({ network: leg.network, tickets: leg.quote?.tickets })), option.discounted)
    : {};
  return {
    ...(changes.length > 0 ? { change_at: changes } : {}),
    ...(option.cardFare !== undefined ? { total_card_fare_ntd: option.cardFare } : {}),
    ...(option.discounted > 0 ? { card_transfer_discount_ntd: option.discounted * NTMETRO_TRANSFER_DISCOUNT_NTD } : {}),
    ...(option.ticketFare !== undefined && option.legs.length > 1 && option.ticketFare !== option.cardFare
      ? { total_single_tickets_ntd: option.ticketFare } : {}),
    ...(Object.keys(concessions).length > 0 ? { total_concession_ntd: concessions } : {}),
    ...(option.ridingMin !== undefined ? { riding_min: option.ridingMin } : {}),
    ...(option.estimatedMin !== undefined && option.legs.length > 1 ? { with_changes_about_min: option.estimatedMin } : {}),
    legs: option.legs.map((leg) => formatLeg(leg, full)),
  };
}

/** The fare rules behind the totals, only those that apply to these options. */
export function fareNotes(options: readonly PlannedOption[]): string[] {
  const notes: string[] = [];
  const multi = options.some((option) => new Set(option.legs.map((leg) => leg.network)).size > 1);
  if (multi) {
    notes.push('Different operators charge separately; total_card_fare_ntd already adds the legs (and takes off any card discount). Never add them again.');
    notes.push('total_concession_ntd adds each operator\'s own price for that ticket kind (they differ: Taipei Metro 4折, airport MRT half…); who qualifies differs too — metro_tickets has each operator\'s rules.');
  }
  if (options.some((option) => option.discounted > 0)) {
    notes.push(`New Taipei transfer discount: ${NTMETRO_TRANSFER_DISCOUNT_NTD} NTD off per change between Taipei Metro and 淡海/安坑輕軌 or 三鶯線 within 1 hour on 悠遊卡/一卡通/愛金卡 (4 NTD on 敬老/愛心/兒童 cards); none on single-journey tickets.`);
  }
  if (options.some((option) => option.legs.some((leg) => leg.network === 'tymc')) && multi) {
    notes.push('Taipei Metro and the airport MRT give no transfer discount between them.');
  }
  if (options.some((option) => option.legs.length > 1)) {
    notes.push(`with_changes_about_min allows ${TRANSFER_ALLOWANCE_MIN} min per change for walking and waiting; it is an estimate, not a timetable.`);
  }
  return notes;
}

/** The operators' pages the legs came from, one per page. */
export function officialLinks(options: readonly PlannedOption[]): string[] {
  return [...new Set(options.flatMap((option) => option.legs.flatMap((leg) => leg.quote?.sources ?? [])))].slice(0, 6);
}

export function systemLabel(station: MetroStation): string {
  return `${stationText(station)}（${NETWORK_INFO[station.network].zh}）`;
}

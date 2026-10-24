/**
 * Concession fares across operators, added up in code like the full fare. Each operator names its
 * tickets its own way (北捷「敬老/愛心」, 機捷「敬老/愛心單程優待票」, 新北「敬老卡／愛心卡／愛心陪伴卡
 * （電子票證4折）」…), so each name is read into a few kinds a rider asks about; a total is given
 * only when every leg has that kind. Rules behind the names (official pages, 2026-10-22):
 * - 北捷: 敬老／愛心 cards and the single ticket both pay 4折, so one price serves both kinds; the
 *   children's price needs a Taipei or New Taipei child card.
 * - 機捷: 敬老／愛心 single ticket and cards both pay half; the child single ticket is 8折, child
 *   cards differ by city (臺北 8折, 新北 5折), so no child card kind.
 * - 新北捷運: 敬老 card 4折, the 優待單程票 5折, child cards 4折.
 * - 中捷: 敬老／愛心 card and ticket 5折. 高捷: 社福卡 and 社福單程票 half.
 * New Taipei's transfer discount for these cards is 4 NTD, not 8.
 */
import type { MetroNetwork, TicketPrice } from './metroTypes';

export type ConcessionKind = 'elderlyCard' | 'elderlySingle' | 'childCard' | 'childSingle';

/** How a total of each kind is labelled for the model. */
export const CONCESSION_LABELS: Readonly<Record<ConcessionKind, string>> = {
  elderlyCard: '敬老／愛心卡',
  elderlySingle: '敬老／愛心單程票',
  childCard: '兒童卡（限發卡城市的兒童卡）',
  childSingle: '兒童單程票',
};

/** The New Taipei transfer discount on 敬老／愛心／兒童 cards. */
export const CONCESSION_TRANSFER_DISCOUNT_NTD = 4;

const RULES: Readonly<Record<MetroNetwork, readonly (readonly [RegExp, readonly ConcessionKind[]])[]>> = {
  trtc: [[/敬老/u, ['elderlyCard', 'elderlySingle']], [/兒童/u, ['childCard']]],
  tymc: [[/敬老/u, ['elderlyCard', 'elderlySingle']], [/兒童單程/u, ['childSingle']]],
  danhai: [[/敬老卡/u, ['elderlyCard']], [/優待單程票/u, ['elderlySingle']], [/兒童卡/u, ['childCard']]],
  ankeng: [[/敬老卡/u, ['elderlyCard']], [/優待單程票/u, ['elderlySingle']], [/兒童卡/u, ['childCard']]],
  sanying: [[/敬老卡/u, ['elderlyCard']], [/優待單程票/u, ['elderlySingle']], [/兒童卡/u, ['childCard']]],
  tmrt: [[/敬老/u, ['elderlyCard', 'elderlySingle']]],
  krtc: [[/社福/u, ['elderlyCard', 'elderlySingle']]],
  klrt: [[/社福/u, ['elderlyCard', 'elderlySingle']]],
};

/** The concession prices one leg's ticket list holds, by kind. */
export function legConcessions(network: MetroNetwork, tickets: readonly TicketPrice[] | undefined): Partial<Record<ConcessionKind, number>> {
  const out: Partial<Record<ConcessionKind, number>> = {};
  for (const ticket of tickets ?? []) {
    for (const [pattern, kinds] of RULES[network]) {
      if (!pattern.test(ticket.kind)) continue;
      for (const kind of kinds) out[kind] ??= ticket.ntd;
    }
  }
  return out;
}

/**
 * Totals for a trip of several legs: a kind every leg has, added up, less 4 NTD per New Taipei
 * transfer on the card kinds. Kinds some leg lacks are left out rather than guessed.
 */
export function concessionTotals(
  legs: readonly { network: MetroNetwork; tickets?: readonly TicketPrice[] }[],
  discountedTransfers: number,
): Record<string, number> {
  const perLeg = legs.map((leg) => legConcessions(leg.network, leg.tickets));
  const totals: Record<string, number> = {};
  for (const kind of Object.keys(CONCESSION_LABELS) as ConcessionKind[]) {
    const prices = perLeg.map((leg) => leg[kind]);
    if (prices.some((price) => price === undefined)) continue;
    const sum = (prices as number[]).reduce((a, b) => a + b, 0);
    const card = kind === 'elderlyCard' || kind === 'childCard';
    totals[CONCESSION_LABELS[kind]] = card ? sum - discountedTransfers * CONCESSION_TRANSFER_DISCOUNT_NTD : sum;
  }
  return totals;
}

import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { FlowUserError } from '../userError';
import { envelope } from './dataSources';
import { matchTicket, parseTicketNumbers, PRIZES } from '../../invoice/invoice';
import type { InvoiceDraw, PrizeId, TicketMatch, TicketNumber } from '../../invoice/invoice';
import {
  claimWindowOf, drawDateOf, parsePeriodInput, periodCode, periodIndex, ROC_OFFSET, taipeiDate,
} from '../../invoice/invoicePeriods';
import type { PeriodRef, PeriodSelection } from '../../invoice/invoicePeriods';
import { loadInvoiceDraws } from '../../invoice/invoiceFeed';

type Strings = Record<string, string>;

export interface InvoiceStepDeps {
  now: () => Date;
  strings: Strings;
  log: (line: string) => void;
  loadDraws: () => Promise<InvoiceDraw[]>;
}

/** Said to the model with every check: the one prize family this list cannot cover. */
const CLOUD_PRIZE_NOTE = 'Cloud-invoice exclusive prizes (雲端發票專屬獎) are drawn separately and not in this list; the e-invoice platform matches and notifies those itself.';

const pad2 = (n: number): string => String(n).padStart(2, '0');

function periodLabel(ref: PeriodRef, strings: Strings): string {
  return t(strings, 'invoice.period', {
    roc: String(ref.year - ROC_OFFSET), year: String(ref.year), from: pad2(ref.startMonth), to: pad2(ref.startMonth + 1),
  });
}

function money(amount: number): string {
  return `NT$${amount.toLocaleString('en-US')}`;
}

function prizeName(prize: PrizeId, strings: Strings): string {
  return t(strings, `invoice.prize.${prize}`);
}

function prizeLine(prize: PrizeId, numbers: string, strings: Strings): string {
  return t(strings, 'invoice.prizeLine', { prize: prizeName(prize, strings), numbers, amount: money(PRIZES[prize].amount) });
}

/** The winning numbers of one period as message-ready lines. */
export function formatInvoiceDraw(draw: InvoiceDraw, strings: Strings): string {
  return [
    t(strings, 'invoice.heading', { period: periodLabel(draw, strings), date: draw.drawnAt }),
    prizeLine('special', draw.special, strings),
    prizeLine('grand', draw.grand, strings),
    prizeLine('first', draw.first.join('、'), strings),
    t(strings, 'invoice.tailPrizes'),
    ...(draw.extraSixth.length ? [prizeLine('extraSixth', draw.extraSixth.join('、'), strings)] : []),
    ...(draw.otherPrizes.length ? [t(strings, 'invoice.notChecked', { prizes: draw.otherPrizes.join('、'), link: draw.link })] : []),
    t(strings, 'invoice.claim', { from: draw.claimFrom, until: draw.claimUntil }),
  ].join('\n');
}

function drawJson(draw: InvoiceDraw, today: string): Record<string, unknown> {
  return {
    period: draw.period,
    label: draw.label,
    months: `${draw.year}-${pad2(draw.startMonth)}~${pad2(draw.startMonth + 1)}`,
    drawnAt: draw.drawnAt,
    claimFrom: draw.claimFrom,
    claimUntil: draw.claimUntil,
    claimable: draw.claimUntil >= today,
    special: draw.special,
    grand: draw.grand,
    first: draw.first,
    extraSixth: draw.extraSixth,
    ...(draw.otherPrizes.length ? { otherPrizesNotChecked: draw.otherPrizes } : {}),
    link: draw.link,
  };
}

function badPeriod(value: string): FlowUserError {
  return new FlowUserError('flow.error.invoicePeriod', { value }, `Not an invoice period: "${value}"; use "latest", "all", a period like "115-07" / "2026-07", or an invoice date YYYY-MM-DD`);
}

/** The periods a request is about. A named period the feed does not list says why. */
function selectDraws(sel: PeriodSelection, draws: InvoiceDraw[], checking: boolean, today: string, strings: Strings): InvoiceDraw[] {
  if (sel.kind === 'all') return draws;
  if (sel.kind === 'latest') return [draws[0]];
  if (sel.kind === 'default') {
    if (!checking) return [draws[0]];
    const open = draws.filter((d) => d.claimUntil >= today);
    return open.length ? open : [draws[0]];
  }
  const code = periodCode(sel.ref);
  const hit = draws.find((d) => d.period === code);
  if (hit) return [hit];
  const period = periodLabel(sel.ref, strings);
  const drawDate = drawDateOf(sel.ref);
  if (periodIndex(sel.ref) > periodIndex(draws[0])) {
    throw new FlowUserError('flow.error.invoiceNotDrawn', { period, date: drawDate }, `The ${code} period's winning numbers are not out yet; it is drawn on ${drawDate} (latest listed: ${draws[0].period})`);
  }
  const until = claimWindowOf(drawDate).until;
  if (until < today) {
    throw new FlowUserError('flow.error.invoicePeriodExpired', { period, date: until }, `The ${code} period is no longer listed; its prizes could be claimed until ${until}`);
  }
  throw new FlowUserError('flow.error.invoicePeriodMissing', { period }, `The Ministry of Finance list has no ${code} period (it lists ${draws.map((d) => d.period).join(', ')})`);
}

interface Hit { draw: InvoiceDraw; match: TicketMatch }

function hitLine(ticket: TicketNumber, { draw, match }: Hit, today: string, strings: Strings): string {
  const period = periodLabel(draw, strings);
  if (match.status === 'maybe') {
    const prizes = (match.checkFull ?? []).map((p) => prizeName(p, strings)).join('、');
    return t(strings, 'invoice.result.maybe', { number: ticket.display, period, prizes });
  }
  const prize = match.prize ?? 'sixth';
  const vars = {
    number: ticket.display, period, prize: prizeName(prize, strings), amount: money(PRIZES[prize].amount),
    from: draw.claimFrom, until: draw.claimUntil, n: String(ticket.digits.length),
  };
  if (match.atLeast) return t(strings, 'invoice.result.atLeast', vars);
  return t(strings, draw.claimUntil < today ? 'invoice.result.wonExpired' : 'invoice.result.won', vars);
}

function hitJson({ draw, match }: Hit, today: string): Record<string, unknown> {
  const prize = match.prize;
  return {
    period: draw.period,
    label: draw.label,
    status: match.status,
    ...(prize ? { prize, name: PRIZES[prize].name, amount: PRIZES[prize].amount, matched: match.matched } : {}),
    ...(match.atLeast ? { atLeast: true } : {}),
    ...(match.checkFull ? { checkFullNumberFor: match.checkFull.map((p) => PRIZES[p].name) } : {}),
    claimFrom: draw.claimFrom,
    claimUntil: draw.claimUntil,
    claimable: draw.claimUntil >= today,
  };
}

/** The period whose draw date is in this calendar month (Taiwan), else "" — a draw-day gate for a schedule. */
function newThisMonth(latest: InvoiceDraw, today: string): string {
  return latest.drawnAt.slice(0, 7) === today.slice(0, 7) ? latest.period : '';
}

function subjectVars(draw: InvoiceDraw): Record<string, string> {
  return {
    period: draw.period,
    label: draw.label,
    drawnAt: draw.drawnAt,
    claimUntil: draw.claimUntil,
    special: draw.special,
    grand: draw.grand,
    first: draw.first.join('、'),
  };
}

/**
 * The receipt-lottery step. No numbers: the winning numbers of the latest (or the named, or every
 * listed) period. With numbers: each one checked in code against the chosen periods — by default
 * every period whose prizes can still be claimed, so a receipt from either of the last two
 * periods is covered without the user knowing which period is which.
 */
export async function runInvoiceStep(config: Record<string, string>, deps: InvoiceStepDeps): Promise<string> {
  const periodRaw = (config.period ?? '').trim();
  const sel = parsePeriodInput(periodRaw);
  if (!sel) throw badPeriod(periodRaw);
  const numbersRaw = (config.numbers ?? '').trim();
  const { numbers, bad } = parseTicketNumbers(numbersRaw);
  if (bad.length || (numbersRaw && numbers.length === 0)) {
    const value = bad.length ? bad.join(', ') : numbersRaw;
    throw new FlowUserError('flow.error.invoiceNumbers', { value }, `Not receipt numbers: "${value}"; give 8 digits each (an "AB-" track prefix is fine) or just the last 3 digits`);
  }

  let draws: InvoiceDraw[];
  try {
    draws = await deps.loadDraws();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new FlowUserError('flow.error.invoiceFeed', {}, `Could not read the Ministry of Finance winning-numbers list (${detail})`);
  }
  const today = taipeiDate(deps.now());
  const targets = selectDraws(sel, draws, numbers.length > 0, today, deps.strings);
  const fresh = newThisMonth(draws[0], today);

  if (numbers.length === 0) {
    deps.log(`🧾 [Flow] Invoice: ${targets.map((d) => d.period).join(', ')}`);
    return envelope(JSON.stringify(targets.length === 1 ? drawJson(targets[0], today) : targets.map((d) => drawJson(d, today))), {
      text: targets.map((d) => formatInvoiceDraw(d, deps.strings)).join('\n\n'),
      ...subjectVars(targets[0]),
      won: '0',
      count: String(targets.length),
      newThisMonth: fresh,
    });
  }

  const lines: string[] = [];
  const results: Record<string, unknown>[] = [];
  let winners = 0;
  let firstWin: InvoiceDraw | null = null;
  for (const ticket of numbers) {
    const hits = targets.map((draw) => ({ draw, match: matchTicket(ticket, draw) })).filter((h) => h.match.status !== 'none');
    const won = hits.find((h) => h.match.status === 'won');
    if (won) {
      winners++;
      firstWin ??= won.draw;
    }
    lines.push(...(hits.length
      ? hits.map((h) => hitLine(ticket, h, today, deps.strings))
      : [t(deps.strings, 'invoice.result.none', { number: ticket.display, periods: targets.map((d) => periodLabel(d, deps.strings)).join('、') })]));
    results.push({ number: ticket.display, partial: ticket.digits.length < 8, matches: hits.map((h) => hitJson(h, today)) });
  }
  const unchecked = targets.filter((d) => d.otherPrizes.length);
  for (const d of unchecked) {
    lines.push(t(deps.strings, 'invoice.notChecked', { prizes: d.otherPrizes.join('、'), link: d.link }));
  }
  const notes = [
    CLOUD_PRIZE_NOTE,
    ...unchecked.map((d) => `${d.label} also lists ${d.otherPrizes.join(', ')}, which this check does not cover; see ${d.link}`),
  ];
  deps.log(`🧾 [Flow] Invoice: ${numbers.length} number(s) against ${targets.map((d) => d.period).join(', ')} → ${winners} won`);
  return envelope(JSON.stringify({
    checked: targets.map((d) => ({ period: d.period, label: d.label, drawnAt: d.drawnAt, claimUntil: d.claimUntil })),
    results,
    notes,
  }), {
    text: lines.join('\n'),
    ...subjectVars(firstWin ?? targets[0]),
    won: winners > 0 ? '1' : '0',
    count: String(winners),
    newThisMonth: fresh,
  });
}

export function execTwInvoice(config: Record<string, string>, timeoutMs: number): Promise<string> {
  return runInvoiceStep(config, {
    now: () => new Date(),
    strings: getLangCache(),
    log: sendLog,
    loadDraws: () => loadInvoiceDraws(timeoutMs),
  });
}

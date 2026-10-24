/**
 * One station, every way out: "十四張站下一班", "崁頂末班車幾點", "竿蓁林下一班". Each direction is
 * quoted by its own operator toward the next station that way (`metroDirections.ts`), so the
 * answer is the operator's own next trains and first/last train for that direction. A name that
 * is a station on two systems (十四張: 環狀線 Y08 and 安坑 K09) comes back as both, for the model
 * to ask which one when the user did not say.
 */
import { clockText, stationText } from './metroFormat';
import { stationDirections } from './metroDirections';
import type { Direction } from './metroDirections';
import { NETWORK_INFO } from './metroNetworks';
import type { TransferLink } from './metroNetworks';
import type { LegQuote, MetroDeps, MetroNetwork, MetroStation, NetworkSource, QuoteWhen } from './metroTypes';

export interface BoardDeps extends MetroDeps {
  sources: Readonly<Record<MetroNetwork, NetworkSource>>;
  transfers: readonly TransferLink[];
  stationByCode: (network: MetroNetwork, code: string) => MetroStation | undefined;
}

const MAX_SHOWN = 3;

function label(direction: Direction, deps: BoardDeps, network: MetroNetwork): string {
  if (direction.ringWay) return direction.ringWay;
  const names = direction.ends.map((code) => deps.stationByCode(network, code)?.zh ?? code);
  return `往${names.join('／')}`;
}

function departureLine(quote: LegQuote): string[] {
  return (quote.departures ?? []).slice(0, MAX_SHOWN).map((d) => {
    const parts = [d.inMinutes !== undefined ? `${clockText(d.time)} (in ${d.inMinutes} min)` : clockText(d.time)];
    if (d.type) parts.push(d.type);
    if (d.toward) parts.push(`往${d.toward.replace(/^往/u, '')}`);
    return parts.join(' ');
  });
}

/** Where a rider can change to another system here, by the transfer table. */
function transfersAt(station: MetroStation, deps: BoardDeps): string[] {
  return deps.transfers.flatMap((link) => {
    const [here, there] = link.a.network === station.network && station.codes.includes(link.a.code) ? [link.a, link.b]
      : link.b.network === station.network && station.codes.includes(link.b.code) ? [link.b, link.a] : [undefined, undefined];
    if (!here || !there) return [];
    const other = deps.stationByCode(there.network, there.code);
    return other ? [`${stationText(other)}（${NETWORK_INFO[other.network].zh}）`] : [];
  });
}

async function directionEntry(station: MetroStation, direction: Direction, when: QuoteWhen, deps: BoardDeps) {
  const head = { line: direction.line, toward: label(direction, deps, station.network) };
  const target = deps.stationByCode(station.network, direction.via);
  if (!target) return { entry: { ...head, error: `no station ${direction.via}` }, notes: [], sources: [] };
  try {
    const quote = await deps.sources[station.network].quote(station, target, when, deps);
    const next = departureLine(quote);
    return {
      entry: {
        ...head,
        ...(next.length > 0 ? { next } : {}),
        ...(quote.firstTrain ? { first_train: clockText(quote.firstTrain) } : {}),
        ...(quote.lastTrain ? { last_train: clockText(quote.lastTrain) } : {}),
      },
      notes: quote.notes ?? [],
      sources: quote.sources,
    };
  } catch (err) {
    return { entry: { ...head, error: err instanceof Error ? err.message : String(err) }, notes: [], sources: [] };
  }
}

/** Every direction from each station `stations` names, each asked of its operator in parallel. */
export async function stationBoard(stations: readonly MetroStation[], when: QuoteWhen, deps: BoardDeps): Promise<{
  boards: Record<string, unknown>[];
  sources: string[];
}> {
  const sources = new Set<string>();
  const boards = await Promise.all(stations.map(async (station) => {
    const results = await Promise.all(stationDirections(station).map((d) => directionEntry(station, d, when, deps)));
    const notes = [...new Set(results.flatMap((r) => r.notes))];
    for (const r of results) for (const s of r.sources) sources.add(s);
    const transfers = transfersAt(station, deps);
    return {
      station: `${stationText(station)}（${NETWORK_INFO[station.network].zh}）`,
      lines: station.lines,
      ...(transfers.length > 0 ? { transfer_to: transfers } : {}),
      directions: results.map((r) => r.entry),
      ...(notes.length > 0 ? { notes } : {}),
    };
  }));
  return { boards, sources: [...sources].slice(0, 8) };
}

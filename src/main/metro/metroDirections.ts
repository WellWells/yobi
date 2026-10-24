/**
 * Which ways trains leave a station, for "下一班 / 末班" questions that name one station and no
 * destination. Each network is a few lines of station codes in riding order; a station's directions
 * are its neighbours along them, labelled by the line's end that way. A neighbour (not the end) is
 * what each operator is asked about, so trains that turn back early still count — except on the
 * airport line, where express trains skip the neighbours, so its ends are asked instead.
 */
import { KLRT_RING, KRTC_LINE_ORDER } from './krtcStations';
import type { MetroNetwork, MetroStation } from './metroTypes';
import { ANKENG_LINE, DANHAI_BLUE, DANHAI_GREEN, SANYING_LINE } from './ntmetroStations';
import { TMRT_STATIONS } from './tmrtStations';
import { TRTC_STATIONS } from './trtcStations';
import { TYMC_STATIONS } from './tymcStations';

/** One line in riding order; `ring` lines wrap around (Kaohsiung's light rail). */
interface LineOrder {
  line: string;
  codes: readonly string[];
  ring?: boolean;
}

function byNumber(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => Number(a.replace(/\D/gu, '')) - Number(b.replace(/\D/gu, '')));
}

/**
 * Taipei Metro's lines from its station codes: a main line per letter prefix, numbered in order;
 * the branches hang off one main-line station — 新北投 R22A off 北投 R22, 小碧潭 G03A off 七張 G03,
 * and the 蘆洲 branch O50–O54 off 大橋頭 O12 (Taipei Metro's route map, 2026-10-22).
 */
function trtcLines(): LineOrder[] {
  const codes = TRTC_STATIONS.flatMap((s) => s.codes);
  const main = (prefix: string, keep: (n: number) => boolean = () => true): string[] =>
    byNumber(codes.filter((c) => new RegExp(`^${prefix}\\d+$`, 'u').test(c) && keep(Number(c.slice(prefix.length)))));
  return [
    { line: 'BR', codes: main('BR') },
    { line: 'R', codes: main('R') },
    { line: 'R', codes: ['R22', 'R22A'] },
    { line: 'G', codes: main('G') },
    { line: 'G', codes: ['G03', 'G03A'] },
    { line: 'O', codes: main('O', (n) => n < 50) },
    { line: 'O', codes: ['O12', ...main('O', (n) => n >= 50)] },
    { line: 'BL', codes: main('BL') },
    { line: 'Y', codes: main('Y') },
  ];
}

const LINES: Readonly<Record<MetroNetwork, readonly LineOrder[]>> = {
  trtc: trtcLines(),
  tymc: [{ line: 'A', codes: TYMC_STATIONS.map((s) => s.codes[0]) }],
  danhai: [{ line: 'V', codes: DANHAI_GREEN }, { line: 'V', codes: DANHAI_BLUE }],
  ankeng: [{ line: 'K', codes: ANKENG_LINE }],
  sanying: [{ line: 'LB', codes: SANYING_LINE }],
  tmrt: [{ line: 'G', codes: TMRT_STATIONS.map((s) => s.codes[0]) }],
  krtc: [{ line: 'R', codes: KRTC_LINE_ORDER.R }, { line: 'O', codes: KRTC_LINE_ORDER.O }],
  klrt: [{ line: 'C', codes: KLRT_RING, ring: true }],
};

export function lineOrders(network: MetroNetwork): readonly LineOrder[] {
  return LINES[network];
}

/** One way out of a station: the code to ask about, and the line's end(s) that way, as codes. */
export interface Direction {
  line: string;
  /** The station code the operator is asked about (a neighbour; the airport line's end). */
  via: string;
  /** The line's last station(s) that way; empty on a ring. */
  ends: string[];
  /** A ring's way round, as its operator names it (高雄輕軌 順行／逆行). */
  ringWay?: '順行' | '逆行';
}

/** The airport line's express trains skip most stations: ask about A1 one way, A13 or A22 the other. */
function airportDirections(code: string, order: readonly string[]): Direction[] {
  const at = order.indexOf(code);
  if (at < 0) return [];
  const a13 = order.indexOf('A13');
  const out: Direction[] = [];
  if (at > 0) out.push({ line: 'A', via: order[0], ends: [order[0]] });
  // Express trains end at A13 (機場第二航廈); commuter trains run on to A22.
  const outbound = at < a13 ? order[a13] : order[order.length - 1];
  const ends = at < a13 ? [order[a13], order[order.length - 1]] : [order[order.length - 1]];
  if (at < order.length - 1) out.push({ line: 'A', via: outbound, ends });
  return out;
}

/** The directions trains leave `station` in, merged where two lines share the track (淡海's trunk). */
export function stationDirections(station: MetroStation): Direction[] {
  const lines = LINES[station.network];
  if (station.network === 'tymc') return airportDirections(station.codes[0], lines[0].codes);
  const byVia = new Map<string, Direction>();
  for (const { line, codes, ring } of lines) {
    const at = codes.findIndex((c) => station.codes.includes(c));
    if (at < 0) continue;
    if (ring) {
      // KLRT_RING is in 順行 order, so the next code is 順行 and the previous 逆行.
      byVia.set(codes[(at + 1) % codes.length], { line, via: codes[(at + 1) % codes.length], ends: [], ringWay: '順行' });
      byVia.set(codes[(at - 1 + codes.length) % codes.length], { line, via: codes[(at - 1 + codes.length) % codes.length], ends: [], ringWay: '逆行' });
      continue;
    }
    for (const [next, end] of [[at + 1, codes.length - 1], [at - 1, 0]] as const) {
      if (next < 0 || next >= codes.length) continue;
      const via = codes[next];
      const held = byVia.get(via);
      if (held) {
        if (!held.ends.includes(codes[end])) held.ends.push(codes[end]);
      } else {
        byVia.set(via, { line, via, ends: [codes[end]] });
      }
    }
  }
  return [...byVia.values()];
}

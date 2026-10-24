/**
 * Taiwan's metro networks as the rail connector's metro tools see them. A network is one fare
 * system: a trip inside it is one fare from its operator; a trip across two is two fares (with a
 * card discount on some pairs, see `metroFares.ts`). Taipei Metro's network includes the Circular
 * line (Y): Taipei Metro prices Y trips together with its own lines.
 */
import type { FetchFn } from '../rail/railHttp';

export type MetroNetwork = 'trtc' | 'tymc' | 'danhai' | 'ankeng' | 'sanying' | 'tmrt' | 'krtc' | 'klrt';

export const METRO_NETWORKS: readonly MetroNetwork[] = ['trtc', 'tymc', 'danhai', 'ankeng', 'sanying', 'tmrt', 'krtc', 'klrt'];

/** A station keyed by its network and the first code printed on its signs (`trtc:BL12`, `tymc:A13`, `tmrt:103a`). */
export type MetroNode = `${MetroNetwork}:${string}`;

export interface MetroStation {
  network: MetroNetwork;
  /** Codes on the signs; a station on two lines of one network has both (`['BL12', 'R10']`). The first is its key. */
  codes: readonly string[];
  zh: string;
  en: string;
  /** Line codes it is on (`BL`, `R`; `A`; `V`; `K`; `LB`; `G`; `R`, `O`; `C`). */
  lines: readonly string[];
  /** The id the operator's own pages and requests take (Taipei Metro SID "051", TYMC "13", Taichung GUID, KRTC "o5r10"). */
  ref?: string;
  /** Names it was known by before, still on old maps and in people's heads (KRTC 西子灣 → 哈瑪星). */
  formerZh?: readonly string[];
}

export function metroNode(network: MetroNetwork, code: string): MetroNode {
  return `${network}:${code}`;
}

export function stationNode(station: MetroStation): MetroNode {
  return metroNode(station.network, station.codes[0]);
}

export function nodeNetwork(node: MetroNode): MetroNetwork {
  return node.slice(0, node.indexOf(':')) as MetroNetwork;
}

/** One ticket kind the operator lists for a pair, named the way the operator names it (敬老/愛心, 兒童, 一日票). */
export interface TicketPrice {
  kind: string;
  ntd: number;
}

/** One departure from the leg's first station toward its last, Taipei time. */
export interface MetroDeparture {
  /** HH:MM; past midnight still counts on (24:10) so the list stays in order. */
  time: string;
  /** HH:MM at the leg's last station, when the source gives it. */
  arrive?: string;
  /** The operator's word for the train (直達車, 普通車). */
  type?: string;
  /** Where the train is headed, as signed. */
  toward?: string;
  /** Minutes until it leaves, for live sources (arrival boards). */
  inMinutes?: number;
}

/** What one network says about riding from one of its stations to another. Every field the source does not give is left out. */
export interface LegQuote {
  network: MetroNetwork;
  from: MetroNode;
  to: MetroNode;
  /** Full adult fare in NT$ as a stored-value card (悠遊卡/一卡通) pays it. */
  fare?: number;
  /** Full adult single-journey token/ticket price when it differs from `fare`. */
  singleTicket?: number;
  /** Every other ticket kind the operator lists for this pair. */
  tickets?: readonly TicketPrice[];
  /** Ride time in minutes as the operator publishes it (no waiting). */
  minutes?: number;
  /** How to ride, in the operator's words (搭乘淡水信義線（往淡水）). */
  route?: string;
  /** The next few departures (≤ 5) at or after the asked time, earliest first. */
  departures?: readonly MetroDeparture[];
  /** First and last train from `from` toward `to` on the asked day, HH:MM. */
  firstTrain?: string;
  lastTrain?: string;
  /** Facts the rider needs that have no field (headway when there is no timetable, a published horizon). */
  notes?: readonly string[];
  /** The official pages this came from. */
  sources: readonly string[];
}

/** When the rider asks about: a Taipei date and minutes after its midnight; `isNow` when nothing was given. */
export interface QuoteWhen {
  date: string;
  minutes: number;
  isNow: boolean;
}

/** Memoizes one upstream answer for everyone asking (single-flight, in memory); key prefixed by network. */
export type MetroMemo = <T>(key: string, ttlMs: number, load: () => Promise<T>) => Promise<T>;

export interface MetroDeps {
  fetchFn: FetchFn;
  memo: MetroMemo;
  signal?: AbortSignal;
}

/** One network's quotes. Throws `Error` with an English message when the source cannot answer. */
export interface NetworkSource {
  network: MetroNetwork;
  quote(from: MetroStation, to: MetroStation, when: QuoteWhen, deps: MetroDeps): Promise<LegQuote>;
}

/** The operators whose status banners the tools read. */
export type MetroOperator = 'trtc' | 'tymc' | 'ntmetro' | 'tmrt' | 'krtc';

/** One line's (or a whole operator's) service status as the operator words it. */
export interface LineStatus {
  operator: MetroOperator;
  /** The line as the operator names it (淡水信義線, 機場捷運, 淡海輕軌, 輕軌); the operator's name for a whole-network banner. */
  line: string;
  /** true = the operator says normal service; false = it says otherwise; null = could not tell. */
  normal: boolean | null;
  /** The operator's own words, trimmed. */
  text: string;
  source: string;
}

export interface StatusSource {
  operator: MetroOperator;
  status(deps: MetroDeps): Promise<LineStatus[]>;
}

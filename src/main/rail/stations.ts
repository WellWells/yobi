/**
 * Station names → station keys. A rider names a place the way they say it (with or without
 * "station", either spelling of Tai, Chinese or English), and one place is often two stations:
 * THSR Zuoying sits on TRA Xinzuoying, and there is no THSR Kaohsiung at all. So a place resolves
 * to every station that serves it, and the router picks among them.
 */
import { TRA_STATION_ROWS } from './traStationTable';
import { nodeId, nodeMode, railNode } from './railTypes';
import type { RailMode, RailNode } from './railTypes';

/** THSR's stations: TDX id, the id THSR's own site uses, names. */
export const THSR_STATIONS = [
  { id: '0990', web: 'NanGang', zh: '南港', en: 'Nangang' },
  { id: '1000', web: 'TaiPei', zh: '台北', en: 'Taipei' },
  { id: '1010', web: 'BanQiao', zh: '板橋', en: 'Banqiao' },
  { id: '1020', web: 'TaoYuan', zh: '桃園', en: 'Taoyuan' },
  { id: '1030', web: 'XinZhu', zh: '新竹', en: 'Hsinchu' },
  { id: '1035', web: 'MiaoLi', zh: '苗栗', en: 'Miaoli' },
  { id: '1040', web: 'TaiZhong', zh: '台中', en: 'Taichung' },
  { id: '1043', web: 'ZhangHua', zh: '彰化', en: 'Changhua' },
  { id: '1047', web: 'YunLin', zh: '雲林', en: 'Yunlin' },
  { id: '1050', web: 'JiaYi', zh: '嘉義', en: 'Chiayi' },
  { id: '1060', web: 'TaiNan', zh: '台南', en: 'Tainan' },
  { id: '1070', web: 'ZuoYing', zh: '左營', en: 'Zuoying' },
] as const;

/** Where a rider changes between THSR and TRA. Ten minutes covers the walk at every one of them. */
export const TRANSFER_LINKS: readonly { thsr: RailNode; tra: RailNode; minutes: number }[] = [
  { thsr: 'thsr:0990', tra: 'tra:0980', minutes: 10 }, // Nangang, one building
  { thsr: 'thsr:1000', tra: 'tra:1000', minutes: 10 }, // Taipei, one building
  { thsr: 'thsr:1010', tra: 'tra:1020', minutes: 10 }, // Banqiao, one building
  { thsr: 'thsr:1030', tra: 'tra:1194', minutes: 10 }, // Hsinchu ↔ Liujia
  { thsr: 'thsr:1040', tra: 'tra:3340', minutes: 10 }, // Taichung ↔ Xinwuri
  { thsr: 'thsr:1060', tra: 'tra:4272', minutes: 10 }, // Tainan ↔ Shalun
  { thsr: 'thsr:1070', tra: 'tra:4340', minutes: 10 }, // Zuoying ↔ Xinzuoying
];

/** Extra stations a place name also means, beyond the stations literally called that. */
const PLACE_ALIASES: Readonly<Record<string, readonly RailNode[]>> = {
  高雄: ['thsr:1070'],
  kaohsiung: ['thsr:1070'],
  左營: ['tra:4340'],
  新左營: ['thsr:1070'],
  烏日: ['tra:3340', 'thsr:1040'],
  新烏日: ['thsr:1040'],
  六家: ['thsr:1030'],
  沙崙: ['thsr:1060'],
};

const THSR_WORDS = /高鐵|高铁|thsr|hsr/iu;
const TRA_WORDS = /臺鐵|台鐵|台铁|火車|火车|\btra\b/iu;
const SUFFIXES = /(火車站|車站|车站|站|main station|railway station|station)$/u;

/** The form names are compared in: NFKC, no spaces, one spelling of Tai, lower case, no trailing "station". */
export function normalizePlace(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
    .replace(/[臺]/gu, '台')
    .replace(SUFFIXES, '')
    .replace(/\s+/gu, '')
    .trim();
}

interface StationEntry {
  node: RailNode;
  zh: string;
  en: string;
}

const STATIONS: readonly StationEntry[] = [
  ...THSR_STATIONS.map((s) => ({ node: railNode('thsr', s.id), zh: s.zh, en: s.en })),
  ...TRA_STATION_ROWS.map(([id, zh, en]) => ({ node: railNode('tra', id), zh, en })),
];

const BY_NODE = new Map<RailNode, StationEntry>(STATIONS.map((s) => [s.node, s]));

function buildIndex(): Map<string, RailNode[]> {
  const index = new Map<string, RailNode[]>();
  const add = (key: string, node: RailNode): void => {
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.includes(node)) list.push(node);
    index.set(key, list);
  };
  for (const station of STATIONS) {
    add(normalizePlace(station.zh), station.node);
    add(normalizePlace(station.en), station.node);
  }
  for (const [name, nodes] of Object.entries(PLACE_ALIASES)) {
    for (const node of nodes) add(normalizePlace(name), node);
  }
  return index;
}

const INDEX = buildIndex();

export interface ResolvedPlace {
  query: string;
  nodes: RailNode[];
}

export interface UnresolvedPlace {
  query: string;
  suggestions: string[];
}

/** Station names sharing the most characters with what was typed, for the "did you mean" list. */
function suggest(key: string, limit = 5): string[] {
  const chars = new Set([...key]);
  const scored = STATIONS
    .map((s) => {
      const name = normalizePlace(s.zh);
      const common = [...new Set([...name])].filter((c) => chars.has(c)).length;
      const contains = name.includes(key) || key.includes(name) ? 2 : 0;
      return { name: s.zh, score: common + contains };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((entry) => entry.name))].slice(0, limit);
}

/**
 * Every station a place name means. A name with an operator in it ("THSR Zuoying") keeps only
 * that operator's stations; `modes` narrows further. A name nothing matches comes back with suggestions instead.
 */
export function resolvePlace(text: string, modes: readonly RailMode[] = ['thsr', 'tra']): ResolvedPlace | UnresolvedPlace {
  const query = text.trim();
  let allowed = modes;
  const wantsThsr = THSR_WORDS.test(query);
  const wantsTra = TRA_WORDS.test(query);
  if (wantsThsr !== wantsTra) allowed = modes.filter((mode) => mode === (wantsThsr ? 'thsr' : 'tra'));
  const bare = query.replace(new RegExp(THSR_WORDS.source, 'giu'), '').replace(new RegExp(TRA_WORDS.source, 'giu'), '');
  const key = normalizePlace(bare);
  const nodes = (INDEX.get(key) ?? []).filter((node) => allowed.includes(nodeMode(node)));
  if (nodes.length > 0) return { query, nodes };
  return { query, suggestions: suggest(key) };
}

export function isResolved(place: ResolvedPlace | UnresolvedPlace): place is ResolvedPlace {
  return 'nodes' in place;
}

/** A station's printed name; TRA and THSR each keep their own spelling of Tai. */
export function stationName(node: RailNode, lang: 'zh' | 'en' = 'zh'): string {
  const station = BY_NODE.get(node);
  if (!station) return nodeId(node);
  return lang === 'en' ? station.en : station.zh;
}

export function isKnownStation(node: RailNode): boolean {
  return BY_NODE.has(node);
}

/** The id THSR's own site uses for a THSR station key. */
export function thsrWebCode(node: RailNode): string | undefined {
  return THSR_STATIONS.find((s) => node === railNode('thsr', s.id))?.web;
}

/** The THSR station key a name printed by THSR's site stands for. */
export function thsrNodeByName(name: string): RailNode | undefined {
  const key = normalizePlace(name);
  const station = THSR_STATIONS.find((s) => normalizePlace(s.zh) === key || normalizePlace(s.en) === key);
  return station ? railNode('thsr', station.id) : undefined;
}

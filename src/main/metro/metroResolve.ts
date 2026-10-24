/**
 * What a rider types → metro stations. People write a station the way they say it: with or
 * without 站, either Tai, with the operator in front (機捷台北車站), by a landmark (101, 第二航廈),
 * by an old name still on signs (西子灣), or mistyped (台北車占). A name can be two stations
 * (台北車站 is Taipei Metro's and the airport line's; 市政府 is in Taipei and Taichung) — every
 * match comes back and the planner keeps the pairs in one city. Nothing matched gives the closest
 * names instead, for the model to ask; one clear single-character slip is taken and reported.
 */
import type { MetroNetwork, MetroStation } from './metroTypes';

/** Operator words a rider puts before a name, and the networks each one means. */
const OPERATOR_WORDS: readonly (readonly [RegExp, readonly MetroNetwork[]])[] = [
  [/台北捷運|臺北捷運|北捷|taipei\s*metro|\btrtc\b/giu, ['trtc']],
  [/環狀線/gu, ['trtc']],
  [/機場捷運|機捷|桃園捷運|桃捷|airport\s*mrt|\btymc\b/giu, ['tymc']],
  [/淡海輕軌|danhai\s*lrt/giu, ['danhai']],
  [/安坑輕軌|ankeng\s*lrt/giu, ['ankeng']],
  [/三鶯線|sanying\s*line/giu, ['sanying']],
  [/台中捷運|臺中捷運|中捷|taichung\s*mrt/giu, ['tmrt']],
  [/環狀輕軌|高雄輕軌/gu, ['klrt']],
  [/高雄捷運|高捷|kaohsiung\s*mrt|\bkrtc\b/giu, ['krtc', 'klrt']],
  [/輕軌|\blrt\b/giu, ['danhai', 'ankeng', 'klrt']],
];

/** Words that only say "metro" and narrow nothing. */
const GENERIC_WORDS = /捷運站|捷運|\bmrt\b|\bmetro\b/giu;

/** The form names are compared in: NFKC, lower case, one Tai, no spaces or punctuation, no trailing 站/station. */
export function normalizeMetroName(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/臺/gu, '台')
    .replace(/[\s·・\-_'"「」『』()（）[\]]/gu, '')
    .replace(/station$/u, '')
    .replace(/(?<!車)站$/u, '')
    .trim();
}

/** A landmark or everyday name → the stations it means, by network and the operator's own name. */
export interface MetroAlias {
  words: readonly string[];
  stations: readonly { network: MetroNetwork; zh: string }[];
}

export interface MetroIndex {
  stations: readonly MetroStation[];
  keys: ReadonlyMap<string, readonly MetroStation[]>;
  /** Every key each station answers to (names, codes, aliases). */
  keysOf: ReadonlyMap<MetroStation, readonly string[]>;
}

function addKey(keys: Map<string, MetroStation[]>, key: string, station: MetroStation): void {
  if (!key) return;
  const list = keys.get(key) ?? [];
  if (!list.includes(station)) list.push(station);
  keys.set(key, list);
}

/** Every name a station answers to: its names, each part of a 甲/乙 name, without 車站, its codes, its old names. */
function stationKeys(station: MetroStation): string[] {
  const names = [station.zh, ...(station.formerZh ?? [])];
  const keys = new Set<string>();
  for (const name of names) {
    keys.add(normalizeMetroName(name));
    for (const part of name.split(/[/／]/u)) keys.add(normalizeMetroName(part));
    if (name.endsWith('車站') && name.length > 3) keys.add(normalizeMetroName(name.slice(0, -2)));
  }
  keys.add(normalizeMetroName(station.en));
  for (const part of station.en.split('/')) keys.add(normalizeMetroName(part));
  for (const code of station.codes) keys.add(code.toLowerCase());
  return [...keys].filter(Boolean);
}

/** Builds the index; an alias naming a station that does not exist throws (a test runs this). */
export function buildMetroIndex(stations: readonly MetroStation[], aliases: readonly MetroAlias[]): MetroIndex {
  const keys = new Map<string, MetroStation[]>();
  for (const station of stations) for (const key of stationKeys(station)) addKey(keys, key, station);
  for (const alias of aliases) {
    const targets = alias.stations.map(({ network, zh }) => {
      const found = stations.find((s) => s.network === network && s.zh === zh);
      if (!found) throw new Error(`Metro alias ${alias.words[0]}: no ${network} station named ${zh}`);
      return found;
    });
    for (const word of alias.words) for (const target of targets) addKey(keys, normalizeMetroName(word), target);
  }
  const keysOf = new Map<MetroStation, string[]>();
  for (const [key, list] of keys) for (const station of list) keysOf.set(station, [...(keysOf.get(station) ?? []), key]);
  return { stations, keys, keysOf };
}

/**
 * A name made of two names riders use, the first narrowing to a place and the second picking
 * within it: 桃機二航 (桃機 → both terminals, 二航 → T2), "Taoyuan airport T1", "Taoyuan Airport
 * Terminal 1" (the rest only has to be part of one of the place's names).
 */
function compoundMatch(index: MetroIndex, key: string, allowed: readonly MetroNetwork[]): MetroStation[] {
  const chars = [...key];
  for (let i = chars.length - 1; i >= 2; i--) {
    const place = (index.keys.get(chars.slice(0, i).join('')) ?? []).filter((s) => allowed.includes(s.network));
    const rest = chars.slice(i).join('');
    if (place.length < 2 || [...rest].length < 2) continue;
    const exact = index.keys.get(rest) ?? [];
    const picked = place.filter((s) => exact.includes(s) || (index.keysOf.get(s) ?? []).some((k) => k.includes(rest)));
    if (picked.length > 0 && picked.length < place.length) return picked;
  }
  return [];
}

/**
 * Edit distance to the closest stretch of `name` as long as `key` (±1): 漁人馬頭 is one edit from
 * the 漁人碼頭 inside 淡水漁人碼頭, though four from the whole name.
 */
export function partialDistance(key: string, name: string): number {
  const k = [...key];
  const n = [...name];
  if (n.length <= k.length) return editDistance(key, name);
  let best = Number.POSITIVE_INFINITY;
  for (let len = Math.max(1, k.length - 1); len <= Math.min(n.length, k.length + 1); len++) {
    for (let start = 0; start + len <= n.length; start++) {
      best = Math.min(best, editDistance(key, n.slice(start, start + len).join('')));
    }
  }
  return best;
}

export interface ResolvedStations {
  query: string;
  stations: MetroStation[];
  /** Set when a mistyped name was taken as this one. */
  correctedTo?: string;
}

export interface UnresolvedStations {
  query: string;
  suggestions: string[];
}

export function isResolvedStations(result: ResolvedStations | UnresolvedStations): result is ResolvedStations {
  return 'stations' in result;
}

/** Edit distance, for "did you mean"; names are short, so the plain table is fine. */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[y.length];
}

/** How a station is shown in a list: its codes, name and network. */
export function stationLabel(station: MetroStation, networkName: (network: MetroNetwork) => string): string {
  return `${station.codes.join('/')} ${station.zh}（${networkName(station.network)}）`;
}

interface Scored {
  name: string;
  distance: number;
  contains: boolean;
  stations: MetroStation[];
}

/**
 * Taiwan's cities and counties, as normalised names start with them. 台中車站 is one character
 * from 台北車站, but that character is the city: a real station elsewhere, never a slip.
 */
const CITY_PREFIXES = [
  '台北', '新北', '基隆', '桃園', '新竹', '苗栗', '台中', '彰化', '南投', '雲林', '嘉義',
  '台南', '高雄', '屏東', '宜蘭', '花蓮', '台東', '澎湖', '金門', '馬祖', '連江',
] as const;

/**
 * Prefixes that name one metro area. Taipei Metro serves both cities, and many 台北-named
 * stations stand in New Taipei (台北橋, 臺北大學, 台北海洋大學), so 台北產業園區 is a slip for
 * 新北產業園區, not another city's station.
 */
const SAME_AREA: Readonly<Record<string, string>> = { 新北: '台北' };

function cityOf(name: string): string | undefined {
  const city = CITY_PREFIXES.find((prefix) => name.startsWith(prefix));
  return city === undefined ? undefined : SAME_AREA[city] ?? city;
}

/** A candidate named for a different city than the one the rider's name starts with. */
function otherCity(key: string, candidate: string): boolean {
  const city = cityOf(key);
  if (!city) return false;
  const theirs = cityOf(normalizeMetroName(candidate));
  return theirs !== undefined && theirs !== city;
}

/** Station names (grouped: one name in two networks is one candidate) ranked by closeness to `key`. */
function rank(index: MetroIndex, key: string, allowed: readonly MetroNetwork[]): Scored[] {
  const byName = new Map<string, Scored>();
  const latin = /^[a-z0-9]+$/u.test(key);
  for (const station of index.stations) {
    if (!allowed.includes(station.network)) continue;
    const name = normalizeMetroName(latin ? station.en : station.zh);
    const distance = Math.min(editDistance(key, name), partialDistance(key, name));
    const contains = key.length >= 2 && (name.includes(key) || key.includes(name));
    const entry = byName.get(station.zh) ?? { name: station.zh, distance, contains, stations: [] };
    entry.distance = Math.min(entry.distance, distance);
    entry.contains ||= contains;
    entry.stations.push(station);
    byName.set(station.zh, entry);
  }
  // A two-character name one character off is any station sharing a character (東京 → 東湖, 東門):
  // too short to suggest anything but names containing it.
  const length = [...key].length;
  const limit = length <= 2 ? 0 : Math.floor(length / 2);
  return [...byName.values()]
    .filter((entry) => entry.contains || entry.distance <= limit)
    .sort((a, b) => Number(b.contains) - Number(a.contains) || a.distance - b.distance);
}

/**
 * The tools' own station labels, when a model passes one back: "A1 台北車站",
 * "BL12/R10 台北車站（台北捷運）", "103a 北屯總站（台中捷運）" (live eval 2026-10-22: two calls failed on it).
 */
const STATION_LABEL = /^((?:[A-Za-z]{0,2}\d+[A-Za-z]?\/)*[A-Za-z]{0,2}\d+[A-Za-z]?)\s+(.+?)\s*(?:[（(]([^）)]+)[）)])?$/u;

/**
 * Every station `text` means. Operator words narrow the networks (and are removed from the
 * name); `networks` narrows further. A name nothing matches: one candidate exactly one character
 * off (and nothing else that close) is taken as `correctedTo`; otherwise up to five suggestions.
 */
export function resolveMetroStation(
  index: MetroIndex,
  text: string,
  networkName: (network: MetroNetwork) => string,
  networks?: readonly MetroNetwork[],
): ResolvedStations | UnresolvedStations {
  const label = STATION_LABEL.exec(text.trim());
  if (label) {
    // The bracket is one of the tools' own network names (桃園機場捷運…): narrow to it, read the
    // name, then keep the stations that carry the label's codes.
    const codes = label[1].toLowerCase().split('/');
    const system = label[3] ? normalizeMetroName(label[3]) : '';
    const all = [...new Set(index.stations.map((s) => s.network))];
    const inSystem = system ? all.filter((n) => normalizeMetroName(networkName(n)) === system) : [];
    const scope = inSystem.length > 0 ? inSystem.filter((n) => !networks || networks.includes(n)) : networks;
    const named = resolveText(index, label[2], networkName, scope);
    if (isResolvedStations(named)) {
      const coded = named.stations.filter((s) => s.codes.some((c) => codes.includes(c.toLowerCase())));
      return { ...named, query: text.trim(), stations: coded.length > 0 ? coded : named.stations };
    }
  }
  return resolveText(index, text, networkName, networks);
}

function resolveText(
  index: MetroIndex,
  text: string,
  networkName: (network: MetroNetwork) => string,
  networks?: readonly MetroNetwork[],
): ResolvedStations | UnresolvedStations {
  const query = text.trim();
  let allowed: readonly MetroNetwork[] = networks ?? [...new Set(index.stations.map((s) => s.network))];
  let bare = query;
  for (const [pattern, nets] of OPERATOR_WORDS) {
    if (!new RegExp(pattern.source, pattern.flags).test(bare)) continue;
    const narrowed = allowed.filter((network) => nets.includes(network));
    if (narrowed.length > 0) allowed = narrowed;
    bare = bare.replace(new RegExp(pattern.source, pattern.flags), ' ');
  }
  bare = bare.replace(GENERIC_WORDS, ' ');
  const key = normalizeMetroName(bare);
  if (!key) return { query, suggestions: [] };
  const exact = (index.keys.get(key) ?? []).filter((station) => allowed.includes(station.network));
  if (exact.length > 0) return { query, stations: [...exact] };
  const compound = compoundMatch(index, key, allowed);
  if (compound.length > 0) return { query, stations: compound };
  const all = rank(index, key, allowed);
  const ranked = all.filter((entry) => !otherCity(key, entry.name));
  const [best] = ranked;
  // Another city's station is never the answer, but still a rival: dropping it must not turn a
  // question into a guess (台中橋 is as close to 台北橋 as to 高鐵臺中站).
  const rival = all.some((entry) => entry !== best && (entry.contains || entry.distance <= 1));
  // Ranked with containment first, so a best match that merely contains the key never gets here.
  if (best && !best.contains && best.distance === 1 && [...key].length >= 3 && !rival) {
    return { query, stations: best.stations, correctedTo: best.name };
  }
  const suggestions = ranked.slice(0, 5).flatMap((entry) => entry.stations.slice(0, 2).map((s) => stationLabel(s, networkName)));
  return { query, suggestions: [...new Set(suggestions)].slice(0, 6) };
}

import type { GeocodedPlace } from './dataSources';
import { TAIWAN_CHAR_FOLD, TAIWAN_TOWNS } from './taiwanPlacesData';

/** Seat of each county-level government; a bare county name resolves to this township. */
export const COUNTY_SEATS: Readonly<Record<string, string>> = {
  臺北市: '信義區', 新北市: '板橋區', 桃園市: '桃園區', 臺中市: '西屯區', 臺南市: '安平區', 高雄市: '苓雅區',
  基隆市: '中正區', 新竹市: '北區', 嘉義市: '東區',
  新竹縣: '竹北市', 苗栗縣: '苗栗市', 彰化縣: '彰化市', 南投縣: '南投市', 雲林縣: '斗六市', 嘉義縣: '太保市',
  屏東縣: '屏東市', 宜蘭縣: '宜蘭市', 花蓮縣: '花蓮市', 臺東縣: '臺東市', 澎湖縣: '馬公市', 金門縣: '金城鎮',
  連江縣: '南竿鄉',
};

/**
 * Default county for a name shared by several (keyed by `stemOf`): a special municipality
 * (直轄市) over a provincial city or county, then the more populous district. 新竹／嘉義 alone
 * mean the city, not the county. A bare 仁愛 means 南投's 仁愛鄉 (合歡山, 清境), where people check
 * mountain weather; 基隆's district is still reached as 仁愛區.
 */
export const AMBIGUOUS_DEFAULTS: Readonly<Record<string, string>> = {
  中山: '臺北市', 中正: '臺北市', 信義: '臺北市', 大同: '臺北市', 大安: '臺北市',
  仁愛: '南投縣', 東勢: '臺中市',
  北區: '臺中市', 南區: '臺中市', 西區: '臺中市', 東區: '臺南市',
  新竹: '新竹市', 嘉義: '嘉義市',
};

const COUNTRY = '臺灣';
const SUFFIXES = new Set(['市', '縣', '區', '鄉', '鎮', '县', '区', '乡', '镇']);

interface Town { county: string; town: string; latitude: number; longitude: number }

interface PlaceIndex {
  /** Folded full and suffix-less county names → counties, in table order. */
  counties: Map<string, string[]>;
  /** Folded full and suffix-less township names → townships, in table order. */
  towns: Map<string, Town[]>;
  /** County keys, longest first, for splitting "高雄鳳山" into county + township. */
  countyPrefixes: string[];
  seats: Map<string, Town>;
  defaults: Map<string, string>;
}

let index: PlaceIndex | null = null;
let charFold: Map<string, string> | null = null;

/** The suffix-less form when at least two characters remain (東區 stays 東區); also the ambiguity key. */
export function stemOf(name: string): string {
  return name.length >= 3 && SUFFIXES.has(name.slice(-1)) ? name.slice(0, -1) : name;
}

/** Traditional and Simplified spellings of the table's characters folded together (臺→台, 橋→桥). */
function fold(text: string): string {
  if (!charFold) {
    const chars = [...TAIWAN_CHAR_FOLD];
    charFold = new Map();
    for (let i = 0; i + 1 < chars.length; i += 2) charFold.set(chars[i], chars[i + 1]);
  }
  const map = charFold;
  return [...text].map((c) => map.get(c) ?? c).join('');
}

function addKey<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}

function buildIndex(): PlaceIndex {
  const counties = new Map<string, string[]>();
  const towns = new Map<string, Town[]>();
  const seats = new Map<string, Town>();
  for (const [county, town, latitude, longitude] of TAIWAN_TOWNS) {
    const entry: Town = { county, town, latitude, longitude };
    addKey(counties, fold(county), county);
    addKey(counties, fold(stemOf(county)), county);
    addKey(towns, fold(town), entry);
    addKey(towns, fold(stemOf(town)), entry);
    if (COUNTY_SEATS[county] === town) seats.set(county, entry);
  }
  const countyPrefixes = [...counties.keys()].sort((a, b) => b.length - a.length);
  const defaults = new Map(Object.entries(AMBIGUOUS_DEFAULTS).map(([key, county]) => [fold(key), county]));
  return { counties, towns, countyPrefixes, seats, defaults };
}

function getIndex(): PlaceIndex {
  index ??= buildIndex();
  return index;
}

/** Whitespace and list commas dropped, characters folded, a leading or trailing 臺灣 dropped. */
export function normalizeTaiwanPlace(input: string): string {
  const country = fold(COUNTRY);
  let name = fold(input.replace(/[\s,，、]+/gu, ''));
  if (name.startsWith(country)) name = name.slice(country.length);
  if (name.endsWith(country)) name = name.slice(0, -country.length);
  return name;
}

function pickDefault<T>(idx: PlaceIndex, key: string, candidates: T[], countyOf: (c: T) => string): T {
  if (candidates.length === 1) return candidates[0];
  const preferred = idx.defaults.get(stemOf(key));
  return candidates.find((c) => countyOf(c) === preferred) ?? candidates[0];
}

function townPlace(t: Town): GeocodedPlace {
  return { displayName: `${t.county}${t.town}, ${COUNTRY}`, countryCode: 'TW', latitude: t.latitude, longitude: t.longitude };
}

function countyPlace(idx: PlaceIndex, county: string): GeocodedPlace | null {
  const seat = idx.seats.get(county);
  if (!seat) return null;
  return { displayName: `${county}, ${COUNTRY}`, countryCode: 'TW', latitude: seat.latitude, longitude: seat.longitude };
}

/**
 * Resolves a Taiwan county or township written in Chinese, Traditional or Simplified (「高雄」
 * 「板橋區」「台中大安」「新北市板橋區」「板桥」) from the bundled table. A name shared by several counties takes the
 * documented default, and the display name always carries the county.
 */
export function lookupTaiwanPlace(input: string): GeocodedPlace | null {
  const name = normalizeTaiwanPlace(input);
  if (!name) return null;
  const idx = getIndex();

  const counties = idx.counties.get(name);
  if (counties) return countyPlace(idx, pickDefault(idx, name, counties, (c) => c));

  const towns = idx.towns.get(name);
  if (towns) return townPlace(pickDefault(idx, name, towns, (t) => t.county));

  for (const prefix of idx.countyPrefixes) {
    if (!name.startsWith(prefix) || name.length === prefix.length) continue;
    const rest = name.slice(prefix.length);
    for (const county of idx.counties.get(prefix) ?? []) {
      const hit = idx.towns.get(rest)?.find((t) => t.county === county);
      if (hit) return townPlace(hit);
    }
  }
  return null;
}

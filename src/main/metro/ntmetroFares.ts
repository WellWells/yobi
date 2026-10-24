/**
 * New Taipei Metro's fares, baked: they change by public notice, not daily, and two of the three
 * are only published as an image or an ODT sentence list. The release self-test re-reads
 * the official files and fails when they no longer match.
 *
 * - 淡海輕軌 / 安坑輕軌: the "詳細資料" ODT on node 10105 / 10106 (淡海輕軌票價資訊(2).odt,
 *   安坑輕軌票價資訊.odt, read 2026-10-22), one sentence per origin ("V01紅樹林至竿蓁林、…等站皆為20元").
 *   Keyed by station NAME: the 安坑 file prints 十四張's row as "K01十四張至…" (it is K09).
 * - 三鶯線: only an image on node 10166 (三鶯線梯形票價表(黑字)定稿, Last-Modified 2026-06-09),
 *   transcribed and checked cell by cell; 20–35 元 matches the 2026-08-28 news (起程20元、最高35元).
 */
import type { MetroNetwork, MetroStation, TicketPrice } from './metroTypes';
import { ANKENG_STATIONS, DANHAI_STATIONS, SANYING_STATIONS } from './ntmetroStations';

export const NTMETRO_FARE_PAGES = {
  danhai: 'https://www.ntmetro.com.tw/basic/?node=10105',
  ankeng: 'https://www.ntmetro.com.tw/basic/?node=10106',
  sanying: 'https://www.ntmetro.com.tw/basic/?node=10166',
} as const;

/** 車票說明 (ticket kinds and concessions). */
export const NTMETRO_TICKETS_PAGE = 'https://www.ntmetro.com.tw/basic/?node=10102';

/** The 三鶯 fare image as baked; the self-test compares the live page's link and Last-Modified to these. */
export const SANYING_FARE_IMAGE = {
  file: '/archive/file/5LiJ6bav57ea5qKv5b2i56Wo5YO56KGoKOm7keWtlynlrprnqL8uMDk5MDAxMzI3.jpg',
  lastModified: 'Tue, 09 Jun 2026 07:26:53 GMT',
} as const;

type NtmetroFareNetwork = 'danhai' | 'ankeng' | 'sanying';

/**
 * Row = from, column = to, both in the station list's order (V01–V11, V26, V27, V28). Not symmetric:
 * the ODT says 淡水漁人碼頭 → 紅樹林 25 元 but 紅樹林 → 淡水漁人碼頭 30 元; the trapezoid image on the
 * same page shows 30 both ways. Kept as the text says and flagged in the quote's notes.
 */
const DANHAI_MATRIX: readonly (readonly number[])[] = [
  [0, 20, 20, 20, 20, 20, 20, 25, 25, 25, 25, 30, 25, 25],
  [20, 0, 20, 20, 20, 20, 20, 20, 25, 25, 25, 25, 25, 25],
  [20, 20, 0, 20, 20, 20, 20, 20, 20, 20, 25, 25, 25, 20],
  [20, 20, 20, 0, 20, 20, 20, 20, 20, 20, 20, 25, 20, 20],
  [20, 20, 20, 20, 0, 20, 20, 20, 20, 20, 20, 25, 20, 20],
  [20, 20, 20, 20, 20, 0, 20, 20, 20, 20, 20, 20, 20, 20],
  [20, 20, 20, 20, 20, 20, 0, 20, 20, 20, 20, 20, 20, 20],
  [25, 20, 20, 20, 20, 20, 20, 0, 20, 20, 20, 20, 20, 20],
  [25, 25, 20, 20, 20, 20, 20, 20, 0, 20, 20, 20, 20, 20],
  [25, 25, 20, 20, 20, 20, 20, 20, 20, 0, 20, 20, 20, 20],
  [25, 25, 25, 20, 20, 20, 20, 20, 20, 20, 0, 20, 20, 20],
  [25, 25, 25, 25, 25, 20, 20, 20, 20, 20, 20, 0, 20, 20],
  [25, 25, 25, 20, 20, 20, 20, 20, 20, 20, 20, 20, 0, 20],
  [25, 25, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 0],
];

/** K01–K09; symmetric. */
const ANKENG_MATRIX: readonly (readonly number[])[] = [
  [0, 20, 20, 20, 20, 20, 20, 25, 25],
  [20, 0, 20, 20, 20, 20, 20, 25, 25],
  [20, 20, 0, 20, 20, 20, 20, 20, 25],
  [20, 20, 20, 0, 20, 20, 20, 20, 25],
  [20, 20, 20, 20, 0, 20, 20, 20, 20],
  [20, 20, 20, 20, 20, 0, 20, 20, 20],
  [20, 20, 20, 20, 20, 20, 0, 20, 20],
  [25, 25, 20, 20, 20, 20, 20, 0, 20],
  [25, 25, 25, 25, 20, 20, 20, 20, 0],
];

/** The image's triangle: row LB02..LB12, columns LB01..(row − 1); the image prints one price per pair. */
const SANYING_TRIANGLE: readonly (readonly number[])[] = [
  [20],
  [20, 20],
  [20, 20, 20],
  [20, 20, 20, 20],
  [25, 20, 20, 20, 20],
  [25, 25, 20, 20, 20, 20],
  [30, 30, 25, 25, 25, 20, 20],
  [30, 30, 30, 25, 25, 20, 20, 20],
  [35, 30, 30, 25, 25, 25, 20, 20, 20],
  [35, 35, 30, 30, 30, 25, 25, 20, 20, 20],
  [35, 35, 35, 30, 30, 30, 25, 20, 20, 20, 20],
];

function sanyingMatrix(): number[][] {
  const size = SANYING_TRIANGLE.length + 1;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  SANYING_TRIANGLE.forEach((row, i) => row.forEach((fare, j) => {
    matrix[i + 1][j] = fare;
    matrix[j][i + 1] = fare;
  }));
  return matrix;
}

const TABLES: Record<NtmetroFareNetwork, { stations: readonly MetroStation[]; matrix: readonly (readonly number[])[] }> = {
  danhai: { stations: DANHAI_STATIONS, matrix: DANHAI_MATRIX },
  ankeng: { stations: ANKENG_STATIONS, matrix: ANKENG_MATRIX },
  sanying: { stations: SANYING_STATIONS, matrix: sanyingMatrix() },
};

function isFareNetwork(network: MetroNetwork): network is NtmetroFareNetwork {
  return network in TABLES;
}

/** Full adult fare in NT$ (card and single ticket alike); undefined for an unknown pair or the same station. */
export function fareBetween(network: MetroNetwork, fromCode: string, toCode: string): number | undefined {
  if (!isFareNetwork(network) || fromCode === toCode) return undefined;
  const { stations, matrix } = TABLES[network];
  const from = stations.findIndex((s) => s.codes.includes(fromCode));
  const to = stations.findIndex((s) => s.codes.includes(toCode));
  if (from < 0 || to < 0) return undefined;
  return matrix[from][to];
}

/** Every baked pair as `FROM>TO` → NT$, for comparing with a freshly parsed file. */
export function bakedFares(network: NtmetroFareNetwork): Map<string, number> {
  const { stations, matrix } = TABLES[network];
  const out = new Map<string, number>();
  stations.forEach((from, i) => stations.forEach((to, j) => {
    if (i !== j) out.set(`${from.codes[0]}>${to.codes[0]}`, matrix[i][j]);
  }));
  return out;
}

const SENTENCE = /^(?:[A-Z]{1,2}\d{2})?(.+?)至(.+?)(?:等站皆為|站為|為)(\d+)元$/u;

/**
 * The fare ODT's sentences (one per line) → `FROM>TO` → NT$. Names are matched, printed codes
 * ignored. Throws on a sentence it cannot read or a station name it does not know.
 */
export function parseFareSentences(text: string, stations: readonly MetroStation[]): Map<string, number> {
  const byName = new Map(stations.map((s) => [s.zh, s.codes[0]]));
  const code = (name: string) => {
    const found = byName.get(name.trim().replace(/站$/u, ''));
    if (!found) throw new Error(`Fare text names an unknown station "${name}"`);
    return found;
  };
  const out = new Map<string, number>();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/\s+/gu, '');
    if (!line.includes('元')) continue;
    const match = SENTENCE.exec(line);
    if (!match) throw new Error(`Unreadable fare sentence "${line}"`);
    const from = code(match[1]);
    for (const to of match[2].split('、')) out.set(`${from}>${code(to)}`, Number(match[3]));
  }
  return out;
}

/** Concessions on node 10102 (read 2026-10-22): e-ticket 敬老／愛心／兒童 cards pay 40%; 優待單程票 50%. */
const CARD_CONCESSION = 0.4;
const SINGLE_CONCESSION = 0.5;
const DAY_PASS: Record<NtmetroFareNetwork, number> = { danhai: 50, ankeng: 50, sanying: 60 };
/** 淡海／安坑 only: rider plus bicycle, any distance. */
const BICYCLE_TICKET_NTD = 50;

/**
 * The other ticket kinds node 10102 prices for a full `fare`, named as the page names them. A 50%
 * single ticket of an odd fare (12.5) is left out: the page does not say how it rounds.
 */
export function ntmetroTickets(network: MetroNetwork, fare: number): TicketPrice[] {
  if (!isFareNetwork(network)) return [];
  const card = Math.round(fare * CARD_CONCESSION * 100) / 100;
  const single = fare * SINGLE_CONCESSION;
  return [
    { kind: '敬老卡／愛心卡／愛心陪伴卡（電子票證4折）', ntd: card },
    { kind: '新北市兒童卡／臺北市兒童優惠卡（4折）', ntd: card },
    ...(Number.isInteger(single) ? [{ kind: '優待單程票（敬老／愛心，5折）', ntd: single }] : []),
    { kind: network === 'sanying' ? '三鶯線一日票' : '輕軌一日票（淡海＋安坑）', ntd: DAY_PASS[network] },
    ...(network === 'sanying' ? [] : [{ kind: '自行車單程票', ntd: BICYCLE_TICKET_NTD }]),
  ];
}

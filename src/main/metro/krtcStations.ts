/**
 * Kaohsiung's two fare systems as KRTC's own site lists them (2026-10-22): the MRT's Red (R) and
 * Orange (O) lines, one network, and the Circular Light Rail (C). Codes and Chinese names are the
 * station pickers' (`/Home/GetLineList?id=R|O|C`), English the English site's (`/eng/Home/GetLineList`
 * for R and O; its id=C answers the Orange list, so the light rail's English is the English home
 * page's KLRTStartStation picker). Rows are in line order: R3 小港 → RK1 岡山車站, O1 哈瑪星 → OT1
 * 大寮, and the ring C1 籬仔內 → C37 輕軌機廠 with C21A between C20 and C21, as the picker lists it.
 *
 * 美麗島 is one station (R10 / O5) and one row; KRTC's fare map calls it `o5r10`. `ref` is the id
 * the fare map (`stationtime.ashx?stationId=`) takes: the code in lower case. The fare map and the
 * English pickers still print old names (O1 西子灣, O4 市議會, O9 技擊館, R19 楠梓加工區, R24 南岡山);
 * they are `formerZh`, and stations are joined on codes only.
 */
import type { MetroStation } from './metroTypes';

/** Codes, zh, en, former names. */
type Row = readonly [codes: string, zh: string, en: string, former?: string];

const RED: readonly Row[] = [
  ['R3', '小港', 'Siaogang'],
  ['R4', '高雄國際機場', 'Kaohsiung International Airport'],
  ['R4A', '草衙', 'Caoya'],
  ['R5', '前鎮高中', 'Cianjhen Senior High School'],
  ['R6', '凱旋', 'Kaisyuan'],
  ['R7', '獅甲', 'Shihjia'],
  ['R8', '三多商圈', 'Sanduo Shopping District'],
  ['R9', '中央公園', 'Central Park'],
  ['R10 O5', '美麗島', 'Formosa Boulevard'],
  ['R11', '高雄車站', 'Kaohsiung Main Station'],
  ['R12', '後驛', 'Houyi'],
  ['R13', '凹子底', 'Aozihdi'],
  ['R14', '巨蛋', 'Kaohsiung Arena'],
  ['R15', '生態園區', 'Ecological District'],
  ['R16', '左營', 'Zuoying'],
  ['R17', '世運', 'World Games'],
  ['R18', '油廠國小', 'Oil Refinery Elementary School'],
  ['R19', '楠梓科技園區', 'Nanzih Technology Industrial Park', '楠梓加工區'],
  ['R20', '後勁', 'Houjing'],
  ['R21', '都會公園', 'Metropolitan Park'],
  ['R22', '青埔', 'Cingpu'],
  ['R22A', '橋頭糖廠', 'Ciaotou Sugar Refinery'],
  ['R23', '橋頭火車站', 'Ciaotou Station'],
  ['R24', '岡山高醫', 'Kaohsiung Medical University Gangshan Hospital', '南岡山'],
  ['RK1', '岡山車站', 'Gangshan Station'],
];

const ORANGE: readonly Row[] = [
  ['O1', '哈瑪星', 'Hamasen', '西子灣'],
  ['O2', '鹽埕埔', 'Yanchengpu'],
  ['O4', '前金', 'Cianjin', '市議會'],
  ['O6', '信義國小', 'Sinyi Elementary School'],
  ['O7', '文化中心', 'Cultural Center'],
  ['O8', '五塊厝', 'Wukuaicuo'],
  ['O9', '苓雅運動園區', 'Lingya Sports Park', '技擊館'],
  ['O10', '衛武營', 'Weiwuying'],
  ['O11', '鳳山西站(高雄市議會)', 'Fongshan West(Kaohsiung City Council)'],
  ['O12', '鳳山', 'Fongshan'],
  ['O13', '大東', 'Dadong'],
  ['O14', '鳳山國中', 'Fongshan Junior High School'],
  ['OT1', '大寮', 'Daliao'],
];

const LIGHT_RAIL: readonly Row[] = [
  ['C1', '籬仔內', 'Lizihnei'],
  ['C2', '凱旋瑞田', 'Kaisyuan Rueitian'],
  ['C3', '前鎮之星', 'Cianjhen Star'],
  ['C4', '凱旋中華', 'Kaisyuan Jhonghua'],
  ['C5', '夢時代', 'Dream Mall'],
  ['C6', '經貿園區', 'Commerce and Trade Park'],
  ['C7', '軟體園區', 'Software Technology Park'],
  ['C8', '高雄展覽館', 'Kaohsiung Exhibition Center'],
  ['C9', '旅運中心', 'Cruise Terminal'],
  ['C10', '光榮碼頭', 'Glory Pier'],
  ['C11', '真愛碼頭', 'Love Pier'],
  ['C12', '駁二大義', 'Dayi Pier-2'],
  ['C13', '駁二蓬萊', 'Penglai Pier-2'],
  ['C14', '哈瑪星', 'Hamasen'],
  ['C15', '壽山公園(金馬賓館當代美術館)', 'Shoushan Park (ALIEN Art Centre)'],
  ['C16', '文武聖殿', 'Wenwu Temple'],
  ['C17', '鼓山區公所', 'Gushan District Office'],
  ['C18', '鼓山', 'Gushan'],
  ['C19', '馬卡道', 'Makadao'],
  ['C20', '臺鐵美術館', 'TRA Museum of Fine Arts'],
  ['C21A', '內惟藝術中心', 'Neiwei Arts Center'],
  ['C21', '美術館', 'Kaohsiung Museum of Fine Arts'],
  ['C22', '聯合醫院', 'Kaohsiung Municipal United Hospital'],
  ['C23', '龍華國小', 'Longhua Elementary School'],
  ['C24', '愛河之心', 'Heart of Love River'],
  ['C25', '新上國小', 'Sinshang Elementary School'],
  ['C26', '大順民族', 'Dashun Minzu'],
  ['C27', '灣仔內(大順鼎山)', 'Wanzihnei(Dashun Dingshan)'],
  ['C28', '高雄高工', 'Kaohsiung Industrial High School'],
  ['C29', '樹德家商', 'Shu-Te Home-Economics & Commercial High School'],
  ['C30', '科工館', 'Science and Technology Museum'],
  ['C31', '聖功醫院(道明中學)', 'St.Joseph Hospital(St. Dominic Catholic High School)'],
  ['C32', '凱旋公園', 'Kaisyuan Park'],
  ['C33', '衛生局', 'Department of Health'],
  ['C34', '五權國小', 'Wucyuan Elementary School'],
  ['C35', '凱旋武昌', 'Kaisyuan Wuchang'],
  ['C36', '凱旋二聖', 'Kaisyuan Ersheng'],
  ['C37', '輕軌機廠', 'LRT Depot'],
];

/** "R22A" → "R", "OT1" → "O", "C21A" → "C". */
export function krtcLineOf(code: string): string {
  return code.charAt(0);
}

function station(network: 'krtc' | 'klrt', [codes, zh, en, former]: Row): MetroStation {
  const list = codes.split(' ');
  // The fare map knows 美麗島 as one id with the Orange code first.
  const ref = list.length > 1 ? 'o5r10' : list[0].toLowerCase();
  return { network, codes: list, zh, en, lines: list.map(krtcLineOf), ref, ...(former ? { formerZh: [former] } : {}) };
}

export const KRTC_STATIONS: readonly MetroStation[] = [
  ...RED.map((row) => station('krtc', row)),
  ...ORANGE.map((row) => station('krtc', row)),
];

export const KLRT_STATIONS: readonly MetroStation[] = LIGHT_RAIL.map((row) => station('klrt', row));

/** The Red line R3 → RK1 and the Orange line O1 → OT1 in order, 美麗島 under R10 and O5. */
export const KRTC_LINE_ORDER: Readonly<Record<'R' | 'O', readonly string[]>> = {
  R: RED.map(([codes]) => codes.split(' ')[0]),
  O: ORANGE.flatMap(([codes]) => (codes === 'O4' ? ['O4', 'O5'] : [codes])),
};

/** The ring in 順行 order (C1, C2 … C20, C21A, C21 … C37). */
export const KLRT_RING: readonly string[] = LIGHT_RAIL.map(([codes]) => codes);

/** Where the MRT and the light rail meet: KRTC's station pages list the light-rail stop among each MRT station's exits (出入口資訊 "輕軌 C3站"); all 38 MRT station pages read on 2026-10-22, these four list one. */
export const KRTC_KLRT_TRANSFERS: readonly { krtc: string; klrt: string }[] = [
  { krtc: 'R6', klrt: 'C3' }, // 凱旋 / 前鎮之星, exit 1
  { krtc: 'R13', klrt: 'C24' }, // 凹子底 / 愛河之心, exits 1 (順行) and 2 (逆行)
  { krtc: 'O1', klrt: 'C14' }, // 哈瑪星, exit 2
  { krtc: 'O8', klrt: 'C32' }, // 五塊厝 / 凱旋公園, exit 3
];

const BY_CODE = new Map([...KRTC_STATIONS, ...KLRT_STATIONS].flatMap((s) => s.codes.map((code) => [code, s] as const)));

/** Any code finds its station ("R10" and "O5" are both 美麗島). */
export function krtcStationByCode(code: string): MetroStation | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** A station picker's options (`<option value="R11">R11 高雄車站</option>`) as code → name. */
export function parseKrtcLineList(html: string): { code: string; name: string }[] {
  return [...html.matchAll(/<option value="([A-Z0-9]+)"[^>]*>([^<]*)<\/option>/gu)].map((m) => {
    const label = m[2].replace(/\s+/gu, ' ').trim();
    return { code: m[1], name: label.startsWith(`${m[1]} `) ? label.slice(m[1].length + 1).trim() : label };
  });
}

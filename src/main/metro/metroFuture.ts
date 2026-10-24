/**
 * Metro and light-rail lines riders ask about that the metro tools cannot ride: lines still being
 * planned or built (八德, 桃園綠線 G07, 新竹, 台南, 基隆 …) and one that runs but is not covered
 * (貓空纜車). Without this the station resolver offers the nearest-looking name — 新竹 → 新店,
 * G07 → Taipei's own G07 — instead of saying the line is not open. Status and dates are as the
 * building authority's own page states them (news only where no official date exists, and marked
 * 新聞); `checkPhrases` are what the release self-test still expects on those pages.
 *
 * Matching (`findFutureLines`): the text and every word go through `normalizeMetroName`.
 * `words` match anywhere in the text — line names, codes no running line uses (LB13, A23), or
 * station names no running station has. `places` are towns that say nothing alone (「新竹怎麼去」
 * is not a metro question): they match only when the whole text is the place, or the text also
 * says 捷運／輕軌／MRT／LRT／地鐵. A match directly followed by 路 or 街 is a street (八德路), not
 * the line. Codes a running line shares (G07 is Taipei's too; BR is 文湖線) are never words alone,
 * nor are bare colour names (綠線, 黃線, 棕線 all run somewhere today).
 */
import type { CheckPage } from './metroTicketRules';
import { normalizeMetroName } from './metroResolve';

export interface FutureLine {
  name: string;
  words: readonly string[];
  /** Towns that match only as the whole text or next to a metro word. */
  places?: readonly string[];
  region: 'north' | 'central' | 'south' | 'other';
  status: string;
  expected?: string;
  stations?: readonly string[];
  sources: readonly string[];
  checkedOn: string;
  kind: 'not-open' | 'not-covered';
  checkPhrases: readonly CheckPage[];
}

const CHECKED_ON = '2026-10-22';
const TYCG = 'https://dorts.tycg.gov.tw/cp.aspx?n=';
const NTPC = 'https://www.dorts.ntpc.gov.tw/about/route/';
const TAIPEI_FAQ = 'https://www.dorts.gov.taipei/News_Content.aspx?n=2A66A485FACB0D5B&s=5154D7C19D53C545';
const TAIPEI_WANDA = 'https://www.dorts.gov.taipei/cp.aspx?n=E564EC7795D2B5BC';
const TAICHUNG = 'https://tcrt.taichung.gov.tw/content/index?Parser=1,6,';
const KAOHSIUNG = 'https://mtbu.kcg.gov.tw/KaohsiungMetro/ApprovedRoutes/';
const TAINAN_TENDER = 'https://traffic.tainan.gov.tw/RTO/Announcement/bulletin?pageIndex=1&PageType=1&id=efd11295-ef6a-4570-bc0a-5ff88da42909';
const TAINAN_2024 = 'https://traffic.tainan.gov.tw/RTO/Announcement/bulletin?pageIndex=1&PageType=1&id=f5a5f6c4-b474-4461-ae6c-1620a0e53c35';
const HSINCHU = 'https://dep-traffic.hccg.gov.tw/ch/home.jsp?id=19&parentpath=0,3&mcustomize=municipalnews_view.jsp&dataserno=d83a5aab-a8ba-407e-8b43-b73b45c6a9cf&aplistdn=ou%3Dmunicipalnews,ou%3Dmessage,ou%3Dap_root,o%3Dhccg,c%3Dtw&toolsflag=Y&mserno=201601300038';

type Entry = Omit<FutureLine, 'checkedOn' | 'kind' | 'sources'> & { kind?: FutureLine['kind'] };

/** One line, its sources being the pages the self-test reads plus any news cited in `extra`. */
function line(entry: Entry, extra: readonly string[] = []): FutureLine {
  return { kind: 'not-open', ...entry, sources: [...entry.checkPhrases.map((page) => page.url), ...extra], checkedOn: CHECKED_ON };
}

function ntpcPlanned(name: string, id: string, years: string, words: readonly string[], places?: readonly string[]): FutureLine {
  return line({
    name, words, places, region: 'north', status: '規劃中（綜合規劃尚未經中央核定）', expected: `官方：綜合規劃奉中央核定後${years}年完工`,
    checkPhrases: [{ url: `${NTPC}${id}`, phrases: [`綜合規劃報告奉中央核定後${years}年完工`] }],
  });
}

export const FUTURE_LINES: readonly FutureLine[] = [
  line({
    name: '三鶯線延伸八德段', words: ['三鶯延伸', '三鶯線延伸', 'LB12a', 'LB13', 'LB14'], places: ['八德'], region: 'north',
    status: '施工前（2026-09-30 土建、機電統包決標）', expected: '預估 2034 年 8 月通車（官方：123年8月）',
    stations: ['LB12a 福德一路／和強路口（高架）', 'LB13 和強路至介壽路新闢道路（高架，尚無站名）', 'LB14 介壽路二段（地下，與桃園綠線 G04 大湳共構）'],
    checkPhrases: [{ url: `${TYCG}23135`, phrases: ['預估於123年8月通車', 'LB12a', 'LB13', 'LB14', '115年9月30日決標'] }, { url: `${NTPC}90V4drGQZqEN`, phrases: ['預計123年完工'] }],
  }),
  line({
    name: '桃園捷運綠線', words: ['桃園綠線', '桃捷綠線', '桃園捷運綠線', '藝文特區', '蘆興埤', '大湳'], places: ['八德'], region: 'north',
    status: '興建中，尚未通車；沒有公告票價', expected: '官方：優先通車段 G11 藝文特區–G15b 坑口預估 2026 年、主線 2030 年、全線 2032 年（115／119／121年）',
    stations: ['G01 建德興豐', 'G04 大湳（與三鶯延伸 LB14 轉乘）', 'G07 桃園車站（地下，與台鐵轉乘）', 'G11 藝文特區', 'G12 蘆興埤', 'G15b 坑口（與機捷 A11 轉乘）', 'G19（與機捷 A16 轉乘）'],
    checkPhrases: [{ url: `${TYCG}23132`, phrases: ['預估於115年優先通車段(G11-G15b)通車', '119年主線通車', '121年全線通車', 'G07 桃園車站'] }],
  }),
  line({
    name: '桃園捷運綠線延伸中壢', words: ['綠線延伸中壢', '綠延中壢'], region: 'north',
    status: '施工中（機電統包 2026-09-28 開工）', expected: '官方：開工後 8 年通車',
    checkPhrases: [{ url: `${TYCG}27470`, phrases: ['預估於開工後8年通車', '115年9月28日開工'] }],
  }),
  line({
    name: '桃園捷運綠線延伸大溪', words: ['綠線延伸大溪', '綠延大溪'], places: ['大溪'], region: 'north',
    status: '可行性研究審議中（2026-09-09 修正報告送交通部）',
    checkPhrases: [{ url: `${TYCG}24112`, phrases: ['目前為可行性研究階段'] }],
  }),
  line({
    name: '桃園捷運棕線', words: ['桃園棕線', '桃捷棕線', '桃園捷運棕線'], region: 'north',
    status: '施工中', expected: '官方：預估 2032 年 3 月通車（121年3月）',
    stations: ['桃園車站（與綠線 G07 轉乘）至 BR01 新莊機廠（與新蘆線、萬大線轉乘）'],
    checkPhrases: [{ url: `${TYCG}23134`, phrases: ['捷運棕線預估於121年3月通車'] }],
  }),
  line({
    name: '機場捷運延伸 A23 中壢車站', words: ['A23', '中壢車站', '機捷中壢', '機捷延伸中壢'], region: 'north',
    status: '施工中（A22 老街溪已於 2023-07-31 通車）', expected: '官方：A23 預計 2029 年通車（118年）',
    stations: ['A23 中壢車站（台鐵中壢站後站健行路下方）'],
    checkPhrases: [{ url: `${TYCG}23131`, phrases: ['A23站預計於118年通車'] }],
  }),
  line({
    name: '萬大線第一期', words: ['萬大線', '萬大中和樹林', '萬大中和線', '廈安', '加蚋', '連城錦和', 'LG02', 'LG03', 'LG04', 'LG05', 'LG07', 'LG08'], region: 'north',
    status: '施工中', expected: '官方：預定 2027 年完工（116年）；履勘通過後才公布通車日',
    stations: ['LG01 中正紀念堂', 'LG02 植物園', 'LG03 廈安', 'LG04 加蚋', 'LG05 永和永平國小', 'LG06 中和（與環狀線轉乘）', 'LG07 連城錦和', 'LG08 中和高中', 'LG08A 莒光'],
    checkPhrases: [{ url: TAIPEI_FAQ, phrases: ['萬大-中和-樹林線第一期:116年'] }, { url: TAIPEI_WANDA, phrases: ['LG03 廈安站'] }, { url: `${NTPC}8pRG2lkJmb5z`, phrases: ['預計116年底完工'] }],
  }),
  line({
    name: '萬大線第二期（土城樹林線）', words: ['土城樹林線', '萬大線第二期', '萬大二期'], region: 'north',
    status: '施工中', expected: '官方：預計 2031 年完工（120年）',
    checkPhrases: [{ url: `${NTPC}DPRV2j4NZrWv`, phrases: ['預計120年完工'] }],
  }),
  line({
    name: '環狀線北環段、南環段', words: ['北環段', '南環段', '環狀線北環', '環狀線南環', '北環線', '南環線'], region: 'north',
    status: '施工中', expected: '官方：預定 2031 年完工（120年）',
    checkPhrases: [{ url: TAIPEI_FAQ, phrases: ['環狀線-北環段及南環段:120年'] }, { url: `${NTPC}bQw92Vzy2jOk`, phrases: ['預計120年完工'] }],
  }),
  line({
    name: '環狀線東環段', words: ['東環段', '環狀線東環', '東環線'], region: 'north',
    status: '在建工程', expected: '官方：預定 2034 年完工（123年）',
    checkPhrases: [{ url: TAIPEI_FAQ, phrases: ['環狀線-東環段:123年'] }],
  }),
  line({
    name: '淡海輕軌第二期（藍海線二期）', words: ['淡海輕軌二期', '淡海輕軌第二期', '淡海線第二期', '淡海二期', '藍海線二期', '藍海線第二期'], region: 'north',
    status: '修正計畫審議中（2026-09-09 第7次提報交通部轉行政院）', expected: '官方：修正計畫奉中央核定後 5 年完工',
    checkPhrases: [{ url: `${NTPC}6yEwdwyOmM04`, phrases: ['修正計畫報告奉中央核定後5年完工', '115年09月09日第7次提報交通部轉行政院審議'] }],
  }),
  line({
    name: '基隆捷運', words: ['基隆捷運', '基隆線'], places: ['基隆'], region: 'north',
    status: '先期工程施工中（2025-12-30 開工）', expected: '官方：預計 2033 年完工（122年）',
    checkPhrases: [{ url: `${NTPC}OpLAZgeL26aW`, phrases: ['預計122年完工', '114年12月30日開工'] }],
  }),
  line({
    name: '汐東捷運（原汐止民生線）', words: ['汐東線', '汐東捷運', '汐止民生線', '汐止東湖線'], places: ['汐止'], region: 'north',
    status: '施工中（統包 2024-10-22 決標）', expected: '官方：預計 2032 年完工（121年）',
    checkPhrases: [{ url: `${NTPC}8l19Zo7NZveD`, phrases: ['預計121年完工', '113年10月22日決標'] }],
  }),
  ntpcPlanned('民生線', 'Wr6421Jvd9nR', '9.5', ['民生線', '民生汐止線'], ['汐止']),
  ntpcPlanned('深坑輕軌', 'QP9z2zprZrDp', '7', ['深坑輕軌', '深坑線'], ['深坑']),
  ntpcPlanned('八里輕軌', '6DJPZEqgZKx3', '5', ['八里輕軌', '八里線'], ['八里']),
  ntpcPlanned('五股泰山輕軌', 'LvKR2LlG2JGp', '7', ['五股泰山輕軌', '五股泰山線']),
  ntpcPlanned('泰山板橋輕軌', 'oBjeZYj7mAwv', '7', ['泰山板橋輕軌', '泰山板橋線']),
  line({
    name: '大新竹輕軌（紅、藍線）', words: ['新竹輕軌', '大新竹輕軌', '新竹捷運'], places: ['新竹', '竹北'], region: 'north',
    status: '可行性研究中（新竹縣市紅、藍線整合研究，2026-03-03 決標）；尚無核定路線與時程',
    checkPhrases: [{ url: HSINCHU, phrases: ['紅藍線整合可行性研究決標', '115)年3月3日順利完成決標'] }],
  }),
  line({
    name: '台中捷運藍線', words: ['台中藍線', '中捷藍線', '台中捷運藍線'], places: ['沙鹿', '梧棲', '台中港'], region: 'central',
    status: '施工中（機電統包 2025-06-26 開工）', expected: '新聞：市府目標 2034 年；2026-07 議會報告稱最快 2036 年',
    checkPhrases: [{ url: `${TAICHUNG}46`, phrases: ['114年6月26日舉行開工典禮'] }],
  }, ['https://newtalk.tw/news/view/2026-07-30/1050309']),
  line({
    name: '台中捷運綠線延伸大坑、彰化', words: ['綠線延伸大坑', '綠線延伸彰化', '綠延大坑', '綠延彰化'], places: ['大坑', '彰化'], region: 'central',
    status: '綜合規劃審議中（2026-09-11 交通部送審查意見）；尚無核定時程',
    stations: ['大坑段：舊社（103）延伸 2 站', '彰化段：高鐵台中（119）延伸 6 站至彰化金馬站'],
    checkPhrases: [{ url: `${TAICHUNG}100`, phrases: ['115.09.11 交通部函送綜合規劃報告書審查意見'] }],
  }),
  line({
    name: '台中機場捷運（橘線）', words: ['台中橘線', '中捷橘線', '台中機場捷運'], places: ['清泉崗'], region: 'central',
    status: '綜合規劃中（可行性研究 2026-08-18 行政院核定）',
    checkPhrases: [{ url: `${TAICHUNG}99`, phrases: ['115.08.18 行政院核定可行性研究', '115.09.29 啟動綜合規劃'] }],
  }),
  line({
    name: '台南捷運第一期藍線', words: ['台南捷運', '台南藍線'], places: ['台南'], region: 'south',
    status: '統包工程招標中（2026-08-18 公告）', expected: '官方曾以 2031 年（120年）通車為目標（2024-04 公告）',
    stations: ['B01–B10 共 10 座高架站（永康、東區、仁德）'],
    checkPhrases: [{ url: TAINAN_TENDER, phrases: ['正式上網公告招標', 'B01至B10'] }, { url: TAINAN_2024, phrases: ['120年完工'] }],
  }),
  line({
    name: '高雄捷運黃線', words: ['高雄黃線', '高捷黃線', '高雄捷運黃線'], places: ['鳥松', '澄清湖'], region: 'south',
    status: '施工中', expected: '新聞：完工延至 2034 年（聯合報 2025-11）',
    checkPhrases: [{ url: `${KAOHSIUNG}yellow/yellow01.html`, phrases: ['黃線起於鳥松神農路'] }],
  }, ['https://udn.com/news/story/7327/9115420']),
  line({
    name: '岡山路竹延伸線第二階段', words: ['岡山路竹延伸', '路竹延伸', 'RK2', 'RK3', 'RK4', 'RK5', 'RK6'], places: ['路竹'], region: 'south',
    status: '施工中（第二A階段 RK2–RK6；第二B階段細部設計中）',
    checkPhrases: [{ url: `${KAOHSIUNG}Luzhu02A/Luzhu02A03.html`, phrases: ['RK2~RK6共5座車站'] }],
  }),
  line({
    name: '小港林園線', words: ['小港林園線', '林園線'], places: ['林園'], region: 'south',
    status: '施工中',
    checkPhrases: [{ url: `${KAOHSIUNG}Linyuan/Linyuan02.html`, phrases: ['行政院核定小港林園線綜合規劃報告'] }],
  }),
  line({
    name: '貓空纜車', words: ['貓空纜車', '貓纜', '貓空'], region: 'north', kind: 'not-covered',
    status: '營運中（臺北捷運公司經營），捷運工具不查纜車的票價與時刻；請看貓空纜車官網',
    checkPhrases: [{ url: 'https://www.gondola.taipei/', phrases: ['貓空纜車'] }],
  }),
];

const METRO_WORD = /捷運|輕軌|mrt|lrt|地鐵|metro/u;
const STREET_AFTER = /^[路街]/u;

/** Length of `word` when it occurs in `text` other than as a street name; 0 when it does not. */
function wordHit(text: string, word: string): number {
  const key = normalizeMetroName(word);
  if (!key) return 0;
  for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1)) {
    if (!STREET_AFTER.test(text.slice(at + key.length))) return key.length;
  }
  return 0;
}

function lineScore(entry: FutureLine, text: string, metroContext: boolean): number {
  let best = 0;
  for (const word of entry.words) best = Math.max(best, wordHit(text, word));
  for (const place of entry.places ?? []) {
    const key = normalizeMetroName(place);
    if (text === key) return Math.max(best, key.length);
    if (metroContext) best = Math.max(best, wordHit(text, place));
  }
  return best;
}

/** Every line the text names, longest matched word first (ties keep table order). */
export function findFutureLines(text: string): FutureLine[] {
  const normalized = normalizeMetroName(text);
  if (!normalized) return [];
  const metroContext = METRO_WORD.test(normalized);
  return FUTURE_LINES
    .map((entry, order) => ({ entry, order, score: lineScore(entry, normalized, metroContext) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((hit) => hit.entry);
}

export function findFutureLine(text: string): FutureLine | undefined {
  return findFutureLines(text)[0];
}

/** What the model reads: the line without its matching words or the self-test's phrases. */
export function futureLineView(entry: FutureLine): Omit<FutureLine, 'words' | 'places' | 'checkPhrases'> {
  const { words: _words, places: _places, checkPhrases: _phrases, ...view } = entry;
  return view;
}

/**
 * New Taipei Metro's own fare systems: 淡海輕軌 (V), 安坑輕軌 (K) and 三鶯線 (LB). The Circular line
 * (Y) is New Taipei Metro's too, but Taipei Metro prices it, so its stations live in Taipei Metro's
 * network. Names are as ntmetro.com.tw prints them (station pages node 10136 / 10137 / 10164, the
 * route maps on node 10070 / 10071 for the English, read 2026-10-22); 三鶯線 English from the
 * official first/last-train chart (node 863) and TDX StationOfLine, which agree.
 */
import type { MetroStation } from './metroTypes';

type Row = readonly [code: string, zh: string, en: string];

function stations(network: MetroStation['network'], line: string, rows: readonly Row[]): MetroStation[] {
  return rows.map(([code, zh, en]) => ({ network, codes: [code], zh, en, lines: [line] }));
}

/** 綠山線 V01–V11 and 藍海線 V26–V28 as one list; see `DANHAI_GREEN` / `DANHAI_BLUE` for the order trains run. */
export const DANHAI_STATIONS: readonly MetroStation[] = stations('danhai', 'V', [
  ['V01', '紅樹林', 'Hongshulin'],
  ['V02', '竿蓁林', 'Ganzhenlin'],
  ['V03', '淡金鄧公', 'Danjin Denggong'],
  ['V04', '淡江大學', 'Tamkang University'],
  // The route map adds "(北投子)" / "(Beitouzi)"; the station page and fare text do not.
  ['V05', '淡金北新', 'Danjin Beixin (Beitouzi)'],
  ['V06', '新市一路', 'Xinshi 1st Rd.'],
  ['V07', '淡水行政中心', 'Tamsui District Office'],
  ['V08', '濱海義山', 'Binhai Yishan'],
  ['V09', '濱海沙崙', 'Binhai Shalun'],
  ['V10', '淡海新市鎮', 'Danhai New Town'],
  ['V11', '崁頂', 'Kanding'],
  ['V26', '淡水漁人碼頭', "Tamsui Fisherman's Wharf"],
  ['V27', '沙崙', 'Shalun'],
  ['V28', '台北海洋大學', 'Taipei University of Marine Technology'],
]);

/**
 * The two services, as the route map (node 10070) and V01's timetable ("往崁頂站" / "往淡水漁人碼頭站")
 * show them: both start at 紅樹林 and share V01–V09; past 濱海沙崙 the 綠山線 turns to 崁頂 and the
 * 藍海線 runs V28 → V27 → V26. The live board numbers them routeId 3 and 4 (2026-10-22 captures).
 */
export const DANHAI_GREEN = ['V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V10', 'V11'] as const;
export const DANHAI_BLUE = ['V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V28', 'V27', 'V26'] as const;
/** Where the two services part: "濱海沙崙，可轉乘往崁頂或往淡水漁人碼頭" (淡海輕軌路線圖.odt). */
export const DANHAI_JUNCTION = 'V09';

export const ANKENG_STATIONS: readonly MetroStation[] = stations('ankeng', 'K', [
  ['K01', '雙城', 'Shuangcheng'],
  ['K02', '玫瑰中國城', 'Rose China Town'],
  ['K03', '台北小城', 'Taipei Xiaocheng'],
  ['K04', '耕莘安康院區', 'Cardinal Tien Hospital An Kang Branch'],
  ['K05', '景文科大', 'Jinwen University of Science and Technology'],
  ['K06', '安康', 'Ankang'],
  ['K07', '陽光運動公園', 'Sunshine Sports Park'],
  ['K08', '新和國小', 'Xinhe Elementary School'],
  ['K09', '十四張', 'Shisizhang'],
]);

export const ANKENG_LINE = ['K01', 'K02', 'K03', 'K04', 'K05', 'K06', 'K07', 'K08', 'K09'] as const;

export const SANYING_STATIONS: readonly MetroStation[] = stations('sanying', 'LB', [
  ['LB01', '頂埔', 'Dingpu'],
  ['LB02', '媽祖田', 'Mazutian'],
  ['LB03', '長壽山', 'Changshoushan'],
  ['LB04', '橫溪', 'Hengxi'],
  ['LB05', '龍埔', 'Longpu'],
  ['LB06', '三峽', 'Sanxia'],
  // ntmetro.com.tw writes 臺; TDX writes 台北大學.
  ['LB07', '臺北大學', 'National Taipei University'],
  ['LB08', '鶯歌車站', 'Yingge Station'],
  ['LB09', '陶瓷老街', 'Ceramics Old Street'],
  ['LB10', '國華', 'Guohua'],
  ['LB11', '永吉公園', 'Yongji Park'],
  ['LB12', '鶯桃福德', 'Yingtao Fude'],
]);

export const SANYING_LINE = SANYING_STATIONS.map((s) => s.codes[0]);

export const NTMETRO_STATIONS: readonly MetroStation[] = [...DANHAI_STATIONS, ...ANKENG_STATIONS, ...SANYING_STATIONS];

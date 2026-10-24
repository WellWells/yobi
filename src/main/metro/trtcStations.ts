/**
 * Every station Taipei Metro lists, as its own station menu (`apis/metrostationapi/menuline`, Lang
 * tw and en, 2026-10-22) prints them: 136 line entries over six lines (BR, R, G, O, BL and the
 * Circular line Y07–Y20) are 120 stations, one per SID. A transfer station is one SID on two lines
 * and one row here; its codes are in the order Taipei Metro prints them on the route map
 * (`StationLabelForRoadmap`, the same string on both lines: 台北車站 "BL12 R10", 景安 "Y11 O02"),
 * so the first code — the key — is the route map's first. 板橋 (BL07 SID 082, Y16 SID 209) and
 * 新埔 / 新埔民生 (BL08 083, Y17 210) are two SIDs each, with one code on the map, so they stay two
 * rows. Names are `StationName`; the bracketed `StationSubName` (科技大樓「國北教大」) is kept apart in
 * `TRTC_SUBNAMES`. The self-test compares this table with the live menu.
 */
import type { MetroStation } from './metroTypes';

/** SID, route-map codes, zh, en, then the sub-name in zh and en when the station has one. */
type Row = readonly [sid: string, codes: string, zh: string, en: string, subZh?: string, subEn?: string];

const ROWS: readonly Row[] = [
  // BR 文湖線
  ['019', 'BR01', '動物園', 'Taipei Zoo'],
  ['018', 'BR02', '木柵', 'Muzha'],
  ['017', 'BR03', '萬芳社區', 'Wanfang Community'],
  ['016', 'BR04', '萬芳醫院', 'Wanfang Hospital'],
  ['015', 'BR05', '辛亥', 'Xinhai'],
  ['014', 'BR06', '麟光', 'Linguang'],
  ['013', 'BR07', '六張犁', 'Liuzhangli'],
  ['012', 'BR08', '科技大樓', 'Technology Building', '國北教大', 'National Taipei University of Education'],
  ['011', 'R05 BR09', '大安', 'Daan'],
  ['010', 'BL15 BR10', '忠孝復興', 'Zhongxiao Fuxing'],
  ['009', 'G16 BR11', '南京復興', 'Nanjing Fuxing'],
  ['008', 'BR12', '中山國中', 'Zhongshan Junior High School'],
  ['007', 'BR13', '松山機場', 'Songshan Airport'],
  ['021', 'BR14', '大直', 'Dazhi', '實踐大學', 'Shih Chien University'],
  ['022', 'BR15', '劍南路', 'Jiannan Rd.', '美麗華', 'Miramar'],
  ['023', 'BR16', '西湖', 'Xihu', '德明科大', 'Takming Univ.'],
  ['024', 'BR17', '港墘', 'Gangqian'],
  ['025', 'BR18', '文德', 'Wende', '碧湖公園', 'Bihu Park'],
  ['026', 'BR19', '內湖', 'Neihu'],
  ['027', 'BR20', '大湖公園', 'Dahu Park'],
  ['028', 'BR21', '葫洲', 'Huzhou'],
  ['029', 'BR22', '東湖', 'Donghu'],
  ['030', 'BR23', '南港軟體園區', 'Nangang Software Park'],
  ['031', 'BL23 BR24', '南港展覽館', 'Taipei Nangang Exhibition Center'],
  // R 淡水信義線
  ['104', 'R01', '廣慈/奉天宮', 'Guangci/Fengtian Temple', '松山慈惠堂', 'Songshan Cihui Temple'],
  ['099', 'R02', '象山', 'Xiangshan'],
  ['100', 'R03', '台北101/世貿', 'Taipei 101/World Trade Center'],
  ['101', 'R04', '信義安和', 'Xinyi Anhe'],
  ['103', 'R06', '大安森林公園', 'Daan Park'],
  ['134', 'R07 O06', '東門', 'Dongmen'],
  ['042', 'G10 R08', '中正紀念堂', 'C.K.S. Memorial Hall', '南門', 'Nanmen'],
  ['050', 'R09', '台大醫院', 'NTU Hospital'],
  ['051', 'BL12 R10', '台北車站', 'Taipei Main Station'],
  ['053', 'G14 R11', '中山', 'Zhongshan'],
  ['054', 'R12', '雙連', 'Shuanglian', '馬偕紀念醫院', 'Mackay Memorial Hospital'],
  ['055', 'O11 R13', '民權西路', 'Minquan W. Rd.'],
  ['056', 'R14', '圓山', 'Yuanshan'],
  ['057', 'R15', '劍潭', 'Jiantan', '北藝中心', 'Taipei Performing Arts Center'],
  ['058', 'R16', '士林', 'Shilin'],
  ['059', 'R17', '芝山', 'Zhishan'],
  ['060', 'R18', '明德', 'Mingde'],
  ['061', 'R19', '石牌', 'Shipai', '榮總', 'Veterans General Hospital'],
  ['062', 'R20', '唭哩岸', 'Qilian', '陽明交通大學', 'National Yang Ming Chiao Tung University'],
  ['063', 'R21', '奇岩', 'Qiyan'],
  ['064', 'R22', '北投', 'Beitou'],
  ['065', 'R22A', '新北投', 'Xinbeitou'],
  ['066', 'R23', '復興崗', 'Fuxinggang'],
  ['067', 'R24', '忠義', 'Zhongyi'],
  ['068', 'R25', '關渡', 'Guandu'],
  ['069', 'R26', '竹圍', 'Zhuwei'],
  ['070', 'R27', '紅樹林', 'Hongshulin'],
  ['071', 'R28', '淡水', 'Tamsui'],
  // G 松山新店線
  ['033', 'G01', '新店', 'Xindian', '碧潭', 'Bitan'],
  ['034', 'G02', '新店區公所', 'Xindian District Office'],
  ['035', 'G03', '七張', 'Qizhang'],
  ['032', 'G03A', '小碧潭', 'Xiaobitan', '新店高中', 'Xindian High School'],
  ['036', 'G04 Y07', '大坪林', 'Dapinglin'],
  ['037', 'G05', '景美', 'Jingmei'],
  ['038', 'G06', '萬隆', 'Wanlong'],
  ['039', 'G07', '公館', 'Gongguan', '台灣大學', 'National Taiwan University'],
  ['040', 'G08', '台電大樓', 'Taipower Building'],
  ['041', 'G09 O05', '古亭', 'Guting'],
  ['043', 'G11', '小南門', 'Xiaonanmen'],
  ['086', 'BL11 G12', '西門', 'Ximen'],
  ['105', 'G13', '北門', 'Beimen'],
  ['132', 'G15 O08', '松江南京', 'Songjiang Nanjing'],
  ['109', 'G17', '台北小巨蛋', 'Taipei Arena'],
  ['110', 'G18', '南京三民', 'Nanjing Sanmin'],
  ['111', 'G19', '松山', 'Songshan'],
  // O 中和新蘆線
  ['048', 'O01', '南勢角', 'Nanshijiao'],
  ['047', 'Y11 O02', '景安', 'Jingan'],
  ['046', 'O03', '永安市場', 'Yongan Market'],
  ['045', 'O04', '頂溪', 'Dingxi'],
  ['089', 'BL14 O07', '忠孝新生', 'Zhongxiao Xinsheng', '台北科大', 'National Taipei University of Technology'],
  ['131', 'O09', '行天宮', 'Xingtian Temple'],
  ['130', 'O10', '中山國小', 'Zhongshan Elementary School', '晴光商圈', 'Qingguang Commercial Zone'],
  ['128', 'O12', '大橋頭', 'Daqiaotou', '大橋國小', 'Daqiao Elementary School'],
  ['127', 'O13', '台北橋', 'Taipei Bridge'],
  ['126', 'O14', '菜寮', 'Cailiao', '新北市立醫院', 'New Taipei City Hospital'],
  ['125', 'O15', '三重', 'Sanchong'],
  ['124', 'O16', '先嗇宮', 'Xianse Temple'],
  ['123', 'Y18 O17', '頭前庄', 'Touqianzhuang', '臺北醫院', 'Taipei Hospital'],
  ['122', 'O18', '新莊', 'Xinzhuang', '新莊廟街', 'Xinzhuang Temple St.'],
  ['121', 'O19', '輔大', 'Fu Jen University'],
  ['180', 'O20', '丹鳳', 'Danfeng'],
  ['179', 'O21', '迴龍', 'Huilong', '樂生', 'Lo-sheng'],
  ['178', 'O50', '三重國小', 'Sanchong Elementary School'],
  ['177', 'O51', '三和國中', 'Sanhe Junior High School'],
  ['176', 'O52', '徐匯中學', 'St. Ignatius High School'],
  ['175', 'O53', '三民高中', 'Sanmin Senior High School', '空中大學', 'National Open University'],
  ['174', 'O54', '蘆洲', 'Luzhou', '蘆洲李宅', 'The Luzhou Lee Family Historic Estate'],
  // BL 板南線
  ['076', 'BL01', '頂埔', 'Dingpu'],
  ['077', 'BL02', '永寧', 'Yongning'],
  ['078', 'BL03', '土城', 'Tucheng'],
  ['079', 'BL04', '海山', 'Haishan', '新北高工', 'New Taipei I. V. High School'],
  ['080', 'BL05', '亞東醫院', 'Far Eastern Hospital', '亞東科大', 'Asia Eastern University of Sci. & Tech.'],
  ['081', 'BL06', '府中', 'Fuzhong', '林家花園', 'The Lin Family Mansion and Garden'],
  ['082', 'BL07', '板橋', 'Banqiao'],
  ['083', 'BL08', '新埔', 'Xinpu', '致理科大', 'Chihlee University of Technology'],
  ['084', 'BL09', '江子翠', 'Jiangzicui'],
  ['085', 'BL10', '龍山寺', 'Longshan Temple', '艋舺商圈', 'Bangka Commercial Zone'],
  ['088', 'BL13', '善導寺', 'Shandao Temple', '華山', 'Huashan'],
  ['091', 'BL16', '忠孝敦化', 'Zhongxiao Dunhua'],
  ['092', 'BL17', '國父紀念館', 'S.Y.S. Memorial Hall'],
  ['093', 'BL18', '市政府', 'Taipei City Hall'],
  ['094', 'BL19', '永春', 'Yongchun'],
  ['095', 'BL20', '後山埤', 'Houshanpi', '五分埔商圈', 'Wufenpu Commercial Zone'],
  ['096', 'BL21', '昆陽', 'Kunyang'],
  ['097', 'BL22', '南港', 'Nangang'],
  // Y 環狀線 (Y07 大坪林, Y11 景安, Y18 頭前庄 are above as transfer stations)
  ['201', 'Y08', '十四張', 'Shisizhang'],
  ['202', 'Y09', '秀朗橋', 'Xiulang Bridge'],
  ['203', 'Y10', '景平', 'Jingping'],
  ['205', 'Y12', '中和', 'Zhonghe'],
  ['206', 'Y13', '橋和', 'Qiaohe'],
  ['207', 'Y14', '中原', 'Zhongyuan'],
  ['208', 'Y15', '板新', 'Banxin'],
  ['209', 'Y16', '板橋', 'Banqiao'],
  ['210', 'Y17', '新埔民生', 'Xinpu Minsheng'],
  ['212', 'Y19', '幸福', 'Xingfu'],
  ['213', 'Y20', '新北產業園區', 'New Taipei Industrial Park'],
];

/** "BL12" → "BL", "R22A" → "R". */
export function trtcLineOf(code: string): string {
  return code.replace(/\d.*$/u, '');
}

export const TRTC_STATIONS: readonly MetroStation[] = ROWS.map(([sid, codes, zh, en]) => {
  const list = codes.split(' ');
  return { network: 'trtc', codes: list, zh, en, lines: list.map(trtcLineOf), ref: sid };
});

/** The bracketed second name Taipei Metro prints after some stations, by SID (科技大樓「國北教大」). */
export const TRTC_SUBNAMES: Readonly<Record<string, { zh: string; en: string }>> = Object.fromEntries(
  ROWS.filter((row) => row[4]).map(([sid, , , , subZh = '', subEn = '']) => [sid, { zh: subZh, en: subEn }]),
);

const BY_SID = new Map(TRTC_STATIONS.map((station) => [station.ref ?? '', station]));
const BY_CODE = new Map(TRTC_STATIONS.flatMap((station) => station.codes.map((code) => [code, station] as const)));

export function trtcStationBySid(sid: string): MetroStation | undefined {
  return BY_SID.get(sid);
}

/** Any of a station's codes finds it ("R10" and "BL12" are both 台北車站). */
export function trtcStationByCode(code: string): MetroStation | undefined {
  return BY_CODE.get(code.toUpperCase());
}

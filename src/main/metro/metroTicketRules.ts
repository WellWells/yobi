/**
 * Who pays what on each metro operator: discounts by card and age, passes, and transfer rules,
 * as each operator's own ticket pages state them. These change a few times a year at most, so they
 * are baked here with their sources and the day they were read; `checkPhrases` are the sentences
 * the release self-test still expects to find on those pages, so a
 * changed rule fails the release instead of reaching a rider. Per-trip prices are never here —
 * the trip tools quote those live. Nothing is filled in that the pages do not say.
 */
import type { MetroOperator } from './metroTypes';

export interface TicketRule {
  who: string;
  pays: string;
  how?: string;
  conditions?: string;
}

export interface TicketPass {
  name: string;
  ntd?: number;
  note?: string;
}

export interface CheckPage {
  url: string;
  phrases: readonly string[];
}

export interface TicketRuleSet {
  operator: MetroOperator;
  systems: string;
  rules: readonly TicketRule[];
  passes: readonly TicketPass[];
  notes?: readonly string[];
  sources: readonly string[];
  checkedOn: string;
  checkPhrases: readonly CheckPage[];
}

const CHECKED_ON = '2026-10-22';

const TRTC_CARDS = 'https://www.metro.taipei/cp.aspx?n=CEF54168B23F73B4&s=9C19A1790ED1E5B4';
const TRTC_SINGLE = 'https://www.metro.taipei/cp.aspx?n=CEF54168B23F73B4&s=AD70DC4F6A708EA7';
const TRTC_PASSES = 'https://www.metro.taipei/cp.aspx?n=CEF54168B23F73B4&s=9D540D31C5F81237';
const TRTC_OTHER = 'https://www.metro.taipei/cp.aspx?n=CEF54168B23F73B4&s=60880795EAF8F7F8';
const TRTC_TPASS = 'https://www.metro.taipei/cp.aspx?n=CEF54168B23F73B4&s=BB3631329CC1A297';
const TRTC_FREQUENT = 'https://www.metro.taipei/cp.aspx?n=AB56163F79ECB2C2';
const TRTC_FREE_CHILD = 'https://www.metro.taipei/News_Content.aspx?n=566DA580861CEE77&sms=87415A8B9CE81B16&s=659D91B390310152';

const TYMC_PAGES = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide';
const TYMC_SINGLE = `${TYMC_PAGES}/ticketson01.php`;
const TYMC_SEASON = `${TYMC_PAGES}/ticketson02.php`;
const TYMC_CARDS = `${TYMC_PAGES}/ticketson03.php`;
const TYMC_OTHER = `${TYMC_PAGES}/ticketson04.php`;
const TYMC_COMMUTER = `${TYMC_PAGES}/ticketson08.php`;

const NTMETRO_TICKETS = 'https://www.ntmetro.com.tw/basic/?node=10102';
const NTMETRO_LRT_RULES = 'https://www.ntmetro.com.tw/basic/?mode=detail&node=629';

const TMRT_TICKETS = 'https://www.tmrt.com.tw/metro-life/ticket-types';
const TMRT_RULES = 'https://www.tmrt.com.tw/metro-life/transfer-Info/travel-guide';

const KRTC_MORE = 'https://www.krtc.com.tw/Ticket/ticket_more?id=';
const KLRT_MORE = 'https://www.krtc.com.tw/Ticket/KLRT_ticket_more?id=';
const KRTC_WELFARE_SINGLE = `${KRTC_MORE}69f059233421446e93c730315b400947`;
const KRTC_SENIOR = `${KRTC_MORE}0592163f10194f04b5cf17ac062ca52e`;
const KRTC_CHILD = `${KRTC_MORE}b31859c676bb42a5b9a1bf61c87895f2`;
const KRTC_STUDENT = `${KRTC_MORE}2bd81e172dfc411e8bd277a4b7451b1f`;
const KRTC_OTHER_IPASS = `${KRTC_MORE}4b0f494e1f7c4d319a885b9e073d5250`;
const KRTC_HOUR_PASS = `${KRTC_MORE}2d5b8a749e8140c59e430faf602654f3`;
const KRTC_DAY_QR = `${KRTC_MORE}c97ac5f85c2a4d70862272ec95a98375`;
const KLRT_SENIOR = `${KLRT_MORE}9071175c313247f68ff4745ff3845711`;
const KLRT_CHILD = `${KLRT_MORE}c2a45ee706b742e3aa5a6295fca807e9`;
const KLRT_OTHER_IPASS = `${KLRT_MORE}17d6c6052e1c44829fee85176138f725`;
const KRTC_RULES = 'https://www.krtc.com.tw/Guide/regulations?id=ae2699c603ab44e1ababb4708383f22e';

const UNDER_SIX_115 = { who: '未滿6歲，或身高未滿115公分', pays: '免費', conditions: '由購票旅客陪同，每人最多4名；滿115公分要出示身分證明' } as const;

export const TICKET_RULES: Readonly<Record<MetroOperator, TicketRuleSet>> = {
  trtc: {
    operator: 'trtc',
    systems: '台北捷運（含環狀線）',
    rules: [
      { who: '普通卡、學生卡、優待卡（悠遊卡／一卡通／愛金卡）', pays: '全票' },
      { who: '敬老卡、愛心卡、愛心陪伴卡（任何縣市的社福卡）', pays: '4折', conditions: '愛心陪伴卡單獨使用＝全票' },
      { who: '敬老愛心優惠票（單程票）', pays: '4折', how: '車站詢問處出示證件正本', conditions: '限本國籍：65歲以上、身障者＋陪伴者1人、設籍台北／新北55歲以上原住民' },
      { who: '6–12歲兒童', pays: '4折', how: '台北市國小數位學生證、台北兒童優惠卡或新北兒童卡', conditions: '設籍台北市可在詢問處買4折單程票；其他縣市兒童全票' },
      UNDER_SIX_115,
      { who: '團體10人以上／40人以上', pays: '8折／7折' },
    ],
    passes: [
      { name: '一日票', ntd: 150, note: '啟用當天營運結束前' },
      { name: '24小時票', ntd: 180 },
      { name: '48小時票', ntd: 280 },
      { name: '72小時票', ntd: 380 },
      { name: '基北北桃都會通（TPASS）', ntd: 1200, note: '30天；北捷、新北捷運、桃園捷運、台鐵、公車等' },
      { name: '桃捷聯票', ntd: 520, note: '機捷來回＋北捷48小時票' },
      { name: '桃捷聯票', ntd: 600, note: '機捷來回＋北捷72小時票' },
      { name: '攜帶自行車單程票', ntd: 80 },
    ],
    notes: [
      '常客優惠：儲值卡付全票者，前月搭11–20次回饋5%、21–40次10%、41次以上15%；社福卡、兒童卡、TPASS、信用卡不適用',
      '1小時內與淡海／安坑輕軌、三鶯線轉乘（電子票證）：全票卡種−8元，敬老、愛心、兒童卡−4元',
    ],
    sources: [TRTC_CARDS, TRTC_SINGLE, TRTC_PASSES, TRTC_OTHER, TRTC_TPASS, TRTC_FREQUENT, TRTC_FREE_CHILD],
    checkedOn: CHECKED_ON,
    checkPhrases: [
      { url: TRTC_CARDS, phrases: ['每趟車資可享單程票價之4折優惠', '新北兒童卡', '每次轉乘優惠為新臺幣8元', '每次轉乘優惠為新臺幣4元'] },
      { url: TRTC_SINGLE, phrases: ['全票之4折票價', '限設籍於臺北市之年滿6至12歲兒童'] },
      { url: TRTC_PASSES, phrases: ['一日票 150元', '24小時票 180元', '48小時票 280元', '72小時票 380元'] },
      { url: TRTC_OTHER, phrases: ['桃捷聯票 520元', '桃捷聯票 600元', '攜帶自行車單程票 80元', '每人以單程票打8折優惠'] },
      { url: TRTC_TPASS, phrases: ['1,200元', '桃園捷運'] },
      { url: TRTC_FREQUENT, phrases: ['11～20次 5%', '21～40次 10%', '41次以上 15%'] },
      { url: TRTC_FREE_CHILD, phrases: ['身高未滿115公分之兒童', '最多以陪同4名'] },
    ],
  },
  tymc: {
    operator: 'tymc',
    systems: '桃園機場捷運',
    rules: [
      { who: '普通卡、學生卡、優待卡（悠遊卡／一卡通／icash）', pays: '全票' },
      { who: '敬老卡、愛心卡、愛心陪伴卡、一卡通博愛卡（任何縣市）', pays: '5折（半票）', conditions: '陪伴卡要緊接愛心卡過閘門，否則全票' },
      { who: '敬老愛心優待票（單程票）', pays: '5折', how: '車站詢問處出示證件', conditions: '65歲以上（含持居留證）、身障者＋陪伴1人、設籍桃園55歲以上原住民' },
      { who: '6–12歲兒童', pays: '8折', how: '詢問處買兒童單程優待票（本國兒童，出示證件）', conditions: '台北數位學生證／兒童優惠卡8折、新北兒童卡5折；悠遊卡優待卡等其他卡全票' },
      { who: '未滿6歲', pays: '免費', conditions: '由購票旅客陪同' },
      { who: '桃園市民卡', pays: '一般卡、學生卡7折；敬老、愛心、愛心陪伴、國小學生卡、兒童優待卡35折' },
    ],
    passes: [
      { name: '一日票', ntd: 320, note: '當天不限次數、不限車種' },
      { name: '桃捷聯票', ntd: 520, note: '機捷來回＋北捷48小時票' },
      { name: '桃捷聯票', ntd: 600, note: '機捷來回＋北捷72小時票' },
      { name: '基北北桃都會通（TPASS）', ntd: 1200 },
      { name: '桃竹竹定期票（TPASS）', ntd: 799, note: '機捷限A7–A22' },
      { name: '桃竹竹苗定期票（TPASS）', ntd: 1200, note: '機捷限A7–A22' },
      { name: '超值定期票', note: '指定站間7／30／90／120天：全票×天數×2趟×42／35／33／27折' },
    ],
    sources: [TYMC_SINGLE, TYMC_CARDS, TYMC_OTHER, TYMC_SEASON, TYMC_COMMUTER],
    checkedOn: CHECKED_ON,
    checkPhrases: [
      { url: TYMC_SINGLE, phrases: ['依 公告票價 之5折收費', '依 公告票價 之8折收費', '未滿6歲之兒童得免購票乘車', '優惠價 320元/張'] },
      { url: TYMC_CARDS, phrases: ['敬老卡(半票)', '可享單程票8折優惠', '可享單程票5折優惠', '學生卡(7折)', '敬老卡(35折)'] },
      { url: TYMC_OTHER, phrases: ['機捷來回票+北捷48小時票：520元', '機捷來回票+北捷72小時票：600元'] },
      { url: TYMC_SEASON, phrases: ['42折', '35折', '33折', '27折'] },
      { url: TYMC_COMMUTER, phrases: ['桃竹竹定期票：799元', '桃竹竹苗定期票：1,200元', 'A7體育大學-A22老街溪'] },
    ],
  },
  ntmetro: {
    operator: 'ntmetro',
    systems: '新北捷運：淡海輕軌、安坑輕軌、三鶯線（環狀線由台北捷運計價）',
    rules: [
      { who: '一般卡、學生卡', pays: '全票' },
      { who: '敬老卡、愛心卡、愛心陪伴卡', pays: '4折' },
      { who: '新北兒童卡、台北國小數位學生證／兒童優惠卡', pays: '4折' },
      { who: '優待單程票（65歲以上、身障者＋陪伴1人）', pays: '5折', how: '輕軌：先買一般單程票，再持票根與證件到詢問處退差額；三鶯線：詢問處購買' },
      UNDER_SIX_115,
      { who: '團體10人以上／40人以上', pays: '8折／7折' },
    ],
    passes: [
      { name: '輕軌一日票', ntd: 50, note: '淡海＋安坑輕軌，當天' },
      { name: '三鶯線一日票', ntd: 60, note: '啟用當天' },
      { name: '基北北桃都會通（TPASS）', ntd: 1200 },
      { name: '輕軌自行車單程票', ntd: 50, note: '人車合併，不限里程' },
    ],
    notes: [
      '1小時內與台北捷運轉乘（電子票證）：一般、學生、單獨使用的愛心陪伴卡−8元；敬老、愛心、陪伴、兒童卡−4元；單程票沒有',
      '新北／台北敬老卡、愛心卡每月600點（1點1元）可扣車資',
      '常客優惠：電子票證搭乘累積滿200元回饋50元',
    ],
    sources: [NTMETRO_TICKETS, NTMETRO_LRT_RULES],
    checkedOn: CHECKED_ON,
    checkPhrases: [
      { url: NTMETRO_TICKETS, phrases: ['給予5折優待', '依公告票價之4折收費', '每次轉乘優惠為新臺幣8元', '每次轉乘優惠為新臺幣4元', '每月享有600點', '滿200元回饋50元', '可不限次數搭乘。 50元 車站詢問處', '60元 車站詢問處'] },
      { url: NTMETRO_LRT_RULES, phrases: ['身高未滿115公分之兒童', '陪同4名免購票兒童'] },
    ],
  },
  tmrt: {
    operator: 'tmrt',
    systems: '台中捷運',
    rules: [
      { who: '普通卡等一般電子票證', pays: '全票', conditions: '官網沒有學生優惠' },
      { who: '敬老愛心卡、愛陪卡（任何縣市）', pays: '5折', conditions: '愛陪卡單獨使用＝全票；台中敬老愛心卡每月1,000點（原住民1,500點）可扣車資' },
      { who: '敬老愛心優待票（單程票）', pays: '5折', how: '詢問處出示身分證／身障證明', conditions: '65歲以上、身障者＋陪伴1人' },
      { who: '6–12歲兒童', pays: '5折', how: '台中市兒童卡，或綁定兒童身分的台中國小數位學生證', conditions: '設籍台中或就讀台中國小；單程票沒有兒童票，其他兒童全票' },
      { who: '未滿6歲', pays: '免費', conditions: '由持票旅客陪同，出示身分證明；陪2名以上請洽站務人員' },
      { who: '團體10人以上', pays: '8折' },
    ],
    passes: [
      { name: '一日票', ntd: 120 },
      { name: '24小時票', ntd: 150 },
      { name: '48小時票', ntd: 250 },
      { name: '臺中市定期票（TPASS）', ntd: 299, note: '台中市民；非市民599' },
      { name: '中彰投苗定期票（TPASS）', ntd: 699, note: '台中市民；非市民999' },
      { name: 'Taichung go套票24／48／72小時', note: '180／280／380元，捷運＋指定公車' },
    ],
    notes: ['「10公里免費」是台中市公車的市民優惠，官網捷運票種沒有這項'],
    sources: [TMRT_TICKETS, TMRT_RULES],
    checkedOn: CHECKED_ON,
    checkPhrases: [
      { url: TMRT_TICKETS, phrases: ['依公告票價之5折收費', '滿6歲至未滿12歲設籍台中市或就讀台中市轄內國小之兒童', '1日票：120元', '24小時票：150元', '48小時票：250元', '臺中市民：299元', '非臺中市民：599元', '臺中市民：699元', '非臺中市民：999元', '每月補助1,000點數'] },
      { url: TMRT_RULES, phrases: ['未滿六歲之兒童（出示身分證明之文件），須由持有車票之旅客陪同免費乘車'] },
    ],
  },
  krtc: {
    operator: 'krtc',
    systems: '高雄捷運＋環狀輕軌',
    rules: [
      { who: '普卡、學生卡', pays: '全票（捷運、輕軌）' },
      { who: '高雄市敬老卡、博愛卡', pays: '捷運半價；輕軌免費', conditions: '敬老卡：設籍高雄65歲以上、55歲以上原住民' },
      { who: '外縣市社福卡', pays: '捷運半價；輕軌半價' },
      { who: '社福單程票（捷運）', pays: '半價', how: '車站服務台', conditions: '65歲以上出示證件、身障者＋陪伴1人' },
      { who: '高雄兒童卡（設籍高雄6–12歲）', pays: '捷運半價；輕軌5折' },
      { who: '新北兒童卡', pays: '捷運半價', conditions: '外縣市兒童卡搭輕軌＝全票' },
      { who: '未滿6歲', pays: '免費', conditions: '由已購票旅客陪同；滿115公分出示證件（捷運、輕軌）' },
    ],
    passes: [
      { name: '捷運24小時卡', ntd: 180 },
      { name: '捷運48小時卡', ntd: 280 },
      { name: 'QR一日／二日捷運券', note: '150／250元（KKday、Klook、Trip.com）' },
      { name: 'QR一日／二日捷運＋輕軌券', note: '200／325元' },
      { name: 'TPASS x MeN Go月票', note: '價格見MeNGo官網' },
    ],
    notes: ['捷運與輕軌之間沒有轉乘優惠（官網只列YouBike轉乘5元）'],
    sources: [KRTC_WELFARE_SINGLE, KRTC_SENIOR, KRTC_CHILD, KRTC_STUDENT, KRTC_OTHER_IPASS, KRTC_HOUR_PASS, KRTC_DAY_QR, KLRT_SENIOR, KLRT_CHILD, KLRT_OTHER_IPASS, KRTC_RULES],
    checkedOn: CHECKED_ON,
    checkPhrases: [
      { url: KRTC_WELFARE_SINGLE, phrases: ['售價金額 單程票半價'] },
      { url: KRTC_SENIOR, phrases: ['設籍本市年滿65歲以上市民及年滿55歲以上原住民', '單程票半價'] },
      { url: KRTC_CHILD, phrases: ['車資費率 單程票半價'] },
      { url: KRTC_STUDENT, phrases: ['車資費率 單程票價'] },
      { url: KRTC_OTHER_IPASS, phrases: ['外縣市優惠記名卡：單程票半價', '新北市兒童卡：單程票半價'] },
      { url: KRTC_HOUR_PASS, phrases: ['24小時卡 $180元', '48小時卡 $280元'] },
      { url: KRTC_DAY_QR, phrases: ['一日捷運效期劵 原價$150元', '二日捷運效期劵 原價$250元', '一日捷運+輕軌效期劵 原價$200元', '二日捷運+輕軌效期劵 原價$325元'] },
      { url: KLRT_SENIOR, phrases: ['高雄輕軌全線免費搭乘'] },
      { url: KLRT_CHILD, phrases: ['搭乘高雄輕軌依單程票之5折收費'] },
      { url: KLRT_OTHER_IPASS, phrases: ['外縣市社福卡：搭乘高雄輕軌依單程票費率計算，享法定半價', '外縣市兒童卡：依一卡通普卡費率收費'] },
      { url: KRTC_RULES, phrases: ['未滿6歲之兒童（身高滿115公分應出示身分證明）'] },
    ],
  },
};

/** What the model reads: the rules without the self-test's phrases. */
export function ticketRulesView(operator: MetroOperator): Omit<TicketRuleSet, 'checkPhrases'> {
  const { checkPhrases: _unused, ...view } = TICKET_RULES[operator];
  return view;
}

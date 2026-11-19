/**
 * Pure text helpers for the Taiwan law connector: article numbers ("第 184-1 條", "184之1",
 * "第二十四條"), article lists and ranges, law names and the short names people use for them.
 * No I/O, so the index builder (as source, in its worker) and the tests share one copy.
 */

/** A law the index knows, as name lookups see it. */
export interface LawNameEntry {
  id: number;
  name: string;
  /** 憲法, 法律 or 命令 as the database labels it. */
  level: string;
  abolished: boolean;
}

/**
 * Short names people use that no in-order reading of the letters finds, or finds ambiguously
 * (刑法 is in 陸海空軍刑法 too). Every target is a law's full name in the database.
 */
export const LAW_ALIASES: Readonly<Record<string, string>> = {
  勞基法: '勞動基準法',
  刑法: '中華民國刑法',
  憲法: '中華民國憲法',
  增修條文: '中華民國憲法增修條文',
  民訴: '民事訴訟法',
  刑訴: '刑事訴訟法',
  行訴: '行政訴訟法',
  個資法: '個人資料保護法',
  消保法: '消費者保護法',
  道交條例: '道路交通管理處罰條例',
  道安規則: '道路交通安全規則',
  性平法: '性別平等工作法',
  性工法: '性別平等工作法',
  勞保條例: '勞工保險條例',
  勞退條例: '勞工退休金條例',
  健保法: '全民健康保險法',
  職安法: '職業安全衛生法',
  家暴法: '家庭暴力防治法',
  租賃專法: '租賃住宅市場發展及管理條例',
  國賠法: '國家賠償法',
  行程法: '行政程序法',
  社維法: '社會秩序維護法',
  毒品條例: '毒品危害防制條例',
  槍砲條例: '槍砲彈藥刀械管制條例',
  政採法: '政府採購法',
  就服法: '就業服務法',
  性騷法: '性騷擾防治法',
  兒少法: '兒童及少年福利與權益保障法',
  公投法: '公民投票法',
  選罷法: '公職人員選舉罷免法',
  證交法: '證券交易法',
  都計法: '都市計畫法',
  食安法: '食品安全衛生管理法',
  公平法: '公平交易法',
  憲訴法: '憲法訴訟法',
  家事法: '家事事件法',
  強執法: '強制執行法',
  營業稅法: '加值型及非加值型營業稅法',
  遺贈稅法: '遺產及贈與稅法',
  兩岸條例: '臺灣地區與大陸地區人民關係條例',
  公寓條例: '公寓大廈管理條例',
  集遊法: '集會遊行法',
  貪污條例: '貪污治罪條例',
  組犯條例: '組織犯罪防制條例',
  詐防條例: '詐欺犯罪危害防制條例',
  跟騷法: '跟蹤騷擾防制法',
  性侵防治法: '性侵害犯罪防治法',
  動保法: '動物保護法',
  資安法: '資通安全管理法',
};

const CN_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1_000 };

/** 二十四 → 24, 一百八十四 → 184, 十 → 10; null when the text is not a Chinese numeral. */
export function chineseNumber(text: string): number | null {
  if (!text || ![...text].every((ch) => ch in CN_DIGITS || ch in CN_UNITS)) return null;
  let total = 0;
  let digit = -1;
  for (const ch of text) {
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch];
      continue;
    }
    total += (digit < 0 ? 1 : digit) * CN_UNITS[ch];
    digit = -1;
  }
  return total + (digit < 0 ? 0 : digit);
}

/** Taiwan's laws write 臺; people write 台 just as often. Compared with 臺 everywhere. */
export function foldLawText(text: string): string {
  return text.normalize('NFKC').replace(/台/g, '臺').replace(/\s+/g, '');
}

/** One article number as two integers: 184-1 → { main: 184, sub: 1 }. */
export interface ArticleRef {
  main: number;
  sub: number;
}

/** "184-1" for { 184, 1 }, "24" for { 24, 0 }: the form the index stores and links use. */
export function articleKey(ref: ArticleRef): string {
  return ref.sub > 0 ? `${ref.main}-${ref.sub}` : String(ref.main);
}

/** Sorts articles in the law's own order: 184 < 184-1 < 185. */
export function articleOrder(ref: ArticleRef): number {
  return ref.main * 1_000 + ref.sub;
}

function numberPart(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  return chineseNumber(text);
}

/**
 * Reads one article number as a person or the database writes it: "第 184-1 條", "184之1",
 * "第一百八十四條之一", "24". Null for anything else.
 */
export function parseArticleRef(text: string): ArticleRef | null {
  const cleaned = text.normalize('NFKC').replace(/\s+/g, '').replace(/^第/, '').replace(/[條条]/g, '').replace(/之/g, '-');
  const match = /^([\d零〇一二三四五六七八九兩十百千]+)(?:-([\d零〇一二三四五六七八九兩十百千]+))?$/.exec(cleaned);
  if (!match) return null;
  const main = numberPart(match[1]);
  const sub = match[2] === undefined ? 0 : numberPart(match[2]);
  if (main === null || sub === null || main <= 0) return null;
  return { main, sub };
}

/** One item of an article list: a single article or an inclusive range. */
export type ArticleSpecItem = { from: ArticleRef; to: ArticleRef };

/**
 * Reads the articles asked for: "24", "184-1", "第184條之1", "1~5", "第24條至第26條", "24、32",
 * "1-5" is article 1-5 (articles have sub-numbers), so ranges use ~, 至 or 到. Returns the items it
 * understood and the pieces it did not.
 */
export function parseArticleSpec(spec: string): { items: ArticleSpecItem[]; unreadable: string[] } {
  const items: ArticleSpecItem[] = [];
  const unreadable: string[] = [];
  const text = spec.normalize('NFKC').replace(/\s*([~至到])\s*/g, '$1');
  for (const piece of text.split(/[,、;\s]+/).filter(Boolean)) {
    const ends = piece.split(/[~至到]/);
    if (ends.length > 2) {
      unreadable.push(piece);
      continue;
    }
    const from = parseArticleRef(ends[0]);
    const to = ends.length === 2 ? parseArticleRef(ends[1]) : from;
    if (!from || !to) {
      unreadable.push(piece);
      continue;
    }
    items.push(articleOrder(from) <= articleOrder(to) ? { from, to } : { from: to, to: from });
  }
  return { items, unreadable };
}

/**
 * Splits "勞基法第24條" into the law and the article part; a name with no article stays whole.
 * Only a 第…條 (or a trailing number) at the end counts, so names are never cut inside.
 */
export function splitLawAndArticles(text: string): { law: string; articles: string } {
  const folded = text.normalize('NFKC').trim();
  const match = /^(.+?)\s*(第\s*[\d零〇一二三四五六七八九兩十百千]+\s*[條条].*)$/.exec(folded);
  if (match && !/[條条]$/.test(match[1])) return { law: match[1].trim(), articles: match[2] };
  return { law: folded, articles: '' };
}

function inOrder(needle: string, hay: string): boolean {
  let at = 0;
  for (const ch of needle) {
    at = hay.indexOf(ch, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

/**
 * How well a law's name answers what was typed; 0 = not at all. An alias or the exact name wins,
 * then a name that starts with it, contains it, or holds its letters in order from the same first
 * letter (勞基法 → 勞動基準法). Laws beat orders, a law in force beats an abolished one, shorter
 * names win ties.
 */
export function lawNameScore(query: string, entry: LawNameEntry): number {
  const q = foldLawText(query);
  if (!q) return 0;
  const name = foldLawText(entry.name);
  const alias = LAW_ALIASES[q] ?? LAW_ALIASES[query.trim()];
  let score = 0;
  if (alias && foldLawText(alias) === name) score = 1_000;
  else if (name === q) score = 900;
  else if (name.startsWith(q)) score = 700;
  else if (name.includes(q)) score = 500;
  else if (q.length >= 2 && name[0] === q[0] && inOrder(q, name)) score = 300;
  if (score === 0) return 0;
  const lengthPenalty = Math.min(150, Math.max(0, name.length - q.length) * 3);
  const levelBonus = entry.level === '命令' ? 0 : 40;
  const abolishedPenalty = entry.abolished ? 400 : 0;
  return Math.max(1, score - lengthPenalty + levelBonus - abolishedPenalty);
}

/** The laws that best match a typed name, best first. */
export function rankLawNames<T extends LawNameEntry>(query: string, entries: readonly T[], limit: number): T[] {
  return entries
    .map((entry) => ({ entry, score: lawNameScore(query, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length)
    .slice(0, limit)
    .map((row) => row.entry);
}

/** "2026/11/6 上午 12:00:00" (the files' UpdateDate) → "2026-11-06"; "" when unreadable. */
export function datasetDate(updateDate: string): string {
  const match = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(updateDate);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

/** "20260817" → "2026-08-17"; anything else as it came. */
export function ymd(compact: string): string {
  return /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}` : compact;
}

/** The official page of one law, or of one article in it. */
export function lawUrl(pcode: string, article?: string): string {
  const base = 'https://law.moj.gov.tw/LawClass/';
  return article
    ? `${base}LawSingle.aspx?pcode=${encodeURIComponent(pcode)}&flno=${encodeURIComponent(article)}`
    : `${base}LawAll.aspx?pcode=${encodeURIComponent(pcode)}`;
}

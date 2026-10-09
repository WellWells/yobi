import { stripUnreadableRegions } from './connectorKeywords';

/**
 * Whether a chat message asks, in so many words, for the web to be searched.
 *
 * The composer's "web" capability is off by default; this is what turns it on for the message
 * that names the act — "上網查", "網頁搜尋", "search the web" — not for one that merely could use
 * fresh facts. A hit spends an agent run, a miss one click on the mode pill, so the table names
 * searching the WEB and nothing broader: "查一下" and "搜尋" alone are as often about the pasted
 * code or the document on screen. Code and quoted lines are material, not intent, and never count.
 */

/** Where: the web, the internet, online — Traditional and Simplified. */
const PLACE = '(?:網頁|网页|網路|网络|網上|网上|線上|线上|上網|上网|互聯網|互联网)';
/** What: search, look up, find. */
const ACT = '(?:搜尋|搜索|搜|查詢|查询|查|找)';
/**
 * A verb followed by 到/過/的/了 or 不到/不出 reports a search already done or failed ("網路上找到這篇",
 * "網上查到的說法", "網路上查了半天", "網上查不到"), it does not ask for one. Not when the character
 * starts a word of its own: 到底, 過去, 過年 ("上網查過去三天的股價" is a request). The optional second
 * character keeps backtracking from splitting 搜尋到 into 搜 + 尋到 and slipping past the guard.
 */
const NOT_REPORTED = '(?![尋索詢询]?(?:到(?!底)|[過过](?![去年])|的|了|不[到出]))';

const WEB_SEARCH_PHRASES: readonly RegExp[] = [
  // Place, then act: 網頁搜尋, 网络搜索, 上網查, 線上找, 網路上搜尋, 在网上去找.
  new RegExp(`${PLACE}\\s*(?:上\\s*)?(?:[去來来]\\s*)?${ACT}${NOT_REPORTED}`),
  // Act, then place: 搜尋網路, 搜一下网页. Only the search verbs — "查網路" is as often "check the network".
  new RegExp(`(?:搜尋|搜索|搜)(?:一下)?\\s*${PLACE}`),
  /聯網|联网/,
  // Fact-checking needs sources outside the conversation. A bare search verb stays out (it is as
  // often "search this file"); a search verb aimed at whether something is TRUE is not that.
  /查證|查证|核實|核实|查核|fact[\s-]?check/i,
  new RegExp(`(?:搜尋|搜索|查詢|查询)${NOT_REPORTED}[^\\n。？?！!]{0,16}?(?:是否正確|是否正确|是否無誤|是否无误|正確無誤|正确无误|是否屬實|是否属实|是不是真的|對不對|对不对)`),
  /(?:google|谷歌|估狗)\s*一下/i,
  /(?<![a-z])(?:web|internet|online)\s+search(?:es|ing)?(?![a-z])/i,
  /(?<![a-z])search(?:es|ing)?\s+(?:the\s+)?(?:web|internet|online)(?![a-z])/i,
  /(?<![a-z])(?:google|googling)\s+(?:it|this|that)(?![a-z])/i,
  /(?<![a-z])look\s+(?:it|this|that)\s+up\s+online(?![a-z])/i,
  /(?<![a-z])browse\s+the\s+web(?![a-z])/i,
];

export function looksLikeWebSearchRequest(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack) return false;
  return WEB_SEARCH_PHRASES.some((pattern) => pattern.test(haystack));
}

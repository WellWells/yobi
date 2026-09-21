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

const WEB_SEARCH_PHRASES: readonly RegExp[] = [
  // Place, then act: 網頁搜尋, 网络搜索, 上網查, 線上找.
  new RegExp(`${PLACE}\\s*${ACT}`),
  // Act, then place: 搜尋網路, 搜一下网页. Only the search verbs — "查網路" is as often "check the network".
  new RegExp(`(?:搜尋|搜索|搜)(?:一下)?\\s*${PLACE}`),
  /聯網|联网/,
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

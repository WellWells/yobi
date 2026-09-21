import { stripUnreadableRegions } from './connectorKeywords';

/**
 * Whether a chat message is asking for a flow to be BUILT, rather than for something to be done
 * once or for an explanation of how flows work.
 *
 * Two signals are required, never one. "建立" alone is most often about a file or a note; "每天"
 * alone is most often a question about a habit. It is the pair — a build verb and something that
 * repeats or is named as automation — that says the user wants a saved flow. A false positive
 * here spends a full agent run answering a question the user asked in passing, so the bar is set
 * where a miss costs one extra click on the mode pill and a hit saves a trip to another view.
 */

const BUILD_VERBS: readonly RegExp[] = [
  /建立|新增|做一個|做個|幫我設定|設定一個|設一個|弄一個|生成一個|產生一個|建一個|搞一個/,
  /(?<![a-z])(?:create|build|make|set ?up|automate|schedule)(?![a-z])/i,
];

const AUTOMATION_CUES: readonly RegExp[] = [
  /流程|自動化|自動執行|排程|定時|定期/,
  /每天|每日|每週|每周|每小時|每分鐘|每月|每隔/,
  /(?<![a-z])(?:flow|workflow|automation|routine)s?(?![a-z])/i,
  /(?<![a-z])(?:every (?:day|morning|hour|minute|week|month)|daily|hourly|weekly|each morning)(?![a-z])/i,
];

/**
 * Openings that make the sentence a question ABOUT building rather than a request to build.
 * "怎麼建立流程" wants an explanation; switching it into an agent run answers the wrong thing
 * and costs the user a run to find out.
 */
const HOW_TO: readonly RegExp[] = [
  // No `\b` on the CJK side: it is an ASCII word boundary, and between two CJK characters there
  // is never one — anchoring it there silently matched nothing.
  /^\s*(?:請問\s*)?(?:如何|怎麼|怎樣|怎么|什麼是|甚麼是|可不可以說明|可以說明)/,
  /^\s*(?:how\s+(?:do|can|would)\s+i|how\s+to|what(?:'s| is)\s+a)\b/i,
];

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function looksLikeFlowRequest(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack || matchesAny(HOW_TO, haystack)) return false;
  return matchesAny(BUILD_VERBS, haystack) && matchesAny(AUTOMATION_CUES, haystack);
}

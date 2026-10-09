import { stripUnreadableRegions } from './connectorKeywords';

/**
 * Whether a chat message asks for a flow to be BUILT, not for a one-off task or an explanation.
 *
 * Two signals are required: a build verb and a repetition or automation cue. Either alone is usually
 * about something else, and a false positive spends a full agent run on a passing question.
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

/** Openings that make the message a question ABOUT building ("how do I create a flow"), not a request to build. */
const HOW_TO: readonly RegExp[] = [
  // No `\b` on the CJK side: it is an ASCII word boundary and never matches between CJK characters.
  /^\s*(?:請問\s*)?(?:如何|怎麼|怎樣|怎么|什麼是|甚麼是|可不可以說明|可以說明)/,
  /^\s*(?:how\s+(?:do|can|would)\s+i|how\s+to|what(?:'s| is)\s+a)\b/i,
];

/**
 * An edit verb counts only next to a flow noun, never a schedule word: "change" alone shows up in
 * too many unrelated requests.
 */
const EDIT_VERBS: readonly RegExp[] = [
  // No "update": asking whether a flow was updated is not a request to change it.
  /修改|改成|改為|改为|改用|改傳|改传|改推|改寄|改送|改一下|改掉|調整|调整|編輯|编辑|換成|换成|加上|拿掉|刪掉|删掉|移除/,
  /(?<![a-z])(?:change|edit|modify|adjust|tweak|switch)(?![a-z])/i,
];

const FLOW_NOUNS: readonly RegExp[] = [
  /流程|自動化|自动化|排程/,
  /(?<![a-z])(?:flow|workflow|automation)s?(?![a-z])/i,
];

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** A request to build a flow, or to change one the user already has — both are agent work. */
export function looksLikeFlowRequest(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack || matchesAny(HOW_TO, haystack)) return false;
  if (matchesAny(BUILD_VERBS, haystack) && matchesAny(AUTOMATION_CUES, haystack)) return true;
  return matchesAny(EDIT_VERBS, haystack) && matchesAny(FLOW_NOUNS, haystack);
}

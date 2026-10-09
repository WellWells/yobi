import { stripUnreadableRegions } from './connectorKeywords';

/**
 * Whether the user's own words ask for in-depth research, which moves `/agent` research from the
 * quick read to the standard pipeline. Read from the user's text, not the model's: a model may pick
 * `quick` even when asked to go deep. In Chinese, "compare" is also an everyday adverb, so it counts
 * only when something is being compared. Code and quoted lines never count.
 */
const DEPTH_PHRASES: readonly RegExp[] = [
  /深入|深度(?:研究|分析|調查|调查|報告|报告)|詳細|详细|詳盡|详尽|全面(?:研究|分析|調查|调查|了解|比較|比较)|徹底|彻底/,
  /完整(?:的)?(?:研究|分析|介紹|介绍|報告|报告|說明|说明|調查|调查|整理)/,
  /(?:比較|比较)(?:一下)?\s*(?:不同|各|兩|两|三|幾|几|這些|这些|他們|它們|它们|彼此|差異|差异|優缺|优缺|異同|异同|哪)/,
  /(?:做|作)(?:個|个|一個|一个)?(?:比較|比较)|對比|对比|異同|异同|各方說法|各方说法|多方(?:來源|来源|說法|说法|比對|比对)|交叉(?:比對|比对|驗證|验证)/,
  /查證|查证|核實|核实|查核|fact[\s-]?check/i,
  /(?<![a-z])(?:in[\s-]depth|deep(?:ly)?\s+(?:research|dive|analysis|look)|thorough(?:ly)?|detailed|comprehensive(?:ly)?|cross[\s-]check)(?![a-z])/i,
  /(?<![a-z])compar(?:e|es|ed|ing|ison)(?![a-z])/i,
];

export function asksForDeepResearch(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack) return false;
  return DEPTH_PHRASES.some((pattern) => pattern.test(haystack));
}

import { stripUnreadableRegions } from './connectorKeywords';
import type { SearchMode } from './types';

const SEARCH_MODES: ReadonlySet<string> = new Set<SearchMode>(['quick', 'standard', 'deep']);

/**
 * What a research call is called at the depth it ran at, wherever it is shown — the app's trace
 * and a bot's progress line alike. A quick one is a web search with an answer, not "research".
 * Null for a depth it does not know.
 */
export function researchLabel(depth: string | undefined, t: (key: string) => string): string | null {
  return depth && SEARCH_MODES.has(depth) ? t(`agent.trace.tool.research.${depth}`) : null;
}

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

/**
 * A run's research depth, decided by the user's own words, never the model's: a model may write
 * "deep" or "quick" whatever it was asked. When the user asked for depth, the run's first research
 * is a deep one and the rest are standard — a deep research already splits the question, and a
 * second one would spend minutes of the run's budget on it again.
 */
export interface ResearchDepth {
  /** The user's words asked for depth. */
  asked: boolean;
  /** No research of this run has gone deep yet. */
  deepAvailable: boolean;
}

export function researchDepthFor(depth: ResearchDepth, written: string): string {
  if (!depth.asked) return written === 'deep' ? 'standard' : written;
  return depth.deepAvailable ? 'deep' : 'standard';
}

export function asksForDeepResearch(text: string): boolean {
  const haystack = stripUnreadableRegions(text).trim();
  if (!haystack) return false;
  return DEPTH_PHRASES.some((pattern) => pattern.test(haystack));
}

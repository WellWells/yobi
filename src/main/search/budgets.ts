import { isByokTargetUrl } from '../../shared/types';
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import { detectProvider, promptPolicyFor } from '../providers';

const BYOK_BUDGET_BYTES = 360_000;
// Covers the purpose line, the result-summary rule and the gap said in the user's terms.
export const PROMPT_OVERHEAD_BYTES = 5_300;
export const PROMPT_OVERHEAD_CPB = 5_300;
// Covers the language rule restated after the sources and the gap wording.
export const LEAN_PROMPT_OVERHEAD_BYTES = 3_100;
export const LEAN_PROMPT_OVERHEAD_CPB = 3_100;
const MIN_BUDGET = 4_000;

const LEAN_CAP_THRESHOLD = 20_000;

function providerCap(targetUrl: string): number {
  const caps = promptPolicyFor(detectProvider(targetUrl));
  return caps.maxCharsPlusBreaks ?? caps.maxBytes ?? 0;
}

export function isLeanPromptProvider(targetUrl: string): boolean {
  if (isByokTargetUrl(targetUrl)) return false;
  return providerCap(targetUrl) < LEAN_CAP_THRESHOLD;
}

export const UNBOUNDED = Number.MAX_SAFE_INTEGER;

export interface SynthesisBudget {
  bytes: number;
  charsPlusBreaks: number;
}

export function synthesisBudget(targetUrl: string): SynthesisBudget {
  if (isByokTargetUrl(targetUrl)) {
    return { bytes: BYOK_BUDGET_BYTES - PROMPT_OVERHEAD_BYTES, charsPlusBreaks: UNBOUNDED };
  }
  const lean = isLeanPromptProvider(targetUrl);
  const overheadBytes = lean ? LEAN_PROMPT_OVERHEAD_BYTES : PROMPT_OVERHEAD_BYTES;
  const overheadCpb = lean ? LEAN_PROMPT_OVERHEAD_CPB : PROMPT_OVERHEAD_CPB;
  const caps = promptPolicyFor(detectProvider(targetUrl));
  return {
    bytes: caps.maxBytes === null
      ? UNBOUNDED
      : Math.max(MIN_BUDGET, caps.maxBytes - overheadBytes),
    charsPlusBreaks: caps.maxCharsPlusBreaks === null
      ? UNBOUNDED
      : Math.max(MIN_BUDGET, caps.maxCharsPlusBreaks - overheadCpb),
  };
}

/**
 * Conversation history is paid for out of the sources' allowance: it goes into the same input
 * window, and a source that no longer fits cannot be cited. Floored at `MIN_BUDGET` so a long
 * thread can crowd the sources but never evict them.
 */
export function reserveForHistory(budget: SynthesisBudget, history: string): SynthesisBudget {
  if (!history) return budget;
  return {
    bytes: budget.bytes === UNBOUNDED
      ? UNBOUNDED
      : Math.max(MIN_BUDGET, budget.bytes - utf8Len(history)),
    charsPlusBreaks: budget.charsPlusBreaks === UNBOUNDED
      ? UNBOUNDED
      : Math.max(MIN_BUDGET, budget.charsPlusBreaks - charsPlusBreaks(history)),
  };
}

const QUICK_BUDGET_BYTES = 24_000;
const QUICK_BUDGET_CPB = 8_000;
/** BYOK has no shared page window: the cap is only how much a quick answer reads (3 bytes a CJK char). */
const QUICK_BYOK_BUDGET_BYTES = 60_000;
const QUICK_BYOK_BUDGET_CPB = 20_000;

/**
 * Quick mode's cap is how much a quick answer reads, not the model's input window, so the
 * conversation is paid for out of the window and the cap applies after. Taking it out of the cap
 * would leave a long follow-up too little room for its sources.
 */
export function quickSynthesisBudget(targetUrl: string, history = ''): SynthesisBudget {
  const window = reserveForHistory(synthesisBudget(targetUrl), history);
  const byok = isByokTargetUrl(targetUrl);
  return {
    bytes: Math.min(window.bytes, byok ? QUICK_BYOK_BUDGET_BYTES : QUICK_BUDGET_BYTES),
    charsPlusBreaks: Math.min(window.charsPlusBreaks, byok ? QUICK_BYOK_BUDGET_CPB : QUICK_BUDGET_CPB),
  };
}

/*
 * Standard mode on a web provider reads 6 pages but packs about what 3 cleaned pages hold: filling
 * the provider's whole window (100 KB on Claude) only makes a larger prompt and a slower answer.
 */
const STANDARD_WEB_BUDGET_BYTES = 90_000;
const STANDARD_WEB_BUDGET_CPB = 30_000;

/** Like quick mode's: the conversation comes out of the window, then the cap applies. */
export function standardWebBudget(targetUrl: string, history = ''): SynthesisBudget {
  const window = reserveForHistory(synthesisBudget(targetUrl), history);
  return {
    bytes: Math.min(window.bytes, STANDARD_WEB_BUDGET_BYTES),
    charsPlusBreaks: Math.min(window.charsPlusBreaks, STANDARD_WEB_BUDGET_CPB),
  };
}

export const MAP_DOC_INPUT_CHARS = 60_000;

/** Instructions + question wrapped around the source text in one map call. */
const MAP_PROMPT_OVERHEAD_CPB = 1_200;
/** Below this a chunk carries too little context to summarize usefully, so we stop splitting. */
const MAP_MIN_CHUNK_CPB = 4_000;

/**
 * How much source text ONE map call may carry on this provider.
 *
 * On BYOK the cap is ours and generous. On a web provider it is the provider's own input limit,
 * which is why the map phase has to chunk rather than trust `preparePromptForProvider` — that
 * truncates, and a truncated map call silently drops the tail of the article it was asked to read.
 */
export function mapDocInputChars(targetUrl: string): number {
  if (isByokTargetUrl(targetUrl)) return MAP_DOC_INPUT_CHARS;
  const cap = providerCap(targetUrl);
  if (cap <= 0) return MAP_DOC_INPUT_CHARS;
  return Math.max(MAP_MIN_CHUNK_CPB, cap - MAP_PROMPT_OVERHEAD_CPB);
}

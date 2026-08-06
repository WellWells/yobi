import { isByokTargetUrl } from '../../shared/types';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../providers';

const BYOK_BUDGET_BYTES = 360_000;
/**
 * What the synthesis prompt costs around the source text: the instruction blocks plus the
 * `[n] url / Title / Published` scaffolding of every source, which the extractor does not
 * budget because it only ever measures `doc.text`.
 *
 * Exported so `test/searchPrompt.test.ts` can pin the real prompt against them instead of
 * re-typing the numbers — the reserve is only meaningful while it still covers the widest
 * prompt the builder can produce (8 sources, every conditional rule block present).
 */
export const PROMPT_OVERHEAD_BYTES = 4_800;
export const PROMPT_OVERHEAD_CPB = 4_800;
/** The same allowance for the lean rule set, whose per-source headers are clamped harder too. */
export const LEAN_PROMPT_OVERHEAD_BYTES = 2_900;
export const LEAN_PROMPT_OVERHEAD_CPB = 2_900;
const MIN_BUDGET = 4_000;

/**
 * Where the full rule set stops paying for itself. On a 12,000-byte provider it is a fifth of
 * the entire prompt — source material the answer never gets to read — while on a 33k one it
 * is noise. Compared against whichever cap actually binds, so a byte limit and a
 * chars-plus-breaks limit are weighed on the same rough "how much text fits" scale.
 */
const LEAN_CAP_THRESHOLD = 20_000;

function providerCap(targetUrl: string): number {
  const caps = PROVIDER_PROMPT_POLICIES[detectProvider(targetUrl)];
  return caps.maxCharsPlusBreaks ?? caps.maxBytes ?? 0;
}

/**
 * Whether this provider gets the condensed synthesis rules. The single source of truth for
 * the tier: `runWebSearch` asks it which rule set to build, and `synthesisBudget` asks it
 * which reserve to subtract, so a lean prompt can never be sized against a full reserve.
 * BYOK is never lean — its budget is self-imposed and 360,000 bytes wide.
 */
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
  const caps = PROVIDER_PROMPT_POLICIES[detectProvider(targetUrl)];
  return {
    bytes: caps.maxBytes === null
      ? UNBOUNDED
      : Math.max(MIN_BUDGET, caps.maxBytes - overheadBytes),
    charsPlusBreaks: caps.maxCharsPlusBreaks === null
      ? UNBOUNDED
      : Math.max(MIN_BUDGET, caps.maxCharsPlusBreaks - overheadCpb),
  };
}

const QUICK_BUDGET_BYTES = 24_000;
const QUICK_BUDGET_CPB = 8_000;

export function quickSynthesisBudget(targetUrl: string): SynthesisBudget {
  const full = synthesisBudget(targetUrl);
  return {
    bytes: Math.min(full.bytes, QUICK_BUDGET_BYTES),
    charsPlusBreaks: Math.min(full.charsPlusBreaks, QUICK_BUDGET_CPB),
  };
}

export const MAP_DOC_INPUT_CHARS = 60_000;

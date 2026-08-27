import { isByokTargetUrl } from '../../shared/types';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../providers';

const BYOK_BUDGET_BYTES = 360_000;
export const PROMPT_OVERHEAD_BYTES = 4_800;
export const PROMPT_OVERHEAD_CPB = 4_800;
export const LEAN_PROMPT_OVERHEAD_BYTES = 2_900;
export const LEAN_PROMPT_OVERHEAD_CPB = 2_900;
const MIN_BUDGET = 4_000;

const LEAN_CAP_THRESHOLD = 20_000;

function providerCap(targetUrl: string): number {
  const caps = PROVIDER_PROMPT_POLICIES[detectProvider(targetUrl)];
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

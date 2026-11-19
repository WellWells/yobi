import { BYOK_REBUILD_BUDGET, SCRATCH_TOTAL_BUDGET, SYNTH_SCRATCH_BUDGET_LEAN } from './agentPrompts';

/**
 * The most of one tool result a BYOK run keeps (in its steps and in its delta): an API key has no
 * prompt cap, so it is the conversation's budget that bounds what one result may take of it.
 */
export const BYOK_OBSERVATION_LIMIT = 16_000;

// BYOK re-sends its whole conversation every turn (the endpoint keeps no thread; a cache hit cuts
// the price, not a free key's quota), so tokens, not steps, are what stops a long BYOK run; sized
// so a self-assessed 40-step run is not cut off early. A longer one (BYOK may assess up to 60)
// answers once it reaches this.
export const AGENT_BYOK_TOKEN_BUDGET = 400_000;
/** The hard stop for the whole run tree (helpers included): past it no turn is asked at all. */
export const AGENT_BYOK_TOKEN_CEILING = 600_000;
/**
 * What one BYOK helper may spend before it must finish, counted from when it started. The tree's
 * ceiling above stays the hard stop.
 */
export const HELPER_BYOK_TOKEN_BUDGET = 200_000;

/*
 * Sizing from the model's context window. Only a window the provider
 * itself reports counts (`byokModelLimits.ts`), never one guessed from the model's name; a window
 * smaller than this keeps today's sizes, which are the floor every larger window scales up from.
 */
export const BYOK_WINDOW_SIZING_MIN_TOKENS = 128_000;
/** The share of the window the run's conversation may fill; the rest is the reply and slack. */
export const BYOK_WINDOW_TRANSCRIPT_SHARE = 0.25;
/**
 * Characters per token, sized for the worst script: CJK text runs about one token a character (more
 * on some tokenizers), so at 1 a fully CJK conversation still fits its share of the window. At 3 a
 * 200k window got 150,000 characters and a Chinese page overflowed it (HTTP 400). The 48,000 floor
 * and 240,000 cap stay, so only windows of about 192k tokens or more grow past today's size.
 */
export const BYOK_CHARS_PER_TOKEN = 1;
/** The most a conversation may grow to however large the window: every turn re-sends all of it. */
export const BYOK_SCRATCH_TOTAL_MAX = 240_000;
/** The rebuilt first message keeps this share of the conversation's budget (today's 0.6). */
export const BYOK_REBUILD_SHARE = 0.6;
/** One tool result takes at most this fraction of the conversation's budget... */
export const BYOK_OBSERVATION_SHARE_DIVISOR = 6;
/** ...and never more than this, so a single page cannot crowd out the rest of the run. */
export const BYOK_OBSERVATION_LIMIT_MAX = 40_000;
/** The final synthesis renders this much more than the conversation (today's 64,000 : 48,000). */
export const BYOK_SYNTH_SCRATCH_RATIO = 4 / 3;
export const BYOK_SYNTH_SCRATCH_MAX = 320_000;
/**
 * The synthesis is a request of its own, so it too must fit the window: at most this share of a
 * known window (at `BYOK_CHARS_PER_TOKEN`), and never under `BYOK_SYNTH_SCRATCH_MIN` — so a 128k
 * window renders 51,200, under the 64,000 an unknown window keeps.
 */
export const BYOK_SYNTH_WINDOW_SHARE = 0.4;
export const BYOK_SYNTH_SCRATCH_MIN = 48_000;
/** The token budgets grow with the conversation, up to these. */
export const AGENT_BYOK_TOKEN_BUDGET_MAX = 1_500_000;
export const AGENT_BYOK_TOKEN_CEILING_MAX = 2_000_000;
export const HELPER_BYOK_TOKEN_BUDGET_MAX = 600_000;

/** Every size a BYOK run is held to. */
export interface ByokBudgets {
  /** The conversation's observation characters before it is rebuilt into one message. */
  scratchTotal: number;
  /** What the steps may take of a rebuilt first message. */
  rebuild: number;
  /** One tool result, in the steps and in a delta. */
  observationLimit: number;
  /** The observation characters the final synthesis (a request of its own) renders. */
  synthScratch: number;
  /** Tokens at which the run must finish. */
  tokenBudget: number;
  /** Tokens past which no further turn is asked. */
  tokenCeiling: number;
  /** Tokens one helper may spend before it must finish. */
  helperTokenBudget: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How endpoints say a request outgrew the model's window (OpenAI / OpenRouter "maximum context
 * length", `context_length_exceeded`; Anthropic "prompt is too long"; Gemini API "input token count
 * … exceeds the maximum"; a 413 "request too large"). Matched lower-cased, on a 400 or 413 only.
 */
const CONTEXT_OVERFLOW_PHRASES = [
  'context length',
  'context_length_exceeded',
  'context window',
  'prompt is too long',
  'too long',
  'too many tokens',
  'token limit',
  'exceeds the maximum',
  'input token count',
  'request too large',
  'too large',
] as const;

function failureStatus(err: unknown): number | undefined {
  // Read by shape (a `ByokFailure` carries it), so the check holds whichever module built the error.
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** A BYOK request refused because it did not fit the model's window. */
export function isContextOverflowError(err: unknown): boolean {
  const status = failureStatus(err);
  if (status !== 400 && status !== 413) return false;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return CONTEXT_OVERFLOW_PHRASES.some((phrase) => message.includes(phrase));
}

/**
 * Why a sized run should step down to today's sizes, or null. A rate limit that outlived the
 * transport retries (`callWithTransportRetry` already tried again after it) counts too: a larger
 * conversation spends a tokens-per-minute quota faster than today's, so a smaller one may pass.
 */
export function windowStepDownReason(err: unknown): 'overflow' | 'rate_limit' | null {
  if (isContextOverflowError(err)) return 'overflow';
  return failureStatus(err) === 429 ? 'rate_limit' : null;
}

/** Whether a run's sizes are above today's, i.e. there is something to step down from. */
export function budgetsAboveDefault(budgets: ByokBudgets): boolean {
  const today = byokBudgets();
  return budgets.scratchTotal > today.scratchTotal || budgets.observationLimit > today.observationLimit;
}

/**
 * A sized run stepped down to today's window-bound sizes after the endpoint refused one of its
 * requests. Its token budgets stay: they bound spend, not the window, and dropping them mid-run to
 * today's 400k / 600k would end a run that had already spent more, not retry it.
 */
export function steppedDownBudgets(budgets: ByokBudgets): ByokBudgets {
  const today = byokBudgets();
  return {
    ...budgets,
    scratchTotal: today.scratchTotal,
    rebuild: today.rebuild,
    observationLimit: today.observationLimit,
    synthScratch: Math.min(budgets.synthScratch, today.synthScratch),
  };
}

/** Whether a reported window is one the budgets are sized from (otherwise today's sizes). */
export function windowSizesBudgets(contextTokens: number | undefined): contextTokens is number {
  return contextTokens !== undefined && Number.isFinite(contextTokens) && contextTokens >= BYOK_WINDOW_SIZING_MIN_TOKENS;
}

/**
 * The one place the engine reads BYOK's budgets. `contextTokens` is the model's context window
 * when the provider reports one; unknown (undefined) or under `BYOK_WINDOW_SIZING_MIN_TOKENS`
 * means today's sizes, byte for byte.
 */
export function byokBudgets(contextTokens?: number): ByokBudgets {
  if (!windowSizesBudgets(contextTokens)) {
    return {
      scratchTotal: SCRATCH_TOTAL_BUDGET,
      rebuild: BYOK_REBUILD_BUDGET,
      observationLimit: BYOK_OBSERVATION_LIMIT,
      synthScratch: SYNTH_SCRATCH_BUDGET_LEAN,
      tokenBudget: AGENT_BYOK_TOKEN_BUDGET,
      tokenCeiling: AGENT_BYOK_TOKEN_CEILING,
      helperTokenBudget: HELPER_BYOK_TOKEN_BUDGET,
    };
  }
  const scratchTotal = clamp(
    Math.round(contextTokens * BYOK_WINDOW_TRANSCRIPT_SHARE * BYOK_CHARS_PER_TOKEN),
    SCRATCH_TOTAL_BUDGET,
    BYOK_SCRATCH_TOTAL_MAX,
  );
  // How many times today's conversation this one is; the token budgets grow with it.
  const scale = scratchTotal / SCRATCH_TOTAL_BUDGET;
  const synthScratch = Math.max(
    BYOK_SYNTH_SCRATCH_MIN,
    Math.min(
      clamp(Math.round(scratchTotal * BYOK_SYNTH_SCRATCH_RATIO), SYNTH_SCRATCH_BUDGET_LEAN, BYOK_SYNTH_SCRATCH_MAX),
      Math.floor(contextTokens * BYOK_SYNTH_WINDOW_SHARE * BYOK_CHARS_PER_TOKEN),
    ),
  );
  return {
    scratchTotal,
    rebuild: Math.floor(scratchTotal * BYOK_REBUILD_SHARE),
    observationLimit: clamp(Math.floor(scratchTotal / BYOK_OBSERVATION_SHARE_DIVISOR), BYOK_OBSERVATION_LIMIT, BYOK_OBSERVATION_LIMIT_MAX),
    synthScratch,
    tokenBudget: clamp(Math.round(AGENT_BYOK_TOKEN_BUDGET * scale), AGENT_BYOK_TOKEN_BUDGET, AGENT_BYOK_TOKEN_BUDGET_MAX),
    tokenCeiling: clamp(Math.round(AGENT_BYOK_TOKEN_CEILING * scale), AGENT_BYOK_TOKEN_CEILING, AGENT_BYOK_TOKEN_CEILING_MAX),
    helperTokenBudget: clamp(Math.round(HELPER_BYOK_TOKEN_BUDGET * scale), HELPER_BYOK_TOKEN_BUDGET, HELPER_BYOK_TOKEN_BUDGET_MAX),
  };
}

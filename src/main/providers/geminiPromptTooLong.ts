/*
 * The one error a Gemini send that would lose its tail fails with. A leaf on purpose: i18n imports
 * it, and nothing here may pull electron in behind it (`geminiSignInState` is a leaf too).
 */
import { geminiPromptCap } from './geminiSignInState';

export const GEMINI_PROMPT_TOO_LONG = 'GEMINI_PROMPT_TOO_LONG';

export function geminiPromptTooLongMessage(limit: number, size: number): string {
  return `${GEMINI_PROMPT_TOO_LONG}: Gemini keeps only ${limit} of ${size} characters; the end of the prompt is missing, so it was not sent`;
}

/** Unanchored: an error from the page arrives wrapped ("Gemini automation failed: Error: …"). */
const TOO_LONG_RE = new RegExp(`${GEMINI_PROMPT_TOO_LONG}: Gemini keeps only (\\d+) of (\\d+) characters`);

export function parseGeminiPromptTooLong(raw: string): { limit: number; size: number } | null {
  const match = TOO_LONG_RE.exec(raw);
  if (!match) return null;
  return { limit: Number(match[1]), size: Number(match[2]) };
}

/**
 * The refusal came before anything was typed or clicked, and the cap is now below `capBefore`: the
 * prompt was sized for a cap that fell on its way, so one sized again now can still go.
 */
export function geminiCapFellSince(capBefore: number, err: unknown): boolean {
  const refused = parseGeminiPromptTooLong(err instanceof Error ? err.message : String(err));
  return refused !== null && geminiPromptCap() < capBefore;
}

/**
 * Runs `send` once more when Gemini's cap fell under it. `send` has to size its prompt when it is
 * called, so the second run is cut to the cap that holds now.
 */
export async function resendIfGeminiCapFell<T>(send: () => Promise<T>, onResend?: (cap: number) => void): Promise<T> {
  const capBefore = geminiPromptCap();
  try {
    return await send();
  } catch (err) {
    if (!geminiCapFellSince(capBefore, err)) throw err;
    onResend?.(geminiPromptCap());
    return send();
  }
}

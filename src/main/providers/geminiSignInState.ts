/*
 * How long a prompt Gemini's web composer keeps depends on whether Gemini is signed in: signed
 * out it keeps the first 32,000 characters and silently drops the rest; signed in it took every
 * length measured up to 1,000,000. Both caps here are in Yobi's chars+breaks unit, which never
 * under-counts against the page ('\n' is 2 here, 1 there).
 *
 * A leaf on purpose: providers/index.ts imports gemini.ts, and both read this.
 *
 * The state lives in memory only. Unknown = signed out, so a send before the first cookie read,
 * or after a read that failed, is sized for the smaller cap.
 */

export const GEMINI_SIGNED_OUT_PROMPT_CAP = 32_000;
export const GEMINI_SIGNED_IN_PROMPT_CAP = 100_000;

/** The last cookie read. */
let cookieSignedIn = false;
/** The last readable picker showed the sign-in row. */
let pageSignedOut = false;
/** The composer was seen keeping only this much. */
let composerCutAt: number | null = null;
/** Bumped by every real session change, so a read started before it cannot overwrite it. */
let generation = 0;
let cookieReader: (() => Promise<boolean>) | null = null;

/** The cap a Gemini prompt has to fit right now. */
export function geminiPromptCap(): number {
  const base = cookieSignedIn && !pageSignedOut ? GEMINI_SIGNED_IN_PROMPT_CAP : GEMINI_SIGNED_OUT_PROMPT_CAP;
  return composerCutAt === null ? base : Math.min(base, composerCutAt);
}

/** Runs `change` and reports whether the cap moved. */
function capChanged(change: () => void): boolean {
  const before = geminiPromptCap();
  change();
  return geminiPromptCap() !== before;
}

export function setGeminiCookieReader(read: () => Promise<boolean>): void {
  cookieReader = read;
}

/** Re-reads the sign-in cookie; a read that a session change overtook is dropped. */
export async function refreshGeminiSignIn(): Promise<void> {
  const read = cookieReader;
  if (!read) return;
  const started = generation;
  let signedIn = false;
  try {
    signedIn = await read();
  } catch {
    signedIn = false;
  }
  if (generation !== started) return;
  noteGeminiCookieRead(signedIn);
}

/** A plain cookie read. Only a change to signed in clears what the page showed. */
export function noteGeminiCookieRead(signedIn: boolean): boolean {
  return capChanged(() => {
    if (signedIn && !cookieSignedIn) {
      pageSignedOut = false;
      composerCutAt = null;
    }
    cookieSignedIn = signedIn;
  });
}

/** Yobi signed Gemini in or out (sign-in window, clear data): every earlier sign of the page is stale. */
export function noteGeminiSessionChanged(signedIn: boolean): boolean {
  return capChanged(() => {
    generation++;
    cookieSignedIn = signedIn;
    pageSignedOut = false;
    composerCutAt = null;
  });
}

/**
 * What the model picker showed. Signed in only lifts the picker's own block; raising the cap
 * needs the cookie, so a picker that says signed in while the cookie does not starts a re-read.
 */
export function noteGeminiPageSignIn(signedIn: boolean): boolean {
  const changed = capChanged(() => {
    if (signedIn && pageSignedOut) composerCutAt = null;
    pageSignedOut = !signedIn;
  });
  if (signedIn && !cookieSignedIn) void refreshGeminiSignIn();
  return changed;
}

/** The composer kept only `kept`; less than the signed-out cap is a fill fault, not a cap. */
export function noteGeminiComposerCut(kept: number): boolean {
  return capChanged(() => {
    const floor = Math.max(GEMINI_SIGNED_OUT_PROMPT_CAP, kept);
    composerCutAt = Math.min(composerCutAt ?? Number.POSITIVE_INFINITY, floor);
  });
}

export function resetGeminiSignInStateForTests(): void {
  cookieSignedIn = false;
  pageSignedOut = false;
  composerCutAt = null;
  generation = 0;
  cookieReader = null;
}

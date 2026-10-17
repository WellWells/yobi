import type { WebContents } from 'electron';
import { withTimeout } from '../promiseRace';

export async function executeAutomationWithTimeout<T>(
  wc: WebContents,
  script: string,
  timeoutMs: number,
  providerLabel: string,
): Promise<T> {
  const hardTimeoutMs = Math.max(timeoutMs * 5, 300_000);
  try {
    return (await withTimeout(
      wc.executeJavaScript(script, true),
      hardTimeoutMs,
      () => new Error(`${providerLabel} automation timed out (Node side)`),
    )) as T;
  } catch (err: unknown) {
    // i18n.ts reads this prefix (AUTOMATION_FAILED_RE) to localize the failure.
    throw new Error(`${providerLabel} automation failed: ${(err as Error).message}`);
  }
}

/** Runs a page script with a user gesture; rejects with "timed out after N ms" if it hangs. */
export function executeWithTimeout<T>(wc: WebContents, script: string, timeoutMs: number): Promise<T> {
  return withTimeout(
    wc.executeJavaScript(script, true) as Promise<T>,
    timeoutMs,
    () => new Error(`timed out after ${timeoutMs} ms`),
  );
}

export async function countElements(wc: WebContents, selector: string): Promise<number> {
  try {
    return (await wc.executeJavaScript(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      false,
    )) as number;
  } catch {
    return 0;
  }
}

/** One count per selector, all read in a single round trip; 0 for each when the page cannot answer. */
async function countEach(wc: WebContents, selectors: readonly string[]): Promise<number[]> {
  try {
    const counts = (await wc.executeJavaScript(
      `${JSON.stringify(selectors)}.map(function (s) { return document.querySelectorAll(s).length; })`,
      false,
    )) as unknown;
    if (Array.isArray(counts) && counts.length === selectors.length) {
      return counts.map((n) => (typeof n === 'number' ? n : 0));
    }
  } catch {
    // Mid-navigation the page cannot answer; treat it like countElements does.
  }
  return selectors.map(() => 0);
}

const SETTLE_INTERVAL_MS = 200;
const SETTLE_SAMPLES = 3;
const SETTLE_TIMEOUT_MS = 8_000;

/** Counts once every selector has read the same for SETTLE_SAMPLES samples in a row. */
export async function settledElementCounts(wc: WebContents, selectors: readonly string[]): Promise<number[]> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let counts = await countEach(wc, selectors);
  let stable = 1;
  while (stable < SETTLE_SAMPLES && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
    const current = await countEach(wc, selectors);
    if (current.every((n, i) => n === counts[i])) {
      stable += 1;
      continue;
    }
    counts = current;
    stable = 1;
  }
  return counts;
}

/**
 * Answer counts to anchor a send on, one per selector. Only a page that may still be rendering
 * earlier answers in waits for them to hold still; any other page's counts are final as read.
 */
export async function anchorCounts(
  wc: WebContents,
  selectors: readonly string[],
  mayStillRender: boolean,
): Promise<number[]> {
  return mayStillRender ? settledElementCounts(wc, selectors) : countEach(wc, selectors);
}

export async function dispatchFocusEvents(wc: WebContents): Promise<void> {
  await wc.executeJavaScript(`
    window.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  `, false);
}

import type { WebContents } from 'electron';

export async function executeAutomationWithTimeout<T>(
  wc: WebContents,
  script: string,
  timeoutMs: number,
  providerLabel: string,
): Promise<T> {
  const hardTimeoutMs = Math.max(timeoutMs * 5, 300_000);

  let nodeTimeoutId!: ReturnType<typeof setTimeout>;
  const nodeTimeout = new Promise<never>((_, reject) => {
    nodeTimeoutId = setTimeout(
      () => reject(new Error(`${providerLabel} automation timed out (Node side)`)),
      hardTimeoutMs,
    );
  });

  try {
    return (await Promise.race([wc.executeJavaScript(script, true), nodeTimeout])) as T;
  } catch (err: unknown) {
    throw new Error(`${providerLabel} automation failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(nodeTimeoutId);
  }
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

const SETTLE_INTERVAL_MS = 200;
const SETTLE_SAMPLES = 3;
const SETTLE_TIMEOUT_MS = 8_000;

export async function settledElementCount(wc: WebContents, selector: string): Promise<number> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let count = await countElements(wc, selector);
  let stable = 1;
  while (stable < SETTLE_SAMPLES && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
    const current = await countElements(wc, selector);
    if (current === count) {
      stable += 1;
      continue;
    }
    count = current;
    stable = 1;
  }
  return count;
}

export async function dispatchFocusEvents(wc: WebContents): Promise<void> {
  await wc.executeJavaScript(`
    window.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  `, false);
}

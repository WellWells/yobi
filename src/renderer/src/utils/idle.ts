/**
 * Run work once the first paint is out of the way. Everything scheduled here is
 * a warm-up: it must never be required for the UI to be usable, because a busy
 * renderer can push the callback out to the timeout.
 */
const IDLE_TIMEOUT_MS = 2_000;

export function onIdle(task: () => void, timeout: number = IDLE_TIMEOUT_MS): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 0);
  return () => window.clearTimeout(handle);
}

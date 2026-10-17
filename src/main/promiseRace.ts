/**
 * The two races every "wait for this, but not forever / not past Stop" call site needs. Each caller
 * passes its own error: the wording is not cosmetic. `metricsNormalize.ts` counts a failure as a
 * timeout only when its message says "timed out", and the flow executor tells a Stop from a failure
 * by the error's type.
 */

/**
 * Settles like `work`, or rejects with `makeError()` once `ms` pass first. `onTimeout` runs just
 * before that rejection (to abort what `work` is waiting on). The timer is cleared as soon as
 * `work` settles, so a fast answer leaves nothing pending. `work` itself is not cancelled.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  makeError: () => unknown,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(makeError());
    }, ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * `withTimeout` for a setup step of a hidden signed-in window (X, Instagram): "<what> did not
 * finish within N s". That wording has no "timed out", so the stats count it as a failure.
 */
export function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return withTimeout(work, ms, () => new Error(`${what} did not finish within ${ms / 1_000} s`));
}

/**
 * Settles like `work`, or rejects with `toError(signal)` (the signal's reason by default) as soon as
 * `signal` fires, without waiting for `work` — which goes on, its later failure swallowed. No signal
 * returns `work` as is.
 */
export function raceAbort<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  toError: (signal: AbortSignal) => unknown = (s) => s.reason,
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(toError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(toError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

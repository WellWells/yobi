import { raceAbort } from '../../promiseRace';

export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('The upload was stopped', 'AbortError');
}

/**
 * Rejects as soon as `signal` fires, without waiting for `work`: mtcute does not stop every call
 * on a signal (a sign-in stuck reconnecting never settles). The abandoned work's own failure is
 * swallowed; the caller closes whatever it was running on.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  return raceAbort(work, signal, abortReason);
}

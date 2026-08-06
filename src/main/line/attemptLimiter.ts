const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1_000;

export interface AttemptLimiter {
  isBlocked: (key: string) => boolean;
  recordFailure: (key: string) => void;
  reset: (key: string) => void;
}

export function createAttemptLimiter(): AttemptLimiter {
  const failures = new Map<string, number[]>();

  const recentFailures = (key: string): number[] => {
    const cutoff = Date.now() - WINDOW_MS;
    const kept = (failures.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length > 0) {
      failures.set(key, kept);
    } else {
      failures.delete(key);
    }
    return kept;
  };

  return {
    isBlocked: (key) => recentFailures(key).length >= MAX_FAILURES,
    recordFailure: (key) => {
      failures.set(key, [...recentFailures(key), Date.now()]);
    },
    reset: (key) => {
      failures.delete(key);
    },
  };
}

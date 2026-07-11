const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1_000;

export interface AttemptLimiter {
  isBlocked: (key: string) => boolean;
  recordFailure: (key: string) => void;
  reset: (key: string) => void;
}

// Throttles pairing-code guesses per LINE userId. The real defence is the code
// itself (8 chars of a 32-symbol alphabet, 60-minute TTL, reachable only through
// a signature-verified webhook from a user who already added the bot); this just
// stops a script from grinding through guesses. In-memory on purpose — a restart
// clearing the counters is harmless.
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

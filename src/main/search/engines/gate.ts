import { Semaphore } from '../../flow/lanes';

/** An engine refused us (verification page, rate limit) or is still cooling down from one. */
export class SerpChallengeError extends Error {
  readonly engine: string;

  constructor(engine: string, marker: string) {
    super(`${engine} returned a verification page instead of results (${marker})`);
    this.engine = engine;
  }
}

/** The engine's pacing would hold this query past its wait budget, so it was never sent. */
export class EngineBusyError extends Error {
  constructor(engine: string) {
    super(`${engine} is pacing earlier queries — skipped`);
  }
}

export interface EngineGateOptions {
  engine: string;
  /** Requests in flight at once. */
  concurrency: number;
  /** Starts allowed back to back from idle. */
  burst: number;
  /** One more start per this many milliseconds. */
  refillMs: number;
  /** Nothing is sent this long after a refusal that named no wait of its own. */
  cooldownMs: number;
  /** A query whose start is further away than this is skipped instead of queued; absent = always wait. */
  maxWaitMs?: number;
  /** Up to this much is added at random to every wait, so queued queries do not leave on a metronome. */
  jitterMs?: number;
}

export interface EngineGate {
  run<T>(task: () => Promise<T>): Promise<T>;
  /**
   * Records a refusal: nothing goes out, queued queries included, until `ms` from now. Without
   * `ms` the default cooldown doubles each time the engine refuses again right after one ended
   * (up to an hour).
   */
  block(ms?: number): void;
  /** The engine answered: the next refusal starts from the default cooldown again. */
  answered(): void;
}

/** Longest any cooldown runs; a bogus day-long `Retry-After` must not end search for the day. */
const MAX_COOLDOWN_MS = 60 * 60_000;

/**
 * App-wide pacing for one search engine: a cap on requests in flight, a bucket of starts that
 * refills one per `refillMs` (a cap on concurrency alone lets a burst through, because a results
 * page returns in a few hundred milliseconds and frees its slot), and a cooldown after a refusal,
 * during which callers get `SerpChallengeError` without touching the network.
 */
export function createEngineGate(options: EngineGateOptions): EngineGate {
  const { engine, burst, refillMs, cooldownMs, maxWaitMs, jitterMs = 0 } = options;
  const lane = new Semaphore(options.concurrency);
  let tokens = burst;
  let tokensAt = 0;
  let blockedUntil = 0;
  let refusalsInARow = 0;
  let lastWait = 0;

  const throwIfBlocked = (now: number): void => {
    if (now >= blockedUntil) return;
    throw new SerpChallengeError(engine, `cooling down, ${Math.ceil((blockedUntil - now) / 1_000)} s left`);
  };

  const awaitStart = async (deadline: number): Promise<void> => {
    for (;;) {
      const now = Date.now();
      // Checked on every pass: a query queued here must not go out after its neighbour was refused.
      throwIfBlocked(now);
      tokens = Math.min(burst, tokens + Math.max(0, now - tokensAt) / refillMs);
      tokensAt = now;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      const wait = Math.ceil((1 - tokens) * refillMs + Math.random() * jitterMs);
      if (now + wait > deadline) throw new EngineBusyError(engine);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const now = Date.now();
      throwIfBlocked(now);
      const deadline = maxWaitMs === undefined ? Number.POSITIVE_INFINITY : now + maxWaitMs;
      return lane.runExclusive(async () => {
        await awaitStart(deadline);
        return task();
      });
    },
    block(ms?: number): void {
      const now = Date.now();
      // Requests already in flight when the first refusal landed belong to that refusal.
      if (now < blockedUntil) {
        if (ms !== undefined) blockedUntil = Math.max(blockedUntil, now + Math.min(ms, MAX_COOLDOWN_MS));
        return;
      }
      // Refused again soon after a cooldown ended: the engine is extending its own penalty with
      // every probe, so stay away twice as long. Long after, it is a new episode.
      if (now - blockedUntil > lastWait) refusalsInARow = 0;
      const wait = Math.min(ms ?? cooldownMs * 2 ** refusalsInARow, MAX_COOLDOWN_MS);
      refusalsInARow += 1;
      lastWait = wait;
      blockedUntil = now + wait;
    },
    answered(): void {
      refusalsInARow = 0;
    },
  };
}

/** `Retry-After` in milliseconds, when the engine sent a usable one (seconds or an HTTP date). */
export function retryAfterMs(header: string | undefined, now: number = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) || at <= now ? undefined : at - now;
}

/** `zh-TW` → `zh-TW,zh;q=0.9`: the region first, its bare language as the fallback a browser sends. */
export function acceptLanguageFor(locale: string): string {
  const [language] = locale.split('-');
  return language && language !== locale ? `${locale},${language};q=0.9` : locale;
}

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  /** Every slot is taken, so the next `acquire` would wait. */
  get busy(): boolean {
    return this.active >= this.max;
  }

  /**
   * Waits for a slot. An aborted `signal` rejects a caller that is still WAITING and takes it out of
   * the queue, so Stop is not held up behind someone else's request; once a slot is granted the
   * caller owns it and must `release` it, abort or not.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    if (signal?.aborted) throw new Error('aborted while waiting for a slot');
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const at = this.waiters.indexOf(granted);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(new Error('aborted while waiting for a slot'));
      };
      const granted = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.push(granted);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const llmLane = new Mutex();
export const clipboardLane = new Mutex();
export const pageFetchLane = new Mutex();
/**
 * Serializes YouTube transcript fetches.
 *
 * They all share the `persist:youtube` partition, and a fetch that fails its first attempt
 * calls `clearStorageData()` on it before retrying — which wipes the cookies out from under
 * any other fetch in flight. Two callers can reach this without any flow concurrency at all
 * (a flow's youtube step and a YouTube URL pasted at the hotkey), so the lane belongs here
 * regardless of MAX_CONCURRENT_FLOWS.
 *
 * Timeout arithmetic, since the wait counts against the step: a fetch caps itself at 135 s
 * ((25 s load + 40 s extract) x 2 attempts + 5 s) and the `youtube` step gets 300 s, so one
 * queued fetch still fits (135 waiting + 135 running). THREE-way contention does not — two
 * flow steps plus a hotkey paste can push the third past 300 s and report a timeout when it
 * was only ever waiting. Left as is: the alternative it replaced was both fetches corrupting
 * each other, and the step is fail-soft (`isFailed=1`) rather than fatal.
 */
export const youtubeLane = new Mutex();

export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private held = 0;

  /** Someone holds the lock or waits for it — background work should come back later. */
  get busy(): boolean {
    return this.held > 0;
  }

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.held++;
    const run = this.tail.then(fn, fn);
    this.tail = run.then(() => undefined, () => undefined);
    void this.tail.then(() => { this.held--; });
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
 * Serializes YouTube transcript fetches: they share the `persist:youtube` partition, and a retry
 * calls `clearStorageData()` on it, which would wipe another fetch's cookies mid-flight.
 * A fetch caps at 135 s and the step at 300 s, so one queued fetch fits; three-way contention can
 * time out a step that was only waiting (the step is fail-soft).
 */
export const youtubeLane = new Mutex();

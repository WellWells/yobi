/*
 * What a pasted link's read gave (a post, a video's details), kept in memory for a while so the
 * same link pasted again answers at once instead of reading the site again. Memory only: a
 * restart forgets it, and nothing of anyone's post is written to disk. Only reads that worked are
 * kept; a key carries everything that changes what the read may see (who reads, with which
 * sign-in), so one person's read never answers another's wider one.
 */

interface Entry<T> {
  value: T;
  expires: number;
}

/** How many reads one cache keeps; the least recently used goes first. */
const DEFAULT_MAX_ENTRIES = 200;

/** Off while Vitest runs, so one test's read never answers another's; a test that is about the cache turns it on. */
let enabled = !process.env.VITEST;

export function setReadCachesEnabled(on: boolean): void {
  enabled = on;
  if (!on) for (const cache of caches) cache.clear();
}

const caches = new Set<ReadCache<unknown>>();

export class ReadCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {
    caches.add(this as ReadCache<unknown>);
  }

  /** The value kept under `key` and not yet expired; it becomes the most recently used. */
  get(key: string): T | undefined {
    if (!enabled) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (!enabled || ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** A read and whether it came from the cache: a caller whose later step fails may read once more, fresh. */
export interface CachedRead<T> {
  value: T;
  cached: boolean;
}

export interface ReadThroughOptions<T> {
  /** Whether a read is worth keeping (a read the site held back is not); default every read. */
  keep?: (value: T) => boolean;
  /**
   * A copy of plain data, made going in and coming out: a caller changing what it got must not
   * change what the next caller gets. Absent for a value holding functions, used as it is.
   */
  copy?: (value: T) => T;
}

/**
 * The kept value for `key`, else `read()`'s, kept for `ttlMs` when `keep` allows. A failed or
 * stopped read keeps nothing.
 */
export async function readThrough<T>(
  cache: ReadCache<T>,
  key: string,
  ttlMs: number,
  read: () => Promise<T>,
  options: ReadThroughOptions<T> = {},
): Promise<CachedRead<T>> {
  const copy = options.copy ?? ((value: T) => value);
  const kept = cache.get(key);
  if (kept !== undefined) return { value: copy(kept), cached: true };
  const value = await read();
  if (options.keep?.(value) ?? true) cache.set(key, copy(value), ttlMs);
  return { value, cached: false };
}

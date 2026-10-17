/**
 * One cache for every rail source, shared by everyone who asks: a delay list fetched for one
 * question answers every other question for as long as it is fresh, and two questions arriving
 * together wait on the same request (a bot answering many people must not multiply upstream
 * calls). Timetables are also kept on disk, one file per source and date, so a restart does not
 * fetch them again; a failed refresh falls back to what was there, marked stale.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { errorText } from '../../shared/errorText';
import { writeFileAtomic } from '../atomicWrite';

/** The timetable cache's folder under userData; a factory reset deletes it, a backup leaves it out. */
export const RAIL_CACHE_DIR_NAME = 'rail-cache';

export interface Cached<T> {
  value: T;
  /** When the value was fetched (or last confirmed unchanged), epoch ms. */
  at: number;
  /** Source bookkeeping kept with the value (a Last-Modified header). */
  meta?: string;
  /** Set when the refresh failed and this is the previous value. */
  stale?: { error: string };
}

export type StoredLoad<T> = (previous: Cached<T> | undefined) => Promise<{ value: T; meta?: string } | 'unchanged'>;

const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*$/u;
const DATED_FILE = /(\d{4}-\d{2}-\d{2})\.json$/u;

export class RailCache {
  private readonly memory = new Map<string, Cached<unknown>>();
  private readonly inflight = new Map<string, Promise<Cached<unknown>>>();

  constructor(private readonly dir: string | null, private readonly now: () => number) {}

  /** The value already held for `key`, however old, without fetching. */
  peek<T>(key: string): Cached<T> | undefined {
    return this.memory.get(key) as Cached<T> | undefined;
  }

  private shared<T>(key: string, run: () => Promise<Cached<T>>): Promise<Cached<T>> {
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<Cached<T>>;
    const started = run().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started as Promise<Cached<unknown>>);
    return started;
  }

  /** In memory only: reused while younger than `ttlMs`. */
  memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<Cached<T>> {
    const held = this.peek<T>(key);
    if (held && !held.stale && this.now() - held.at < ttlMs) return Promise.resolve(held);
    return this.shared(key, async () => {
      try {
        const fresh: Cached<T> = { value: await load(), at: this.now() };
        this.memory.set(key, fresh);
        return fresh;
      } catch (err) {
        if (!held) throw err;
        return { ...held, stale: { error: errorText(err) } };
      }
    });
  }

  /** In memory and on disk: reused while younger than `maxAgeMs`, then refreshed through `load`. */
  stored<T>(key: string, maxAgeMs: number, load: StoredLoad<T>): Promise<Cached<T>> {
    if (!SAFE_KEY.test(key)) throw new Error(`Bad cache key: ${key}`);
    const held = this.peek<T>(key);
    if (held && !held.stale && this.now() - held.at < maxAgeMs) return Promise.resolve(held);
    return this.shared(key, async () => {
      const previous = held ?? await this.readFile<T>(key);
      if (previous && !held) this.memory.set(key, previous);
      if (previous && this.now() - previous.at < maxAgeMs) return previous;
      try {
        const result = await load(previous);
        if (result === 'unchanged' && !previous) throw new Error(`${key}: source said unchanged but nothing is cached`);
        const source = result === 'unchanged' ? (previous as Cached<T>) : result;
        const fresh: Cached<T> = { value: source.value, at: this.now(), ...(source.meta ? { meta: source.meta } : {}) };
        this.memory.set(key, fresh);
        await this.writeFile(key, fresh);
        return fresh;
      } catch (err) {
        if (!previous) throw err;
        return { ...previous, stale: { error: errorText(err) } };
      }
    });
  }

  private file(key: string): string | null {
    return this.dir ? path.join(this.dir, `${key}.json`) : null;
  }

  private async readFile<T>(key: string): Promise<Cached<T> | undefined> {
    const file = this.file(key);
    if (!file) return undefined;
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Cached<T>;
      return typeof parsed?.at === 'number' && 'value' in parsed ? { value: parsed.value, at: parsed.at, ...(parsed.meta ? { meta: parsed.meta } : {}) } : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeFile<T>(key: string, entry: Cached<T>): Promise<void> {
    const file = this.file(key);
    if (!file || !this.dir) return;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await writeFileAtomic(file, JSON.stringify({ at: entry.at, meta: entry.meta, value: entry.value }));
    } catch {
      // A cache that cannot be written still answers from memory; the next launch fetches again.
    }
  }

  /** Deletes the dated files for days before `today` (`YYYY-MM-DD`), and forgets them in memory. */
  async sweep(today: string): Promise<void> {
    for (const key of [...this.memory.keys()]) {
      const date = DATED_FILE.exec(`${key}.json`)?.[1];
      if (date && date < today) this.memory.delete(key);
    }
    if (!this.dir) return;
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    await Promise.all(names.map(async (name) => {
      const date = DATED_FILE.exec(name)?.[1];
      if (date && date < today) await fs.rm(path.join(this.dir as string, name), { force: true }).catch(() => undefined);
    }));
  }
}

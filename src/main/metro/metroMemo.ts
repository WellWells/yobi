/**
 * The metro tools' cache: one upstream answer serves everyone asking while it is young (a bot in
 * a busy group must not multiply requests to an operator's site), and questions arriving together
 * wait on the same request. Unlike the rail timetables there is no stale fallback: an old arrival
 * board is a wrong answer, so a failed refresh fails. Memory only — nothing here outlives the app.
 */
import type { MetroMemo } from './metroTypes';

/** Past this many entries, expired ones are dropped on the next store. */
const SWEEP_AT = 400;

export function createMetroMemo(now: () => number = Date.now): MetroMemo {
  const held = new Map<string, { value: unknown; until: number }>();
  const inflight = new Map<string, Promise<unknown>>();

  function sweep(): void {
    const time = now();
    for (const [key, entry] of held) if (entry.until <= time) held.delete(key);
  }

  return async <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
    const entry = held.get(key);
    if (entry && entry.until > now()) return entry.value as T;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
    const started = load()
      .then((value) => {
        if (held.size >= SWEEP_AT) sweep();
        held.set(key, { value, until: now() + ttlMs });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, started);
    return started;
  };
}

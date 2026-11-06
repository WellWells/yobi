import type { SerpHit, TemporalFilter } from './types';

/*
 * The same query seconds or minutes later — an agent retrying, a follow-up on the same subject,
 * two bot users asking alike — is answered from here without a request. Memory only, and only
 * results that came back non-empty: an empty or refused answer is worth asking again.
 */
export const SERP_CACHE_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;

interface Entry {
  hits: SerpHit[];
  at: number;
}

const entries = new Map<string, Entry>();

/** Case, spacing and punctuation do not make a different query. */
export function serpCacheKey(query: string, temporal: TemporalFilter, locale: string): string {
  const words = query.toLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}]+/gu, ' ').trim().split(/\s+/);
  return `${locale}|${temporal}|${words.join(' ')}`;
}

/** The hits and how old they are, or undefined when nothing fresh is remembered. */
export function recalledSerp(key: string, now: number = Date.now()): { hits: SerpHit[]; ageMs: number } | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  const ageMs = now - entry.at;
  if (ageMs >= SERP_CACHE_TTL_MS || ageMs < 0) {
    entries.delete(key);
    return undefined;
  }
  return { hits: entry.hits, ageMs };
}

export function rememberSerp(key: string, hits: SerpHit[], now: number = Date.now()): void {
  if (hits.length === 0) return;
  entries.delete(key);
  entries.set(key, { hits, at: now });
  // Map keeps insertion order: the first key is the least recently stored.
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

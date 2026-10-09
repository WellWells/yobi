import { fetchPlaceReviews, resolvePlace } from './mapReviews';
import type { MapReview, PlaceRef } from './mapReviews';
import { fetchPlaceStats } from './mapPlaceStats';
import type { PlaceStats } from './mapPlaceStats';

export const PLACE_CACHE_TTL_MS = 6 * 60 * 60_000;
export const PLACE_CACHE_MAX = 20;

const SAMPLE = { sort: 'mixed', count: 100 } as const;

export interface PlaceData {
  placeId: string;
  place: string;
  placeUrl: string;
  reviews: MapReview[];
  stats: PlaceStats | null;
  fetchedAt: number;
}

export interface LoadPlaceOptions {
  hl: string;
  onLog?: (message: string) => void;
}

interface Entry {
  data: PlaceData;
  statsRetried: boolean;
}

const entries = new Map<string, Entry>();
const aliases = new Map<string, string>();
const inFlight = new Map<string, Promise<PlaceData>>();

function isFresh(entry: Entry): boolean {
  return Date.now() - entry.data.fetchedAt <= PLACE_CACHE_TTL_MS;
}

function store(key: string, data: PlaceData): void {
  entries.delete(key);
  entries.set(key, { data, statsRetried: false });
  while (entries.size > PLACE_CACHE_MAX) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
    for (const [alias, target] of aliases) {
      if (target === oldest) aliases.delete(alias);
    }
  }
}

async function hit(key: string, entry: Entry, opts: LoadPlaceOptions): Promise<PlaceData> {
  entries.delete(key);
  entries.set(key, entry);
  const minutes = Math.round((Date.now() - entry.data.fetchedAt) / 60_000);
  opts.onLog?.(`using the cached reviews of "${entry.data.place || entry.data.placeId}" (fetched ${minutes} min ago)`);
  if (entry.data.stats || entry.statsRetried) return entry.data;

  entry.statsRetried = true;
  const stats = await fetchPlaceStats(entry.data.placeUrl, { onLog: opts.onLog }).catch(() => null);
  if (stats) entry.data = { ...entry.data, stats };
  return entry.data;
}

async function fetchPlace(ref: PlaceRef, key: string, opts: LoadPlaceOptions): Promise<PlaceData> {
  const result = await fetchPlaceReviews(ref, { ...SAMPLE, hl: opts.hl, onLog: opts.onLog });
  const stats = result.reviews.length > 0
    ? await fetchPlaceStats(result.placeUrl, { onLog: opts.onLog }).catch(() => null)
    : null;
  const data: PlaceData = {
    placeId: ref.placeId,
    place: result.place,
    placeUrl: result.placeUrl,
    reviews: result.reviews,
    stats,
    fetchedAt: Date.now(),
  };
  if (data.reviews.length > 0) store(key, data);
  return data;
}

/** The review sample and overall stats of the place behind `url`, from memory when still fresh. */
export async function loadPlaceData(url: string, opts: LoadPlaceOptions): Promise<PlaceData> {
  const aliasKey = `${url.trim()}|${opts.hl}`;
  const aliased = aliases.get(aliasKey);
  const aliasedEntry = aliased ? entries.get(aliased) : undefined;
  if (aliased && aliasedEntry && isFresh(aliasedEntry)) return hit(aliased, aliasedEntry, opts);

  const ref = await resolvePlace(url, opts.onLog);
  const key = `${ref.placeId}|${opts.hl}`;
  aliases.set(aliasKey, key);
  const entry = entries.get(key);
  if (entry && isFresh(entry)) return hit(key, entry, opts);

  const pending = inFlight.get(key);
  if (pending) return pending;
  const fetching = fetchPlace(ref, key, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, fetching);
  return fetching;
}

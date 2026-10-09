/**
 * How long a cached model list is trusted before it is re-read in the background. `updatedAt` is the
 * last successful read, not the last change, so a rarely used provider still picks up new models.
 */
export const MODEL_CATALOG_MAX_AGE_MS = 12 * 60 * 60_000;

/**
 * A read that found nothing new still moves `updatedAt`, but at most this often: a send-heavy day
 * would otherwise rewrite config.json on every send.
 */
export const MODEL_CATALOG_RESTAMP_MS = 60 * 60_000;

interface Stamped {
  updatedAt: string;
}

function ageMs(catalog: Stamped, now: number): number {
  const at = Date.parse(catalog.updatedAt);
  return Number.isFinite(at) ? now - at : Number.POSITIVE_INFINITY;
}

/** Nothing cached, an unreadable stamp, or older than the limit. */
export function isModelCatalogStale(catalog: Stamped | null, now: number = Date.now()): boolean {
  return !catalog || ageMs(catalog, now) > MODEL_CATALOG_MAX_AGE_MS;
}

/** A successful read that changed nothing should still record that it happened. */
export function needsModelCatalogRestamp(catalog: Stamped | null, now: number = Date.now()): boolean {
  return !!catalog && ageMs(catalog, now) > MODEL_CATALOG_RESTAMP_MS;
}

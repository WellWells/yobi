import type { CheckpointStore } from './checkpoint';

export interface SeenEntry {
  link: string;
  seenAt: string;
}

export interface SeenCheckpoint {
  seen: SeenEntry[];
  updatedAt: string;
}

export const DEFAULT_CACHE_DAYS = 3;
const DAY_MS = 86_400_000;
const MAX_ENTRIES = 2_000;

export function cacheWindowMs(cacheDays: string | undefined): number {
  const days = Number.parseFloat((cacheDays ?? '').trim());
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_CACHE_DAYS) * DAY_MS;
}

export function readSeenEntries(raw: unknown, nowIso: string): SeenEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const source = Array.isArray(obj.seen) ? obj.seen : Array.isArray(obj.lastLinks) ? obj.lastLinks : [];

  const entries: SeenEntry[] = [];
  for (const item of source) {
    if (typeof item === 'string') {
      entries.push({ link: item, seenAt: nowIso });
    } else if (item && typeof (item as SeenEntry).link === 'string') {
      const e = item as SeenEntry;
      entries.push({ link: e.link, seenAt: typeof e.seenAt === 'string' ? e.seenAt : nowIso });
    }
  }
  return entries;
}

// Exported for the test suite.
export function dedupeLinks(
  current: string[],
  prev: SeenEntry[],
  nowIso: string,
  windowMs: number,
): { fresh: string[]; entries: SeenEntry[] } {
  const now = Date.parse(nowIso);
  const live = prev.filter((e) => now - Date.parse(e.seenAt) <= windowMs);
  const byLink = new Map(live.map((e) => [e.link, e]));

  const fresh: string[] = [];
  for (const link of current) {
    const key = link.trim();
    if (!key) continue;
    const existing = byLink.get(key);
    if (existing) {
      existing.seenAt = nowIso;
    } else {
      const entry: SeenEntry = { link: key, seenAt: nowIso };
      byLink.set(key, entry);
      live.push(entry);
      fresh.push(key);
    }
  }

  const entries = live.length > MAX_ENTRIES
    ? [...live].sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt)).slice(0, MAX_ENTRIES)
    : live;
  return { fresh, entries };
}

export async function reconcileSeenCache(
  store: CheckpointStore<SeenCheckpoint>,
  stepId: string,
  current: string[],
  cacheDays: string | undefined,
): Promise<{ fresh: string[]; isFirstRun: boolean }> {
  const checkpoint = await store.load(stepId);
  const nowIso = new Date().toISOString();
  const prev = readSeenEntries(checkpoint, nowIso);
  const { fresh, entries } = dedupeLinks(current, prev, nowIso, cacheWindowMs(cacheDays));
  await store.save(stepId, { seen: entries, updatedAt: nowIso });
  return { fresh, isFirstRun: checkpoint === null };
}

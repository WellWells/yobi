import { randomUUID } from 'node:crypto';
import type { CheckpointStore } from './checkpoint';
import { Mutex } from './lanes';
import { currentSeenLedger, type SeenOutcome } from './seenLedger';
import { sendLog } from '../helpers';

export interface SeenEntry {
  link: string;
  seenAt: string;
}

export interface SeenCheckpoint {
  seen: SeenEntry[];
  pending?: PendingEntry[];
  updatedAt: string;
}

export const DEFAULT_CACHE_DAYS = 5;
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

/**
 * A link handed on but not yet known to have gone through. While its run is still going it is in
 * flight: neither seen nor new, so an overlapping run of the same flow does not take it again.
 * Released (it failed, or the run never reached it) or left by an earlier app session (the app
 * quit or crashed mid-run), it is new again; `attempts` counts the failures.
 */
export interface PendingEntry {
  link: string;
  handedAt: string;
  attempts: number;
  /** The app session that handed it on. */
  boot: string;
  released?: boolean;
}

/** Failures before an item is given up on and marked seen: a paywalled page would otherwise spend the model every run. */
export const MAX_SEEN_ATTEMPTS = 3;
/** A pending link still held past this (a run that never settled) is new again. */
const PENDING_LEASE_MS = 12 * 3_600_000;
const BOOT_ID = randomUUID();

const fileLocks = new WeakMap<CheckpointStore<SeenCheckpoint>, Map<string, Mutex>>();

/** Read-modify-write of one checkpoint is serialized: two runs of a flow settle the same file. */
function lockFor(store: CheckpointStore<SeenCheckpoint>, stepId: string): Mutex {
  let byStep = fileLocks.get(store);
  if (!byStep) fileLocks.set(store, byStep = new Map());
  let lock = byStep.get(stepId);
  if (!lock) byStep.set(stepId, lock = new Mutex());
  return lock;
}

function readPending(raw: unknown): PendingEntry[] {
  const list = raw && typeof raw === 'object' ? (raw as { pending?: unknown }).pending : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is PendingEntry =>
    !!e && typeof e.link === 'string' && typeof e.handedAt === 'string' && typeof e.boot === 'string');
}

function inFlight(entry: PendingEntry, now: number): boolean {
  return !entry.released && entry.boot === BOOT_ID && now - Date.parse(entry.handedAt) <= PENDING_LEASE_MS;
}

interface SeenState {
  seen: Map<string, SeenEntry>;
  pending: Map<string, PendingEntry>;
}

function liveState(raw: unknown, nowIso: string, windowMs: number): SeenState {
  const now = Date.parse(nowIso);
  const live = (at: string): boolean => now - Date.parse(at) <= windowMs;
  return {
    seen: new Map(readSeenEntries(raw, nowIso).filter((e) => live(e.seenAt)).map((e) => [e.link, e])),
    pending: new Map(readPending(raw).filter((e) => live(e.handedAt)).map((e) => [e.link, e])),
  };
}

function toCheckpoint(state: SeenState, nowIso: string): SeenCheckpoint {
  const seen = [...state.seen.values()];
  const kept = seen.length > MAX_ENTRIES
    ? seen.sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt)).slice(0, MAX_ENTRIES)
    : seen;
  const pending = [...state.pending.values()];
  return { seen: kept, ...(pending.length > 0 ? { pending } : {}), updatedAt: nowIso };
}

export interface SeenCommit {
  /** Every key this read saw: marked seen unless handed on, deferred, or in flight in another run. */
  observed: string[];
  /** Handed downstream: pending until the run settles them (seen at once outside a flow run). */
  handed: string[];
  /** New but held back (over a cap): left new for the next run. */
  deferred?: string[];
  /** The link a handed key's item travels under, where they differ (rss keys by feed id): the run settles links. */
  linkOf?: ReadonlyMap<string, string>;
}

export interface SeenSession {
  isFirstRun: boolean;
  /** Every entry expired (no run for longer than the window): the step's own keys look new too. */
  lapsed: boolean;
  /** Seen within the window, or handed on by a run still going. */
  isKnown: (key: string) => boolean;
  /** The keys not known, trimmed, in order, each once. */
  freshOf: (keys: string[]) => string[];
  commit: (change: SeenCommit) => Promise<void>;
}

/**
 * A list step's view of its seen cache. Nothing is written until `commit`, and what is handed on
 * becomes seen only once the run settles it (`SeenLedger`).
 */
export async function openSeenCache(store: CheckpointStore<SeenCheckpoint>, stepId: string): Promise<SeenSession> {
  const checkpoint = await store.load(stepId);
  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const windowMs = cacheWindowMs(undefined);
  const state = liveState(checkpoint, nowIso, windowMs);
  const isKnown = (key: string): boolean => {
    const k = key.trim();
    if (state.seen.has(k)) return true;
    const pending = state.pending.get(k);
    return !!pending && inFlight(pending, now);
  };
  return {
    isFirstRun: checkpoint === null,
    lapsed: checkpoint !== null && state.seen.size === 0 && state.pending.size === 0,
    isKnown,
    freshOf: (keys) => [...new Set(keys.map((k) => k.trim()).filter(Boolean))].filter((k) => !isKnown(k)),
    commit: (change) => commitSeen(store, stepId, change),
  };
}

async function commitSeen(store: CheckpointStore<SeenCheckpoint>, stepId: string, change: SeenCommit): Promise<void> {
  const ledger = currentSeenLedger();
  const handed = [...new Set(change.handed.map((k) => k.trim()).filter(Boolean))];
  await lockFor(store, stepId).runExclusive(async () => {
    const nowIso = new Date().toISOString();
    const now = Date.parse(nowIso);
    const state = liveState(await store.load(stepId), nowIso, cacheWindowMs(undefined));
    const held = new Set([...handed, ...(change.deferred ?? []).map((k) => k.trim())]);
    for (const raw of change.observed) {
      const key = raw.trim();
      if (!key || held.has(key)) continue;
      const pending = state.pending.get(key);
      if (pending && inFlight(pending, now)) continue;
      state.pending.delete(key);
      state.seen.set(key, { link: key, seenAt: nowIso });
    }
    for (const key of handed) {
      if (!ledger) {
        state.pending.delete(key);
        state.seen.set(key, { link: key, seenAt: nowIso });
        continue;
      }
      state.seen.delete(key);
      const attempts = state.pending.get(key)?.attempts ?? 0;
      state.pending.set(key, { link: key, handedAt: nowIso, attempts, boot: BOOT_ID });
    }
    await store.save(stepId, toCheckpoint(state, nowIso));
  });
  if (!ledger) return;
  const keysOf = new Map<string, string[]>();
  for (const key of handed) {
    const link = change.linkOf?.get(key)?.trim() || key;
    keysOf.set(link, [...(keysOf.get(link) ?? []), key]);
  }
  ledger.register([...keysOf.keys()], (outcomes) => settleSeen(store, stepId, new Map(
    [...outcomes].flatMap(([link, outcome]) => (keysOf.get(link) ?? [link]).map((key) => [key, outcome] as const)),
  )));
}

/** What became of handed-on links: seen, released to retry, or given up on after `MAX_SEEN_ATTEMPTS`. */
export async function settleSeen(
  store: CheckpointStore<SeenCheckpoint>,
  stepId: string,
  outcomes: Map<string, SeenOutcome>,
): Promise<void> {
  await lockFor(store, stepId).runExclusive(async () => {
    const nowIso = new Date().toISOString();
    const state = liveState(await store.load(stepId), nowIso, cacheWindowMs(undefined));
    for (const [link, outcome] of outcomes) {
      const pending = state.pending.get(link);
      if (!pending) continue;
      const attempts = pending.attempts + (outcome === 'failed' ? 1 : 0);
      if (outcome === 'ack' || attempts >= MAX_SEEN_ATTEMPTS) {
        if (outcome !== 'ack') sendLog(`⚠️ [Flow] Seen cache: gave up on ${link} after ${attempts} failed run(s) — marked seen`);
        state.pending.delete(link);
        state.seen.set(link, { link, seenAt: nowIso });
        continue;
      }
      if (outcome === 'failed') sendLog(`↩️ [Flow] Seen cache: ${link} failed (attempt ${attempts}/${MAX_SEEN_ATTEMPTS}) — retried next run`);
      state.pending.set(link, { ...pending, attempts, released: true });
    }
    await store.save(stepId, toCheckpoint(state, nowIso));
  });
}

/**
 * The knowledge bases' indexes: one SQLite file per base under `<userData>/knowledge/`, opened on
 * first use and kept open. One sync at a time per base — a second caller waits for the running one
 * rather than reading the folder twice. An index made for another folder (the user pointed the base
 * somewhere else) is thrown away and rebuilt.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KnowledgeBase } from '../../shared/knowledgeBase';
import type { KnowledgeStatus } from '../../shared/knowledgeStatus';
import { KbIndex, KB_INDEX_SCHEMA_VERSION } from './kbIndex';
import type { KbHit } from './kbIndex';
import { syncKbFolder } from './kbSync';
import type { KbSyncResult } from './kbSync';

/**
 * `done`/`total`: while indexing, files read so far of those that changed. `failed`: files with no
 * text (scanned PDFs, passwords, damaged files). `syncedAt`: epoch ms of the last finished sync, 0 =
 * never. `error`: English, for the log; the settings page has its own words for a missing folder.
 */
export type KbStatus = KnowledgeStatus;

/** A sync newer than this is fresh enough for a question; a folder is not listed on every question. */
export const KB_FRESH_MS = 60_000;

let baseDir = '';
const indexes = new Map<string, { folder: string; index: KbIndex }>();
const running = new Map<string, Promise<KbSyncResult>>();
const statuses = new Map<string, KbStatus>();
const listeners = new Set<(status: KbStatus) => void>();

/** Set once at start-up (`<userData>/knowledge`); tests point it at a temporary folder. */
export function setKnowledgeDirectory(dir: string): void {
  baseDir = dir;
}

export function onKbStatus(listener: (status: KbStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function indexFile(id: string): string {
  if (!baseDir) throw new Error('knowledge directory is not set');
  return path.join(baseDir, `${id}.sqlite`);
}

function removeIndexFiles(id: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${indexFile(id)}${suffix}`, { force: true });
    } catch {
      // A file still held is overwritten on the next build.
    }
  }
}

function openIndex(kb: KnowledgeBase): KbIndex {
  const open = indexes.get(kb.id);
  if (open && open.folder === kb.folder) return open.index;
  if (open) {
    open.index.close();
    indexes.delete(kb.id);
  }
  fs.mkdirSync(baseDir, { recursive: true });
  let index = new KbIndex(indexFile(kb.id));
  const madeFor = index.meta('folder');
  if ((madeFor && madeFor !== kb.folder) || index.meta('schema') !== KB_INDEX_SCHEMA_VERSION) {
    // The text is rebuilt from the folder; the summaries cannot be, so they move to the new index
    // and rejoin their files as the sync reads them (a schema bump must never cost the
    // user the analyses they ran).
    const carried = index.summariesToCarry();
    index.close();
    removeIndexFiles(kb.id);
    index = new KbIndex(indexFile(kb.id));
    index.carrySummaries(carried);
  }
  index.setMeta('folder', kb.folder);
  indexes.set(kb.id, { folder: kb.folder, index });
  return index;
}

function emptyStatus(id: string): KbStatus {
  return { id, state: 'idle', done: 0, total: 0, files: 0, chunks: 0, chars: 0, failed: 0, capped: false, syncedAt: 0, error: '', folderMissing: false };
}

function publish(status: KbStatus): void {
  statuses.set(status.id, status);
  for (const listener of listeners) listener(status);
}

/** Files nothing can be searched in: no text of their own and no AI description either. */
function countFailed(index: KbIndex): number {
  return index.files().filter((file) => file.error && file.aiChars === 0).length;
}

/** Republishes a base's status after its index changed outside a sync (an AI description). */
export function refreshKbStatus(kb: KnowledgeBase): void {
  if (running.has(kb.id)) return;
  const index = openIndex(kb);
  const known = statuses.get(kb.id) ?? emptyStatus(kb.id);
  publish({ ...known, ...index.totals(), failed: countFailed(index) });
}

/** What the settings page shows for a base, before or without a sync. */
export function kbStatus(kb: KnowledgeBase): KbStatus {
  const known = statuses.get(kb.id);
  if (known) return known;
  const status = emptyStatus(kb.id);
  if (!baseDir || !fs.existsSync(indexFile(kb.id))) return status;
  try {
    const index = openIndex(kb);
    const syncedAt = Number(index.meta('synced_at')) || 0;
    return { ...status, ...index.totals(), failed: countFailed(index), syncedAt };
  } catch {
    return status;
  }
}

export interface KbSyncCallOptions {
  uiLanguage: string;
  signal?: AbortSignal;
}

/** Reads what changed in the base's folder; a sync already running is awaited, not repeated. */
export function syncKnowledgeBase(kb: KnowledgeBase, opts: KbSyncCallOptions): Promise<KbSyncResult> {
  const pending = running.get(kb.id);
  if (pending) return pending;
  const job = (async (): Promise<KbSyncResult> => {
    const before = kbStatus(kb);
    if (!fs.existsSync(kb.folder) || !fs.statSync(kb.folder).isDirectory()) {
      publish({ ...before, state: 'error', error: `folder not found: ${kb.folder}`, folderMissing: true });
      throw new Error(`the knowledge base folder is not there: ${kb.folder}`);
    }
    const index = openIndex(kb);
    publish({ ...before, state: 'indexing', done: 0, total: 0, error: '', folderMissing: false });
    try {
      const result = await syncKbFolder(kb.folder, index, {
        uiLanguage: opts.uiLanguage,
        ...(opts.signal ? { signal: opts.signal } : {}),
        onProgress: ({ done, total }) => publish({ ...kbStatus(kb), state: 'indexing', done, total }),
      });
      const syncedAt = Date.now();
      index.setMeta('synced_at', String(syncedAt));
      publish({ ...emptyStatus(kb.id), ...index.totals(), failed: countFailed(index), capped: result.capped, syncedAt });
      return result;
    } catch (err) {
      publish({ ...kbStatus(kb), state: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  })().finally(() => running.delete(kb.id));
  running.set(kb.id, job);
  return job;
}

/** Syncs first when the last sync is older than `KB_FRESH_MS` (or never ran). */
export async function ensureKnowledgeBaseFresh(kb: KnowledgeBase, opts: KbSyncCallOptions): Promise<void> {
  const status = kbStatus(kb);
  if (running.has(kb.id) || Date.now() - status.syncedAt > KB_FRESH_MS) await syncKnowledgeBase(kb, opts);
}

export function searchKnowledgeBase(kb: KnowledgeBase, queries: readonly string[], limit: number): KbHit[] {
  return openIndex(kb).search(queries, limit);
}

export function knowledgeBaseIndex(kb: KnowledgeBase): KbIndex {
  return openIndex(kb);
}

/** A base the user removed: its index goes with it. */
export function dropKnowledgeBase(id: string): void {
  const open = indexes.get(id);
  if (open) {
    open.index.close();
    indexes.delete(id);
  }
  statuses.delete(id);
  if (baseDir) removeIndexFiles(id);
}

/** Closes every index (quit, factory reset). */
export function closeKnowledgeBases(): void {
  for (const { index } of indexes.values()) index.close();
  indexes.clear();
  statuses.clear();
}

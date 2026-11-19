/**
 * Keeps each knowledge base's index up to date without being asked: files put in the folder are
 * picked up without waiting for the next question or a manual refresh. Each base's folder
 * is watched; a change starts a sync once the folder has been quiet for `KB_WATCH_QUIET_MS` (copying
 * a hundred files is one sync, not a hundred); changes during a sync start one more after it.
 * Changes made while Yobi was closed are found by one sync of every base after start-up.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KnowledgeBase } from '../../shared/knowledgeBase';

export const KB_WATCH_QUIET_MS = 3_000;
/** After start-up, so the first sync never competes with opening the window. */
export const KB_STARTUP_SYNC_DELAY_MS = 15_000;

/** A watcher that broke (the folder went away, the drive dropped out) is let go and tried again this much later. */
export const KB_WATCH_RETRY_MS = 60_000;

type Watch = (folder: string, onEvent: (file: string | null) => void, onError: () => void) => { close: () => void };

export interface KbWatchDeps {
  bases: () => readonly KnowledgeBase[];
  sync: (kb: KnowledgeBase) => Promise<unknown>;
  /** Only events for these files count (a temp file Office writes beside a document does not). */
  relevant: (file: string) => boolean;
  /**
   * A folder inside the base: renaming or moving one moves every document in it, and its name has
   * no document extension (`before/` renamed to `after/` would otherwise never sync).
   */
  isFolder?: (abs: string) => boolean;
  watch?: Watch;
}

function nodeWatch(folder: string, onEvent: (file: string | null) => void, onError: () => void): { close: () => void } {
  const watcher = fs.watch(folder, { recursive: true, persistent: false }, (_event, file) => onEvent(file ? String(file) : null));
  watcher.on('error', () => {
    watcher.close();
    onError();
  });
  return watcher;
}

function isFolderOnDisk(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

interface Entry {
  folder: string;
  watcher: { close: () => void };
  timer: ReturnType<typeof setTimeout> | null;
  syncing: boolean;
  again: boolean;
}

export function createKbWatcher(deps: KbWatchDeps) {
  const watch = deps.watch ?? nodeWatch;
  const isFolder = deps.isFolder ?? isFolderOnDisk;
  const entries = new Map<string, Entry>();
  let retry: ReturnType<typeof setTimeout> | null = null;

  const run = (id: string): void => {
    const entry = entries.get(id);
    const kb = deps.bases().find((base) => base.id === id);
    if (!entry || !kb) return;
    if (entry.syncing) {
      entry.again = true;
      return;
    }
    entry.syncing = true;
    void deps.sync(kb).catch(() => undefined).finally(() => {
      entry.syncing = false;
      if (!entry.again) return;
      entry.again = false;
      run(id);
    });
  };

  const schedule = (id: string): void => {
    const entry = entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      run(id);
    }, KB_WATCH_QUIET_MS);
  };

  const close = (id: string): void => {
    const entry = entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    entries.delete(id);
  };

  /** Watches the bases in config now: new ones added, removed ones and moved folders let go. */
  const refresh = (): void => {
    const bases = deps.bases();
    for (const [id, entry] of entries) {
      const kb = bases.find((base) => base.id === id);
      if (!kb || kb.folder !== entry.folder) close(id);
    }
    for (const kb of bases) {
      if (entries.has(kb.id)) continue;
      try {
        const watcher = watch(kb.folder, (file) => {
          // No name (an overflow): something changed, look. A folder's name — one there now, or a name
          // without an extension that is gone (a folder deleted or renamed away) — moved its documents.
          if (file === null || deps.relevant(file) || !path.extname(file) || isFolder(path.join(kb.folder, file))) schedule(kb.id);
        }, () => {
          // Let it go; a later refresh watches the folder again and syncs what changed meanwhile.
          close(kb.id);
          if (retry) return;
          retry = setTimeout(() => {
            retry = null;
            refresh();
            syncAll();
          }, KB_WATCH_RETRY_MS);
        });
        entries.set(kb.id, { folder: kb.folder, watcher, timer: null, syncing: false, again: false });
      } catch {
        // The folder is gone: the settings page and the sidebar say so; a later refresh tries again.
      }
    }
  };

  const syncAll = (): void => {
    for (const kb of deps.bases()) if (entries.has(kb.id)) run(kb.id);
  };

  const closeAll = (): void => {
    if (retry) clearTimeout(retry);
    retry = null;
    for (const id of [...entries.keys()]) close(id);
  };

  return { refresh, syncAll, closeAll, watching: () => [...entries.keys()] };
}

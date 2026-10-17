import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DOWNLOADS_SUBFOLDER, downloadsKeepMs, normalizeDownloadsKeep } from '../shared/downloads';
import { writeFileAtomic } from './atomicWrite';
import { config } from './config';
import { Mutex } from './flow/lanes';
import { sendLog } from './helpers';

/*
 * Downloads/Yobi is a cache: every file Yobi downloads lands there and is deleted once it is older
 * than the person's setting (three days unless changed; "keep" deletes nothing). Only files Yobi
 * itself saved there are touched, and only while they are as Yobi left them — a file the person
 * put in the folder, edited or replaced stays. A folder the step names outside Downloads/Yobi is
 * the person's own and never swept.
 */

const DAY_MS = 24 * 60 * 60_000;
const FIRST_SWEEP_MS = 60_000;
const SWEEP_INTERVAL_MS = 60 * 60_000;

interface LedgerEntry {
  path: string;
  size: number;
  savedAt: number;
}

let ledgerOverride: string | null = null;
let testLedger: string | null = null;
const lock = new Mutex();

/** `Downloads/Yobi`: where every download step saves unless it names a folder. */
export function yobiDownloadsDir(): string {
  return path.join(app.getPath('downloads'), DOWNLOADS_SUBFOLDER);
}

export function setDownloadsLedgerPath(file: string | null): void {
  ledgerOverride = file;
}

/** `<userData>/downloads-cache.json`. */
export function downloadsLedgerPath(): string {
  if (ledgerOverride) return ledgerOverride;
  if (process.env.VITEST) {
    testLedger ??= path.join(mkdtempSync(path.join(os.tmpdir(), 'yobi-test-dlcache-')), 'downloads-cache.json');
    return testLedger;
  }
  return path.join(app.getPath('userData'), 'downloads-cache.json');
}

function insideYobiDownloads(file: string): boolean {
  const rel = path.relative(path.resolve(yobiDownloadsDir()), path.resolve(file));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function asEntries(value: unknown): LedgerEntry[] {
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.filter((e): e is LedgerEntry => {
    const r = e as Partial<LedgerEntry> | null;
    return typeof r?.path === 'string' && typeof r.size === 'number' && typeof r.savedAt === 'number';
  });
}

async function readLedger(): Promise<LedgerEntry[]> {
  try {
    return asEntries(JSON.parse(await fs.readFile(downloadsLedgerPath(), 'utf8')));
  } catch {
    return [];
  }
}

async function writeLedger(entries: LedgerEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(downloadsLedgerPath()), { recursive: true });
  await writeFileAtomic(downloadsLedgerPath(), JSON.stringify({ files: entries }));
}

/**
 * How long Downloads/Yobi keeps a download right now; `null` = never deleted. Read on every use,
 * so a change in Settings applies to the files already there without a restart.
 */
export function currentDownloadsKeepMs(): number | null {
  return downloadsKeepMs(normalizeDownloadsKeep(config.downloadsKeep));
}

/**
 * Notes files Yobi just saved, so the sweep deletes them once they are older than the setting —
 * noted under "keep" too, so a shorter setting later still finds them. Files outside
 * Downloads/Yobi are ignored; saving the same path again restarts its time.
 */
export async function recordDownloads(files: readonly string[], now = Date.now()): Promise<void> {
  const wanted = files.filter(insideYobiDownloads).map((file) => path.resolve(file));
  if (wanted.length === 0) return;
  const added: LedgerEntry[] = [];
  for (const file of wanted) {
    try {
      added.push({ path: file, size: (await fs.stat(file)).size, savedAt: now });
    } catch {
      // Gone already: nothing to clean up later.
    }
  }
  if (added.length === 0) return;
  await lock.runExclusive(async () => {
    const paths = new Set(added.map((e) => e.path));
    const kept = (await readLedger()).filter((e) => !paths.has(e.path));
    await writeLedger([...kept, ...added]);
  });
}

/**
 * Whether `file` is a download Yobi saved in Downloads/Yobi and still as Yobi left it (same size):
 * one it may use again instead of fetching it anew. A file the person put there or changed is not.
 */
export async function isCachedDownload(file: string): Promise<boolean> {
  if (!insideYobiDownloads(file)) return false;
  const wanted = path.resolve(file);
  const entry = (await readLedger()).find((e) => e.path === wanted);
  if (!entry) return false;
  try {
    const stat = await fs.stat(wanted);
    return stat.isFile() && stat.size === entry.size;
  } catch {
    return false;
  }
}

/**
 * The folders a swept file leaves empty (a person's stories saved together), up to but not
 * Downloads/Yobi itself. `rmdir` refuses a folder with anything in it, so the person's files stay.
 */
async function removeEmptyFolders(folder: string): Promise<void> {
  for (let dir = folder; insideYobiDownloads(dir); dir = path.dirname(dir)) {
    try {
      await fs.rmdir(dir);
    } catch {
      return;
    }
  }
}

/**
 * Deletes the downloads older than the setting that are still as Yobi saved them; returns how
 * many. Age counts from each file's own save, so a longer setting spares the files already there
 * and a shorter one takes the older ones now. Under "keep" nothing is deleted.
 */
export async function sweepDownloads(now = Date.now()): Promise<number> {
  const keepMs = currentDownloadsKeepMs();
  if (keepMs === null) return 0;
  return lock.runExclusive(async () => {
    const entries = await readLedger();
    const kept: LedgerEntry[] = [];
    let removed = 0;
    for (const entry of entries) {
      if (now - entry.savedAt < keepMs) {
        kept.push(entry);
        continue;
      }
      try {
        const stat = await fs.stat(entry.path);
        // Edited or replaced since: the person's file now, not the cache's.
        if (!stat.isFile() || stat.size !== entry.size || !insideYobiDownloads(entry.path)) continue;
        await fs.rm(entry.path, { force: true });
        removed++;
        await removeEmptyFolders(path.dirname(entry.path));
      } catch (err) {
        // In use (Windows): try again next sweep. Missing: nothing left to do.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') kept.push(entry);
      }
    }
    if (kept.length !== entries.length) await writeLedger(kept);
    if (removed > 0) sendLog(`🧹 [Downloads] Removed ${removed} file(s) older than ${keepMs / DAY_MS} days from ${yobiDownloadsDir()}`);
    return removed;
  });
}

let started = false;

/** A sweep a minute after start, then every hour. */
export function startDownloadsSweep(): void {
  if (started) return;
  started = true;
  const sweep = (): void => {
    void sweepDownloads().catch((err: unknown) => {
      sendLog(`⚠️ [Downloads] Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const first = setTimeout(() => {
    sweep();
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    timer.unref?.();
  }, FIRST_SWEEP_MS);
  first.unref?.();
}

/**
 * Cross-platform location and inspection of the local LINE PC data directory.
 *
 * Pure helpers (dataDirCandidates / pickMainEdb) are unit-tested; the fs-backed
 * detectors are exercised by the manual self-test against a real install.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Main DB files are named "qw"+hex; media/keep/stats DBs carry these prefixes and
// must not be mistaken for the message DB.
const EXCLUDE_PREFIXES = ['album_', 'keep_', 'chatStats_'] as const;
const DB_EXTENSIONS = ['.db', '.edb'] as const;
// LINE keeps the message DBs one level down, in Data\db. Scan both so a future layout
// change that moves them back to Data still resolves.
const DB_SUBDIR = 'db';

export interface DbFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface InspectResult {
  dataDir: string;
  totalBytes: number;
  cacheBytes: number;
  dbFiles: DbFileInfo[];
}

export interface LocateResult {
  platform: NodeJS.Platform;
  /** Whether the DB key can be extracted on this platform (Windows only). */
  keyExtractionSupported: boolean;
  candidates: string[];
  dataDir: string | null;
  mainEdb: string | null;
  dbFiles: string[];
  accountHints: string[];
}

export function dataDirCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return [path.win32.join(localAppData, 'LINE', 'Data')];
  }
  if (platform === 'darwin') {
    return [
      path.posix.join(home, 'Library', 'Containers', 'jp.naver.line.mac', 'Data', 'Library', 'Application Support', 'LINE', 'Data'),
      path.posix.join(home, 'Library', 'Application Support', 'LINE', 'Data'),
    ];
  }
  return [];
}

function isDbFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('-wal') || lower.endsWith('-shm')) return false;
  return DB_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function pickMainEdb(files: { name: string; size: number; path?: string }[]): string | null {
  const edbs = files.filter((f) => f.name.toLowerCase().endsWith('.edb') && isDbFile(f.name));
  if (edbs.length === 0) return null;
  const mains = edbs.filter((f) => !EXCLUDE_PREFIXES.some((p) => f.name.startsWith(p)));
  const pool = mains.length > 0 ? mains : edbs;
  const chosen = pool.reduce((best, f) => (f.size > best.size ? f : best));
  return chosen.path ?? chosen.name;
}

interface DbEntry {
  name: string;
  size: number;
  path: string;
  mtime: Date;
}

async function dbEntriesIn(dir: string): Promise<DbEntry[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DbEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isDbFile(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const stat = await fs.stat(full);
    out.push({ name: entry.name, size: stat.size, path: full, mtime: stat.mtime });
  }
  return out;
}

async function collectDbEntries(dataDir: string): Promise<DbEntry[]> {
  const top = await dbEntriesIn(dataDir);
  const sub = await dbEntriesIn(path.join(dataDir, DB_SUBDIR));
  return [...top, ...sub];
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      total += await fileSize(full);
    }
  }
  return total;
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

export async function inspectStorage(dataDir: string): Promise<InspectResult> {
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  const dbFiles: DbFileInfo[] = (await collectDbEntries(dataDir))
    .map((e) => ({ name: e.name, size: e.size, modifiedAt: e.mtime.toISOString() }))
    .sort((a, b) => b.size - a.size);

  const cacheDir = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === 'cache');
  const cacheBytes = cacheDir ? await dirSize(path.join(dataDir, cacheDir.name)) : 0;
  const totalBytes = await dirSize(dataDir);
  return { dataDir, totalBytes, cacheBytes, dbFiles };
}

async function firstExistingDir(candidates: string[]): Promise<string | null> {
  for (const dir of candidates) {
    try {
      if ((await fs.stat(dir)).isDirectory()) return dir;
    } catch {
      // not present; try next
    }
  }
  return null;
}

async function accountHintsFor(dataDir: string): Promise<string[]> {
  const hints = new Set<string>();
  try {
    for (const name of await fs.readdir(dataDir)) {
      const conn = name.match(/^_qt_dt_connection_(.+)$/);
      if (conn) hints.add(conn[1]);
    }
  } catch {
    // directory unreadable; return whatever we have
  }
  return [...hints];
}

export async function locateLinePaths(deps?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}): Promise<LocateResult> {
  const platform = deps?.platform ?? process.platform;
  const env = deps?.env ?? process.env;
  const home = deps?.home ?? os.homedir();
  const candidates = dataDirCandidates(platform, env, home);
  const dataDir = await firstExistingDir(candidates);

  let mainEdb: string | null = null;
  let dbFiles: string[] = [];
  let accountHints: string[] = [];
  if (dataDir) {
    const entries = await collectDbEntries(dataDir);
    dbFiles = entries.map((e) => e.name);
    mainEdb = pickMainEdb(entries); // returns the full path (entries carry one)
    accountHints = await accountHintsFor(dataDir);
  }

  return {
    platform,
    keyExtractionSupported: platform === 'win32',
    candidates,
    dataDir,
    mainEdb,
    dbFiles,
    accountHints,
  };
}

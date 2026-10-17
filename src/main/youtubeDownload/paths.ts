import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/*
 * Where the download tools and job folders live: under userData, never inside the outputs folder
 * or the backup set.
 */

let dataDirOverride: string | null = null;
let testDataDir: string | null = null;

export function setYtdlDataDir(dir: string | null): void {
  dataDirOverride = dir;
}

export function ytdlDataDir(): string {
  if (dataDirOverride) return dataDirOverride;
  if (process.env.VITEST) {
    testDataDir ??= mkdtempSync(path.join(os.tmpdir(), 'yobi-test-ytdl-'));
    return testDataDir;
  }
  return app.getPath('userData');
}

/** `<userData>/tools/ytdl`: managed tools and `state.json`. Factory reset deletes it. */
export function ytdlToolsRoot(): string {
  return path.join(ytdlDataDir(), 'tools', 'ytdl');
}

/** `child` is `root` itself or somewhere below it, after resolving `..` segments. */
export function isInsideDir(root: string, child: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

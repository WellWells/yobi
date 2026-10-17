import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { numberedFileName } from '../../../shared/ytdl';
import { recordDownloads } from '../../downloadsCache';

/**
 * A name nothing in `dir` uses yet, reserved by creating it empty (`wx` fails if it exists): two
 * downloads of the same title finishing together would otherwise both pick it and one would
 * overwrite the other. The move then replaces the empty placeholder.
 */
export async function reserveName(dir: string, fileName: string): Promise<string> {
  for (let n = 1; n < 1_000; n++) {
    const candidate = n === 1 ? fileName : numberedFileName(fileName, n);
    try {
      await (await fs.open(path.join(dir, candidate), 'wx')).close();
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  const fallback = numberedFileName(fileName, Date.now());
  await (await fs.open(path.join(dir, fallback), 'wx')).close();
  return fallback;
}

/** `rename` cannot cross volumes (EXDEV); the jobs folder and the Downloads folder often do. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

/**
 * Moves `file` into `folder` under a name nothing there uses; the placeholder goes if the move
 * fails. Inside Downloads/Yobi it is noted for the cleanup (`downloadsCache.ts`).
 */
export async function saveIntoFolder(file: string, folder: string, fileName: string): Promise<string> {
  await fs.mkdir(folder, { recursive: true });
  const finalPath = path.join(folder, await reserveName(folder, fileName));
  try {
    await moveFile(file, finalPath);
  } catch (err) {
    await fs.rm(finalPath, { force: true }).catch(() => {});
    throw err;
  }
  await recordDownloads([finalPath]).catch(() => {});
  return finalPath;
}

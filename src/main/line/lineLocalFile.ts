/**
 * Locating a shared file's bytes already on this PC.
 *
 * LINE keeps a file's content on its server (which expires); it is on disk only when the user
 * saved it. `downloadedPath` is where LINE recorded the save, trusted only while that exact file
 * still exists with the recorded size; `probableLocalPath` is a same-name, same-size guess in the
 * usual folders. Neither file is opened. This module is the only LINE file that touches `node:fs`,
 * so the reader stays pure and these checks can be skipped (find-file `--no-local`).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

function sizeIfFile(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

/** The path LINE recorded when this PC saved the file, if it still exists with the recorded size. */
export function downloadedPath(downloaded: string, recordedSize: number | null, fileSize: number | null): string | undefined {
  if (!downloaded) return undefined;
  const size = recordedSize ?? fileSize;
  if (size === null) return undefined;
  return sizeIfFile(downloaded) === size ? downloaded : undefined;
}

/**
 * The folders a file is guessed in, in order: Downloads, Desktop and
 * Documents under the home folder, then every `OneDrive*` entry in %USERPROFILE% ("OneDrive",
 * "OneDrive - Company", …) as Go's filepath.Glob lists them: case-sensitive, in byte order.
 */
export function localSearchDirs(home: string = homedir(), userProfile: string = process.env.USERPROFILE ?? ''): string[] {
  const dirs: string[] = [];
  if (home) {
    for (const d of ['Downloads', 'Desktop', 'Documents']) dirs.push(join(home, d));
  }
  if (userProfile) {
    let names: string[] = [];
    try {
      names = readdirSync(userProfile);
    } catch {
      // No such folder: nothing to glob.
    }
    const matches = names
      .filter((name) => name.startsWith('OneDrive'))
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of matches) dirs.push(join(userProfile, name));
  }
  return dirs;
}

/** A same-name, same-size file in Downloads/Desktop/Documents/OneDrive*, or undefined. */
export function probableLocalPath(name: string, size: number | null, dirs: readonly string[] = localSearchDirs()): string | undefined {
  if (size === null) return undefined;
  const base = basename(name);
  for (const dir of dirs) {
    const candidate = join(dir, base);
    if (existsSync(candidate) && sizeIfFile(candidate) === size) return candidate;
  }
  return undefined;
}

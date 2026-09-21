import { existsSync, renameSync } from 'node:fs';
import * as path from 'node:path';
import Store from 'electron-store';

export interface StoreRecoveryNotice {
  /** The file that could not be read, e.g. `config.json`. */
  file: string;
  /** Where its contents were kept, or null if even moving it aside failed. */
  backupFile: string | null;
  detail: string;
}

const notices: StoreRecoveryNotice[] = [];

/**
 * Takes and clears the recovery notices collected so far.
 *
 * The stores are opened before there is anywhere to report to — config.ts builds its store at
 * module import time, and the secret stores are opened inside whenReady before the windows
 * exist — so what happened is queued here and drained once the app can talk to the user.
 */
export function takeStoreRecoveryNotices(): StoreRecoveryNotice[] {
  return notices.splice(0, notices.length);
}

function quarantine(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = filePath.replace(/\.json$/, `.corrupt-${stamp}.json`);
  try {
    renameSync(filePath, target);
    return target;
  } catch {
    return null;
  }
}

/**
 * Opens an `electron-store` that cannot take the app down with it.
 *
 * `conf` rethrows anything that is not ENOENT out of its store getter, and its constructor
 * reads the store straight away, so a truncated write or a hand-edited stray comma turned
 * every launch into a main-process crash box (config.json) or a running process with no
 * window at all (the secret stores, which are opened before the windows are made).
 *
 * The damaged file is moved aside rather than cleared: it is the user's settings, or the only
 * copy of an encrypted secret, and a file that cannot be parsed today may still be worth
 * something to whoever looks at it. Starting from defaults is the fallback, not the goal.
 */
// The constraint mirrors electron-store's own: an interface has no implicit index signature,
// so `Record<string, unknown>` would reject every store shape in this app.
export function openStoreWithRecovery<T extends Record<string, any>>(
  name: string,
  cwd: string,
  defaults: T,
): Store<T> {
  try {
    return new Store<T>({ name, cwd, defaults });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    const moved = quarantine(path.join(cwd, `${name}.json`));
    notices.push({
      file: `${name}.json`,
      backupFile: moved ? path.basename(moved) : null,
      detail,
    });
    return new Store<T>({ name, cwd, defaults });
  }
}

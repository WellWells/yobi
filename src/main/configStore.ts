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
 * `conf` rethrows any read error except ENOENT from its constructor, so a truncated or hand-edited
 * file would otherwise crash every launch. The damaged file is moved aside rather than cleared: it
 * may be the only copy of the user's settings or an encrypted secret.
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

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { isTemporaryFolderName } from '../../shared/flowFileTrigger';
import { sendLog } from '../helpers';

export interface WatchedFileStat {
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
}

export interface FolderWatchHandle {
  close(): void;
}

/** The file system as the folder trigger uses it, so a test can stand in for it. */
export interface FileWatchFs {
  stat(target: string): Promise<WatchedFileStat | null>;
  /**
   * Every file under the folder (one level, or all levels), by absolute path. Names only: a
   * Downloads folder holds thousands of files, and only the new ones are ever looked at closer.
   */
  list(folder: string, recursive: boolean): Promise<Set<string>>;
  canRead(target: string): Promise<boolean>;
  watch(folder: string, recursive: boolean, onEvent: () => void, onError: (err: unknown) => void): FolderWatchHandle;
}

async function listFiles(folder: string, recursive: boolean, into: Set<string>): Promise<void> {
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isFile()) {
      into.add(full);
    } else if (recursive && entry.isDirectory() && !isTemporaryFolderName(entry.name)) {
      await listFiles(full, true, into).catch(() => undefined);
    }
  }
}

function openWatcher(folder: string, recursive: boolean, onEvent: () => void): fs.FSWatcher {
  try {
    return fs.watch(folder, { recursive, persistent: false }, () => onEvent());
  } catch (err) {
    if (!recursive) throw err;
    // A platform without recursive watching: changes in subfolders are still found by the next
    // read of the folder, which any change at the top starts.
    sendLog(`⚠️ [Flow] This system cannot watch inside subfolders of "${folder}" — watching the folder itself`);
    return fs.watch(folder, { persistent: false }, () => onEvent());
  }
}

export const nodeFileWatchFs: FileWatchFs = {
  async stat(target) {
    const st = await fsp.stat(target).catch(() => null);
    return st ? { size: st.size, mtimeMs: st.mtimeMs, isFile: st.isFile(), isDirectory: st.isDirectory() } : null;
  },
  async list(folder, recursive) {
    const files = new Set<string>();
    await listFiles(folder, recursive, files);
    return files;
  },
  async canRead(target) {
    try {
      const handle = await fsp.open(target, 'r');
      await handle.close();
      return true;
    } catch {
      return false;
    }
  },
  watch(folder, recursive, onEvent, onError) {
    const watcher = openWatcher(folder, recursive, onEvent);
    watcher.on('error', onError);
    return { close: () => watcher.close() };
  },
};

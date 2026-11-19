import type { OutputFile } from '../../../shared/types';

/**
 * The outputs list arrives anew on every change main sees in the folder, and on Windows merely
 * reading a conversation is one (the watcher reports access times): opening a conversation sent
 * the same list twice, and each fresh array redrew the whole sidebar. What has not changed keeps
 * the object it had, so nothing that reads it draws again.
 */
export function sameOutputFile(a: OutputFile, b: OutputFile): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof OutputFile)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** The incoming list, with each unchanged entry, or the whole list when none changed, as it was. */
export function keepUnchangedFiles(previous: OutputFile[], incoming: OutputFile[]): OutputFile[] {
  const byPath = new Map(previous.map((file) => [file.path, file]));
  let changed = previous.length !== incoming.length;
  const next = incoming.map((file, index) => {
    const before = byPath.get(file.path);
    if (before && sameOutputFile(before, file)) {
      if (previous[index] !== before) changed = true;
      return before;
    }
    changed = true;
    return file;
  });
  return changed ? next : previous;
}

export function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key));
}

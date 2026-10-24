import { create } from 'zustand';
import type { ConversationFolder } from '../../../shared/conversationFolders';
import { folderKey } from '../../../shared/conversationFolders';
import { folderApi } from '../api/electronApi';

/*
 * The sidebar's folders and which of them are open. Folders come from main (an empty one too);
 * which are open is this window's own view state, kept in localStorage. Folders start closed.
 */

export const FOLDERS_OPEN_STORAGE_KEY = 'yobi-sidebar-folders-open';

export function parseStoredOpenFolders(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

function readOpen(): Set<string> {
  try {
    return parseStoredOpenFolders(localStorage.getItem(FOLDERS_OPEN_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function writeOpen(open: ReadonlySet<string>): void {
  try {
    localStorage.setItem(FOLDERS_OPEN_STORAGE_KEY, JSON.stringify([...open]));
  } catch {
  }
}

interface FolderState {
  folders: ConversationFolder[];
  /** `folderKey`s of the open folders. */
  open: ReadonlySet<string>;
  setFolders: (folders: ConversationFolder[]) => void;
  setOpen: (name: string, open: boolean) => void;
  toggleOpen: (name: string) => void;
  /** A renamed folder stays open under its new name. */
  renameOpen: (from: string, to: string) => void;
}

export const useFolderStore = create<FolderState>((set, get) => {
  const update = (next: Set<string>): void => {
    writeOpen(next);
    set({ open: next });
  };
  return {
    folders: [],
    open: readOpen(),
    setFolders: (folders) => set({ folders }),
    setOpen: (name, open) => {
      const key = folderKey(name);
      if (get().open.has(key) === open) return;
      const next = new Set(get().open);
      if (open) next.add(key);
      else next.delete(key);
      update(next);
    },
    toggleOpen: (name) => get().setOpen(name, !get().open.has(folderKey(name))),
    renameOpen: (from, to) => {
      if (!get().open.has(folderKey(from))) return;
      const next = new Set(get().open);
      next.delete(folderKey(from));
      next.add(folderKey(to));
      update(next);
    },
  };
});

/** Reads the folders from main again; cheap (one directory listing). */
export function refreshFolders(): void {
  void folderApi.list().then((folders) => useFolderStore.getState().setFolders(folders), () => undefined);
}

let listening = false;

/** Subscribes once to main's folder broadcasts and reads the list; later calls only re-read. */
export function initFolderStore(): void {
  refreshFolders();
  if (listening) return;
  listening = true;
  folderApi.onChanged((folders) => useFolderStore.getState().setFolders(folders));
}

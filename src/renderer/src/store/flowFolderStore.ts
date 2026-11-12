import { create } from 'zustand';
import type { FlowFolder } from '../../../shared/flowFolders';
import { folderKey } from '../../../shared/conversationFolders';
import { flowFolderApi } from '../api/electronApi';
import { parseStoredOpenFolders } from './folderStore';
import { FLOW_SECTIONS } from '../views/flow/flowSidebarRows';
import type { FlowSectionKey } from '../views/flow/flowSidebarRows';

/*
 * The flow sidebar's folders and how they are drawn. The folders come from main; which are open and
 * which sections are closed is this window's own view state, kept in localStorage apart from the
 * chat sidebar's. Folders start closed.
 */

const OPEN_STORAGE_KEY = 'yobi-flow-folders-open';
const SECTIONS_STORAGE_KEY = 'yobi-flow-sections-collapsed';

export function parseStoredSections(raw: string | null): Set<FlowSectionKey> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is FlowSectionKey => (FLOW_SECTIONS as readonly unknown[]).includes(entry)));
  } catch {
    return new Set();
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, values: Iterable<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
  }
}

interface FlowFolderState {
  folders: FlowFolder[];
  /** `folderKey`s of the open folders. */
  open: ReadonlySet<string>;
  collapsed: ReadonlySet<FlowSectionKey>;
  setFolders: (folders: FlowFolder[]) => void;
  setOpen: (name: string, open: boolean) => void;
  toggleOpen: (name: string) => void;
  /** A renamed folder stays open under its new name. */
  renameOpen: (from: string, to: string) => void;
  setCollapsed: (section: FlowSectionKey, collapsed: boolean) => void;
  toggleCollapsed: (section: FlowSectionKey) => void;
}

export const useFlowFolderStore = create<FlowFolderState>((set, get) => ({
  folders: [],
  open: parseStoredOpenFolders(readStored(OPEN_STORAGE_KEY)),
  collapsed: parseStoredSections(readStored(SECTIONS_STORAGE_KEY)),
  setFolders: (folders) => set({ folders }),
  setOpen: (name, open) => {
    const key = folderKey(name);
    if (get().open.has(key) === open) return;
    const next = new Set(get().open);
    if (open) next.add(key);
    else next.delete(key);
    writeStored(OPEN_STORAGE_KEY, next);
    set({ open: next });
  },
  toggleOpen: (name) => get().setOpen(name, !get().open.has(folderKey(name))),
  renameOpen: (from, to) => {
    if (!get().open.has(folderKey(from))) return;
    const next = new Set(get().open);
    next.delete(folderKey(from));
    next.add(folderKey(to));
    writeStored(OPEN_STORAGE_KEY, next);
    set({ open: next });
  },
  setCollapsed: (section, collapsed) => {
    if (get().collapsed.has(section) === collapsed) return;
    const next = new Set(get().collapsed);
    if (collapsed) next.add(section);
    else next.delete(section);
    writeStored(SECTIONS_STORAGE_KEY, next);
    set({ collapsed: next });
  },
  toggleCollapsed: (section) => get().setCollapsed(section, !get().collapsed.has(section)),
}));

/** Reads the folders from main again. */
export function refreshFlowFolders(): void {
  void flowFolderApi.list().then((folders) => useFlowFolderStore.getState().setFolders(folders), () => undefined);
}

let listening = false;

/** Subscribes once to main's folder broadcasts and reads the list; later calls only re-read. */
export function initFlowFolderStore(): void {
  refreshFlowFolders();
  if (listening) return;
  listening = true;
  flowFolderApi.onChanged((folders) => useFlowFolderStore.getState().setFolders(folders));
}

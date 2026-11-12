import { create } from 'zustand';
import { isSidebarSectionKey } from '../utils/timeGroups';
import type { SidebarSectionKey } from '../utils/timeGroups';

/*
 * How the sidebars are laid out in this window: which of the conversation sidebar's sections are
 * closed, and whether each sidebar (chat, flow) is folded down to its icon rail. View state like
 * the open folders (`folderStore`), kept in localStorage; everything starts open. The two folds
 * are each the user's own: folding the conversations to read wide says nothing about the flow
 * list. The model the 「對話」 section is narrowed to is not kept: a restart shows every
 * conversation, so none looks lost to a filter set days ago.
 */

export const SECTIONS_COLLAPSED_STORAGE_KEY = 'yobi-sidebar-sections-collapsed';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'yobi-sidebar-collapsed';
export const FLOW_SIDEBAR_COLLAPSED_STORAGE_KEY = 'yobi-flow-sidebar-collapsed';

export function parseStoredSections(raw: string | null): Set<SidebarSectionKey> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter(isSidebarSectionKey) : []);
  } catch {
    return new Set();
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

interface SidebarLayoutState {
  collapsedSections: ReadonlySet<SidebarSectionKey>;
  /** The conversation sidebar is folded to its icon rail. */
  collapsed: boolean;
  /** The flow sidebar is folded to its icon rail. */
  flowCollapsed: boolean;
  /** Only this model's conversations in the 「對話」 section; null shows them all. */
  providerFilter: string | null;
  setSectionCollapsed: (key: SidebarSectionKey, collapsed: boolean) => void;
  toggleSection: (key: SidebarSectionKey) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setFlowCollapsed: (collapsed: boolean) => void;
  toggleFlowCollapsed: () => void;
  setProviderFilter: (provider: string | null) => void;
}

export const useSidebarLayoutStore = create<SidebarLayoutState>((set, get) => ({
  collapsedSections: parseStoredSections(read(SECTIONS_COLLAPSED_STORAGE_KEY)),
  collapsed: read(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
  flowCollapsed: read(FLOW_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
  providerFilter: null,
  setSectionCollapsed: (key, collapsed) => {
    if (get().collapsedSections.has(key) === collapsed) return;
    const next = new Set(get().collapsedSections);
    if (collapsed) next.add(key);
    else next.delete(key);
    write(SECTIONS_COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
    set({ collapsedSections: next });
  },
  toggleSection: (key) => get().setSectionCollapsed(key, !get().collapsedSections.has(key)),
  setCollapsed: (collapsed) => {
    if (get().collapsed === collapsed) return;
    write(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    set({ collapsed });
  },
  toggleCollapsed: () => get().setCollapsed(!get().collapsed),
  setFlowCollapsed: (collapsed) => {
    if (get().flowCollapsed === collapsed) return;
    write(FLOW_SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    set({ flowCollapsed: collapsed });
  },
  toggleFlowCollapsed: () => get().setFlowCollapsed(!get().flowCollapsed),
  setProviderFilter: (provider) => set({ providerFilter: provider }),
}));

import { create } from 'zustand';
import {
  DEFAULT_SIDEBAR_VIEW,
  mergeSidebarView,
  normalizeSidebarView,
  type SidebarViewPrefs,
} from '../../../shared/sidebarView';
import { sidebarViewApi } from '../api/electronApi';

/*
 * The conversation list's Sort By and Group by Date. config.json is the truth (factory reset and
 * backups carry it like the reading preferences); the localStorage mirror only makes the first
 * paint right.
 */

export const SIDEBAR_VIEW_STORAGE_KEY = 'yobi-sidebar-view';

export function parseStoredSidebarView(raw: string | null): SidebarViewPrefs {
  if (!raw) return DEFAULT_SIDEBAR_VIEW;
  try {
    return normalizeSidebarView(JSON.parse(raw));
  } catch {
    return DEFAULT_SIDEBAR_VIEW;
  }
}

function readStored(): SidebarViewPrefs {
  try {
    return parseStoredSidebarView(localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_SIDEBAR_VIEW;
  }
}

function writeStored(prefs: SidebarViewPrefs): void {
  try {
    localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
  }
}

interface SidebarViewState {
  view: SidebarViewPrefs;
  setSidebarView: (patch: Partial<SidebarViewPrefs>) => void;
}

/** Bumped per change, so only the reply to the latest one is adopted. */
let updateSeq = 0;

function adoptSidebarView(raw: unknown): void {
  const view = normalizeSidebarView(raw);
  writeStored(view);
  const current = useSidebarViewStore.getState().view;
  if (view.sort === current.sort && view.groupByDate === current.groupByDate) return;
  useSidebarViewStore.setState({ view });
}

export const useSidebarViewStore = create<SidebarViewState>((set, get) => ({
  view: readStored(),
  setSidebarView: (patch) => {
    const next = mergeSidebarView(get().view, patch);
    writeStored(next);
    set({ view: next });
    const seq = ++updateSeq;
    sidebarViewApi.update(patch).then((saved) => {
      if (seq === updateSeq) adoptSidebarView(saved);
    }).catch(() => {});
  },
}));

/** Reconciles with config.json: at startup, and after a backup restore brought back another config. */
export function initSidebarViewFromConfig(): void {
  const seq = updateSeq;
  sidebarViewApi.get().then((raw) => {
    if (seq === updateSeq) adoptSidebarView(raw);
  }).catch(() => {});
}

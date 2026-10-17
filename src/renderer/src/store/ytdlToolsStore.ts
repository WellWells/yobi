import { useEffect } from 'react';
import { create } from 'zustand';
import { ytdlToolsApi } from '../api/electronApi';
import type { YtdlToolsState } from '../../../shared/ytdl';

interface YtdlToolsStore {
  /** `null` until main has answered the first read. */
  state: YtdlToolsState | null;
  /** The tools dialog: opened when a download step is added while the tools are not ready. */
  dialogOpen: boolean;
  initialize: () => void;
  openDialog: () => void;
  closeDialog: () => void;
  install: () => Promise<void>;
  /** Opens the dialog when a fresh read says the tools cannot run yet. */
  promptIfMissing: () => Promise<void>;
}

let listenersInitialized = false;
let listenerCleanup: (() => void) | null = null;

export const useYtdlToolsStore = create<YtdlToolsStore>((set, get) => ({
  state: null,
  dialogOpen: false,

  initialize: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;
    listenerCleanup = ytdlToolsApi.onState((state) => set({ state }));
    void ytdlToolsApi.get().then((state) => set({ state })).catch(() => {});
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),

  // Main broadcasts every step; the reply is only the final word.
  install: async () => {
    const state = await ytdlToolsApi.install();
    set({ state });
  },

  promptIfMissing: async () => {
    get().initialize();
    const state = await ytdlToolsApi.get();
    set({ state });
    if (!ytdlToolsUsable(state)) set({ dialogOpen: true });
  },
}));

/** The tools' state, subscribing to main's broadcasts the first time anything asks. */
export function useYtdlToolsState(): YtdlToolsState | null {
  useEffect(() => useYtdlToolsStore.getState().initialize(), []);
  return useYtdlToolsStore((s) => s.state);
}

/** The tools are installed or pointed at — the download step can run. */
export function ytdlToolsUsable(state: YtdlToolsState | null): boolean {
  return state?.status === 'ready' || state?.status === 'custom';
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerCleanup?.();
    listenerCleanup = null;
    listenersInitialized = false;
  });
}

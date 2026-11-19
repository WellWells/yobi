import { useEffect } from 'react';
import { create } from 'zustand';
import { managedToolsApi } from '../api/electronApi';
import type { ManagedToolId, ManagedToolState } from '../../../shared/managedTools';

interface ManagedToolsStore {
  /** Empty until main has answered the first read. */
  states: Partial<Record<ManagedToolId, ManagedToolState>>;
  initialize: () => void;
  /** Reads every tool again, looking each one up on this computer (a copy installed meanwhile). */
  refresh: () => Promise<void>;
  apply: (states: readonly ManagedToolState[]) => void;
}

let listenersInitialized = false;
let listenerCleanup: (() => void) | null = null;

export const useManagedToolsStore = create<ManagedToolsStore>((set, get) => ({
  states: {},

  initialize: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;
    listenerCleanup = managedToolsApi.onState((state) => set((s) => ({ states: { ...s.states, [state.id]: state } })));
    void get().refresh();
  },

  refresh: async () => {
    const states = await managedToolsApi.getAll().catch(() => [] as ManagedToolState[]);
    get().apply(states);
  },

  apply: (states) => set((s) => {
    const next = { ...s.states };
    for (const state of states) next[state.id] = state;
    return { states: next };
  }),
}));

/** One tool's state, subscribing to main's broadcasts the first time anything asks. */
export function useManagedToolState(id: ManagedToolId): ManagedToolState | null {
  useEffect(() => useManagedToolsStore.getState().initialize(), []);
  return useManagedToolsStore((s) => s.states[id] ?? null);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerCleanup?.();
    listenerCleanup = null;
    listenersInitialized = false;
  });
}

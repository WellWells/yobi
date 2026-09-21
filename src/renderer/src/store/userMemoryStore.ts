import { create } from 'zustand';
import { userMemoryApi } from '../api/electronApi';
import type { UserMemorySnapshot } from '../../../shared/userMemory';

/** A tidy asked for from outside Settings — a chat reply — waiting for the Memory page to open it. */
export interface MemoryCurateRequest {
  focus: string;
}

interface UserMemoryStoreState {
  snapshot: UserMemorySnapshot | null;
  curateRequest: MemoryCurateRequest | null;
  /** Loads once and follows every change main broadcasts, including the ones a reply makes. */
  initialize: () => void;
  apply: (snapshot: UserMemorySnapshot) => void;
  /** Held until the Memory page takes it, since Settings may still be loading. */
  requestCurate: (focus: string) => void;
  clearCurateRequest: () => void;
}

let listenersInitialized = false;
let listenerCleanup: (() => void) | null = null;

export const useUserMemoryStore = create<UserMemoryStoreState>((set) => ({
  snapshot: null,
  curateRequest: null,

  initialize: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;
    listenerCleanup = userMemoryApi.onChanged((snapshot) => set({ snapshot }));
    void userMemoryApi.get().then((snapshot) => set({ snapshot })).catch(() => {});
  },

  apply: (snapshot) => set({ snapshot }),

  requestCurate: (focus) => set({ curateRequest: { focus } }),

  clearCurateRequest: () => set({ curateRequest: null }),
}));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerCleanup?.();
    listenerCleanup = null;
    listenersInitialized = false;
  });
}

import { create } from 'zustand';
import { updateApi } from '../api/electronApi';
import type { UpdateAvailablePayload } from '../../../shared/types';

interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  checkFailed: boolean;
  newVersion: string | null;
  releaseUrl: string | null;
  initializeListeners: () => void;
  checkForUpdates: () => Promise<void>;
  openReleaseUrl: () => Promise<boolean>;
}

let listenersInitialized = false;
let listenerCleanups: Array<() => void> = [];

function normalizePayload(payload: UpdateAvailablePayload): UpdateAvailablePayload {
  return {
    version: payload.version.trim(),
    releaseUrl: payload.releaseUrl.trim(),
  };
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  isChecking: false,
  hasUpdate: false,
  checkFailed: false,
  newVersion: null,
  releaseUrl: null,

  initializeListeners: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;

    // Store cleanup functions to prevent IPC listener leaks during HMR
    listenerCleanups = [
      updateApi.onUpdateAvailable((rawPayload) => {
        const payload = normalizePayload(rawPayload);
        set({
          isChecking: false,
          hasUpdate: true,
          checkFailed: false,
          newVersion: payload.version,
          releaseUrl: payload.releaseUrl,
        });
      }),

      updateApi.onUpdateNotAvailable(() => {
        set({
          isChecking: false,
          hasUpdate: false,
          checkFailed: false,
          newVersion: null,
          releaseUrl: null,
        });
      }),

      updateApi.onUpdateError(() => {
        set({
          isChecking: false,
          checkFailed: true,
        });
      }),
    ];

    void get().checkForUpdates();
  },

  checkForUpdates: async () => {
    set({ isChecking: true, checkFailed: false });
    try {
      const started = await updateApi.checkForUpdates();
      if (!started) set({ isChecking: false });
    } catch (error: unknown) {
      console.error('[update] failed to check for updates', error);
      set({ isChecking: false, checkFailed: true });
    }
  },

  openReleaseUrl: async () => {
    const releaseUrl = get().releaseUrl;
    if (!releaseUrl) return false;
    return updateApi.openExternal(releaseUrl);
  },
}));

// HMR cleanup: unsubscribe stale listeners so re-initialization works correctly.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerCleanups.forEach((fn) => fn());
    listenerCleanups = [];
    listenersInitialized = false;
  });
}

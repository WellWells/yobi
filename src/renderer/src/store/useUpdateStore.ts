import { create } from 'zustand';
import { updateApi } from '../api/electronApi';
import type { UpdateAvailablePayload } from '../../../shared/types';

interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  checkFailed: boolean;
  /** True only after a check actually came back with "no newer release". */
  upToDate: boolean;
  isStoreBuild: boolean;
  newVersion: string | null;
  releaseUrl: string | null;
  initializeListeners: () => void;
  checkForUpdates: () => Promise<void>;
  openReleaseUrl: () => Promise<boolean>;
}

export type UpdateStatus = 'available' | 'checking' | 'failed' | 'latest' | 'unchecked';

/** "Latest" needs a check that succeeded; no result yet (dev builds never check) is "unchecked". */
export function updateStatus(
  state: Pick<UpdateState, 'hasUpdate' | 'isChecking' | 'checkFailed' | 'upToDate'>,
): UpdateStatus {
  if (state.hasUpdate) return 'available';
  if (state.isChecking) return 'checking';
  if (state.checkFailed) return 'failed';
  if (state.upToDate) return 'latest';
  return 'unchecked';
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
  upToDate: false,
  isStoreBuild: false,
  newVersion: null,
  releaseUrl: null,

  initializeListeners: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;

    listenerCleanups = [
      updateApi.onUpdateAvailable((rawPayload) => {
        const payload = normalizePayload(rawPayload);
        set({
          isChecking: false,
          hasUpdate: true,
          checkFailed: false,
          upToDate: false,
          newVersion: payload.version,
          releaseUrl: payload.releaseUrl,
        });
      }),

      updateApi.onUpdateNotAvailable(() => {
        set({
          isChecking: false,
          hasUpdate: false,
          checkFailed: false,
          upToDate: true,
          newVersion: null,
          releaseUrl: null,
        });
      }),

      updateApi.onUpdateError(() => {
        set({
          isChecking: false,
          checkFailed: true,
          upToDate: false,
        });
      }),
    ];

    void updateApi
      .getUpdateSource()
      .then((source) => {
        const isStoreBuild = source === 'store';
        set({ isStoreBuild });
        if (!isStoreBuild) void get().checkForUpdates();
      })
      .catch(() => {
        void get().checkForUpdates();
      });
  },

  checkForUpdates: async () => {
    set({ isChecking: true, checkFailed: false });
    try {
      const started = await updateApi.checkForUpdates();
      if (!started) set({ isChecking: false });
    } catch (error: unknown) {
      console.error('[update] failed to check for updates', error);
      set({ isChecking: false, checkFailed: true, upToDate: false });
    }
  },

  openReleaseUrl: async () => {
    const releaseUrl = get().releaseUrl;
    if (!releaseUrl) return false;
    return updateApi.openExternal(releaseUrl);
  },
}));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerCleanups.forEach((fn) => fn());
    listenerCleanups = [];
    listenersInitialized = false;
  });
}

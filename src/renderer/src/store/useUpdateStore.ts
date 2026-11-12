import { create } from 'zustand';
import { updateApi } from '../api/electronApi';
import type { UpdateAvailablePayload } from '../../../shared/types';

interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  /** The app is fetching the update itself. */
  isDownloading: boolean;
  /** The update is downloaded and installs on restart. */
  isReady: boolean;
  checkFailed: boolean;
  /** True only after a check actually came back with "no newer release". */
  upToDate: boolean;
  isStoreBuild: boolean;
  newVersion: string | null;
  releaseUrl: string | null;
  initializeListeners: () => void;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<boolean>;
  openReleaseUrl: () => Promise<boolean>;
}

export type UpdateStatus = 'ready' | 'downloading' | 'available' | 'checking' | 'failed' | 'latest' | 'unchecked';

/** "Latest" needs a check that succeeded; no result yet (dev builds never check) is "unchecked". */
export function updateStatus(
  state: Pick<UpdateState, 'hasUpdate' | 'isDownloading' | 'isReady' | 'isChecking' | 'checkFailed' | 'upToDate'>,
): UpdateStatus {
  if (state.isReady) return 'ready';
  if (state.isDownloading) return 'downloading';
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
    ...payload,
    version: payload.version.trim(),
    releaseUrl: payload.releaseUrl.trim(),
  };
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  isChecking: false,
  hasUpdate: false,
  isDownloading: false,
  isReady: false,
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
          isDownloading: payload.autoDownload,
          isReady: false,
          checkFailed: false,
          upToDate: false,
          newVersion: payload.version,
          releaseUrl: payload.releaseUrl,
        });
      }),

      updateApi.onUpdateDownloaded((rawPayload) => {
        const payload = normalizePayload(rawPayload);
        set({
          isChecking: false,
          hasUpdate: true,
          isDownloading: false,
          isReady: true,
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
          isDownloading: false,
          isReady: false,
          checkFailed: false,
          upToDate: true,
          newVersion: null,
          releaseUrl: null,
        });
      }),

      // hasUpdate stays: a failed download falls back to the GitHub button.
      updateApi.onUpdateError(() => {
        set({
          isChecking: false,
          isDownloading: false,
          isReady: false,
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

  installUpdate: () => updateApi.installUpdate(),

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

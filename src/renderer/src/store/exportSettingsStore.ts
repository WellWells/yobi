import { create } from 'zustand';
import { settingsApi } from '../api/electronApi';
import { DEFAULT_CAPTURE_MARGIN, DEFAULT_CAPTURE_WIDTH } from '../../../shared/types';
import { DEFAULT_CAPTURE_BACKGROUND_STYLE, DEFAULT_CAPTURE_PALETTE } from '../../../shared/capturePalettes';
import type { CaptureSettings, HotkeyBindResult, QuickExportSettings } from '../../../shared/types';

interface ExportSettingsState {
  capture: CaptureSettings;
  quick: QuickExportSettings;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  patchCapture: (changes: Partial<CaptureSettings>) => void;
  patchQuick: (changes: Partial<QuickExportSettings>) => void;
  setQuickHotkey: (hotkey: string) => Promise<HotkeyBindResult>;
}

const CAPTURE_FALLBACK: CaptureSettings = {
  palette: DEFAULT_CAPTURE_PALETTE,
  backgroundStyle: DEFAULT_CAPTURE_BACKGROUND_STYLE,
  direction: 'se',
  showPrompt: true,
  showProvider: true,
  showTimestamp: true,
  showTokens: true,
  format: 'png',
  cardLayout: 'document',
  range: 'all',
  width: DEFAULT_CAPTURE_WIDTH,
  margin: DEFAULT_CAPTURE_MARGIN,
  pixelRatio: 1,
  zip: false,
};

const QUICK_FALLBACK: QuickExportSettings = {
  hotkey: '',
  format: 'png',
  zip: false,
};

let loadPromise: Promise<void> | null = null;

export const useExportSettingsStore = create<ExportSettingsState>((set, get) => ({
  capture: CAPTURE_FALLBACK,
  quick: QUICK_FALLBACK,

  load: () => {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      settingsApi.getCaptureSettings(),
      settingsApi.getQuickExport(),
    ])
      .then(([capture, quick]) => {
        set({ capture, quick });
      })
      // A failed read keeps the fallbacks; callers that await load() must not see a rejection.
      .catch(() => {});
    return loadPromise;
  },

  // A restored backup rewrites both halves in main; load() alone would keep serving the first read.
  reload: () => {
    loadPromise = null;
    return get().load();
  },

  patchCapture: (changes) => {
    const next = { ...get().capture, ...changes };
    set({ capture: next });
    void settingsApi.updateCaptureSettings(next);
  },

  patchQuick: (changes) => {
    const next = { ...get().quick, ...changes };
    set({ quick: next });
    void settingsApi.updateQuickExport(next);
  },

  setQuickHotkey: async (hotkey) => {
    const next = { ...get().quick, hotkey };
    const result = await settingsApi.updateQuickExport(next);
    if (result !== 'conflict') set({ quick: next });
    return result;
  },
}));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loadPromise = null;
  });
}

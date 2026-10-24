import { useCallback, useEffect } from 'react';
import { useExportSettingsStore } from '../../../store/exportSettingsStore';
import { IS_MAC, OS_HOTKEY_LABEL_KEYS, useHotkeyRecorderCore } from './useHotkeyRecorder';
import { useAppStore } from '../../../store/appStore';
import { defaultQuickExportHotkey } from '../../../../../shared/types';
import type { QuickExportFormat } from '../../../../../shared/types';

/**
 * The quick-export hotkey and the export panel's defaults. The hotkey is read from the export
 * settings store, so Keyboard shortcuts and Export show and change the same value.
 */
export function useQuickExportRecorder() {
  const quick = useExportSettingsStore((s) => s.quick);
  const patchQuick = useExportSettingsStore((s) => s.patchQuick);
  const setQuickHotkey = useExportSettingsStore((s) => s.setQuickHotkey);
  const load = useExportSettingsStore((s) => s.load);
  const ask = useAppStore((s) => s.hotkey);
  const region = useAppStore((s) => s.regionHotkey);

  useEffect(() => { void load(); }, [load]);

  const recorder = useHotkeyRecorderCore({
    current: quick.hotkey,
    save: setQuickHotkey,
    defaultValue: defaultQuickExportHotkey(IS_MAC),
    others: [
      { labelKey: OS_HOTKEY_LABEL_KEYS.ask, combo: ask },
      { labelKey: OS_HOTKEY_LABEL_KEYS.region, combo: region },
    ],
  });

  return {
    ...recorder,
    format: quick.format,
    setFormat: useCallback((format: QuickExportFormat) => patchQuick({ format }), [patchQuick]),
    zip: quick.zip,
    setZip: useCallback((zip: boolean) => patchQuick({ zip }), [patchQuick]),
  };
}

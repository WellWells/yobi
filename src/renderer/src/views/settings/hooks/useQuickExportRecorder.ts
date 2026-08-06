import { useCallback, useEffect } from 'react';
import { useExportSettingsStore } from '../../../store/exportSettingsStore';
import { IS_MAC, useHotkeyRecorderCore } from './useHotkeyRecorder';
import { defaultQuickExportHotkey } from '../../../../../shared/types';
import type { QuickExportFormat } from '../../../../../shared/types';

export function useQuickExportRecorder() {
  const quick = useExportSettingsStore((s) => s.quick);
  const patchQuick = useExportSettingsStore((s) => s.patchQuick);
  const setQuickHotkey = useExportSettingsStore((s) => s.setQuickHotkey);
  const load = useExportSettingsStore((s) => s.load);

  useEffect(() => { void load(); }, [load]);

  const recorder = useHotkeyRecorderCore({
    load: useCallback(async () => {
      await load();
      return useExportSettingsStore.getState().quick.hotkey;
    }, [load]),
    // Goes through the store's awaited path, not patchQuick: main can refuse this field.
    save: setQuickHotkey,
    defaultValue: defaultQuickExportHotkey(IS_MAC),
  });

  return {
    ...recorder,
    enabled: quick.enabled,
    setEnabled: useCallback((enabled: boolean) => patchQuick({ enabled }), [patchQuick]),
    format: quick.format,
    setFormat: useCallback((format: QuickExportFormat) => patchQuick({ format }), [patchQuick]),
    zip: quick.zip,
    setZip: useCallback((zip: boolean) => patchQuick({ zip }), [patchQuick]),
  };
}

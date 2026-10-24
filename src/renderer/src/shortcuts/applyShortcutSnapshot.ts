import type { SettingsSnapshot } from '../../../shared/types';
import { useAppStore } from '../store/appStore';
import { useShortcutStore } from '../store/shortcutStore';
import { useExportSettingsStore } from '../store/exportSettingsStore';

/**
 * Brings every shortcut on screen in line with a restored backup. They live in four places: the
 * ask and screen-region hotkeys (`config.hotkey`, `config.regionHotkey`), the rebindable app
 * shortcuts (`config.shortcuts`) and the quick-export hotkey inside the export settings, which the
 * snapshot does not carry — that store is re-read, together with the card style it also holds.
 */
export async function applyShortcutSnapshot(snapshot: Pick<SettingsSnapshot, 'hotkey' | 'regionHotkey' | 'shortcuts'>): Promise<void> {
  useAppStore.getState().setHotkey(snapshot.hotkey);
  useAppStore.getState().setRegionHotkey(snapshot.regionHotkey);
  useShortcutStore.getState().setOverrides(snapshot.shortcuts ?? {});
  await useExportSettingsStore.getState().reload();
}

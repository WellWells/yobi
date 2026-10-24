import { useCallback, useState } from 'react';
import { settingsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { useExportSettingsStore } from '../../../store/exportSettingsStore';
import { useI18nStore } from '../../../store/i18nStore';
import { defaultMainHotkey, defaultRegionHotkey } from '../../../../../shared/types';
import type { HotkeyBindResult } from '../../../../../shared/types';
import { comboOverlaps, isRegisterableAccelerator } from '../../../../../shared/shortcuts';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { isMac } from '../../../utils/keyLabels';
import type { ShortcutRowMessage } from './useShortcutSettings';

export const IS_MAC = isMac;

/** Another OS hotkey slot: main refuses a combo one of these already holds. */
export interface OtherHotkeySlot {
  labelKey: string;
  combo: string;
}

export interface HotkeySlot {
  /** The stored combo, read from a store so every page showing it follows one value. Empty = off. */
  current: string;
  save: (accelerator: string) => Promise<HotkeyBindResult>;
  /** Called after main accepted the combo, for slots whose store is not updated by `save` itself. */
  onSaved?: (accelerator: string) => void;
  defaultValue: string;
  /** The other OS hotkeys, the only ones main checks a conflict against. */
  others: readonly OtherHotkeySlot[];
}

/** The ask, quick-export and screen-region hotkeys, as each slot's `others` lists them. */
export const OS_HOTKEY_LABEL_KEYS = {
  ask: 'settings.shortcut.global.ask',
  quickExport: 'settings.shortcut.global.quickExport',
  region: 'settings.shortcut.global.regionAsk',
} as const;

/** The name of the slot holding `attempted`; the first one when main's view was newer than ours. */
export function conflictLabelKey(others: readonly OtherHotkeySlot[], attempted: string): string {
  return (others.find((other) => comboOverlaps(other.combo, attempted, isMac)) ?? others[0])?.labelKey ?? '';
}

/**
 * One of the OS-wide hotkeys. They have no on/off switch: an empty combo is "off", recorded
 * with Backspace, and restoring the default turns the hotkey back on.
 */
export function useHotkeyRecorderCore({ current, save, onSaved, defaultValue, others }: HotkeySlot) {
  const t = useI18nStore((s) => s.t);
  // Keyed by the combo it was reported for, so a value restored from a backup drops a stale warning.
  const [status, setStatus] = useState<{ combo: string; result: HotkeyBindResult; attempted: string } | null>(null);

  const commitCombo = useCallback(async (next: string): Promise<HotkeyBindResult> => {
    if (!isRegisterableAccelerator(next)) {
      setStatus({ combo: current, result: 'taken', attempted: next });
      return 'taken';
    }
    const result = await save(next);
    if (result === 'conflict') {
      setStatus({ combo: current, result, attempted: next });
      return result;
    }
    onSaved?.(next);
    setStatus({ combo: next, result, attempted: next });
    return result;
  }, [current, save, onSaved]);

  const restoreDefault = useCallback(async () => {
    await commitCombo(defaultValue);
  }, [commitCombo, defaultValue]);

  const clearStatus = useCallback(() => setStatus(null), []);

  const result = status && status.combo === current ? status.result : 'ok';
  let message: ShortcutRowMessage | null = null;
  if (result === 'conflict' && status) {
    message = {
      level: 'refuse',
      text: fillTemplate(t('settings.shortcut.collision.sameScope'), { name: t(conflictLabelKey(others, status.attempted)) }),
    };
  } else if (result === 'taken') {
    message = { level: 'warn', text: t('settings.hotkey.taken') };
  }

  return {
    currentHotkey: current,
    defaultValue,
    /** Anything but the default, an empty (switched-off) combo included. */
    modified: !comboOverlaps(current, defaultValue, isMac),
    message,
    commitCombo,
    restoreDefault,
    clearStatus,
  };
}

export type HotkeyRecorder = ReturnType<typeof useHotkeyRecorderCore>;

export function useHotkeyRecorder(): HotkeyRecorder {
  const current = useAppStore((s) => s.hotkey);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const quickExport = useExportSettingsStore((s) => s.quick.hotkey);
  const region = useAppStore((s) => s.regionHotkey);
  return useHotkeyRecorderCore({
    current,
    save: settingsApi.updateHotkey,
    onSaved: setHotkey,
    defaultValue: defaultMainHotkey(IS_MAC),
    others: [
      { labelKey: OS_HOTKEY_LABEL_KEYS.quickExport, combo: quickExport },
      { labelKey: OS_HOTKEY_LABEL_KEYS.region, combo: region },
    ],
  });
}

/** Box a screen region and ask about it. */
export function useRegionHotkeyRecorder(): HotkeyRecorder {
  const current = useAppStore((s) => s.regionHotkey);
  const setRegionHotkey = useAppStore((s) => s.setRegionHotkey);
  const ask = useAppStore((s) => s.hotkey);
  const quickExport = useExportSettingsStore((s) => s.quick.hotkey);
  return useHotkeyRecorderCore({
    current,
    save: settingsApi.updateRegionHotkey,
    onSaved: setRegionHotkey,
    defaultValue: defaultRegionHotkey(IS_MAC),
    others: [
      { labelKey: OS_HOTKEY_LABEL_KEYS.ask, combo: ask },
      { labelKey: OS_HOTKEY_LABEL_KEYS.quickExport, combo: quickExport },
    ],
  });
}

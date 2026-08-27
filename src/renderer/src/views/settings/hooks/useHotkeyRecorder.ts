import { useCallback, useEffect, useState } from 'react';
import { settingsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { defaultMainHotkey } from '../../../../../shared/types';
import type { HotkeyBindResult } from '../../../../../shared/types';
import { isRegisterableAccelerator } from '../../../../../shared/shortcuts';
import { isMac } from '../../../utils/keyLabels';

export const IS_MAC = isMac;

export interface HotkeySlot {
  load: () => Promise<string>;
  save: (accelerator: string) => Promise<HotkeyBindResult>;
  defaultValue: string;
  onChange?: (accelerator: string) => void;
}

export function useHotkeyRecorderCore(slot: HotkeySlot) {
  const { load, save, defaultValue, onChange } = slot;
  const [currentHotkey, setCurrentHotkey] = useState('');
  const [status, setStatus] = useState<HotkeyBindResult>('ok');

  useEffect(() => {
    void load().then(setCurrentHotkey);
  }, [load]);

  const commitCombo = useCallback(async (next: string): Promise<HotkeyBindResult> => {
    if (!isRegisterableAccelerator(next)) {
      setStatus('taken');
      return 'taken';
    }
    const result = await save(next);
    setStatus(result);
    if (result === 'conflict') return result;
    setCurrentHotkey(next);
    onChange?.(next);
    return result;
  }, [save, onChange]);

  const handleClearHotkey = useCallback(async () => {
    await commitCombo(defaultValue);
  }, [commitCombo, defaultValue]);

  const applyHotkeyReset = useCallback((hotkey: string) => {
    setCurrentHotkey(hotkey);
    setStatus('ok');
    onChange?.(hotkey);
  }, [onChange]);

  return {
    currentHotkey,
    status,
    defaultValue,
    commitCombo,
    handleClearHotkey,
    applyHotkeyReset,
  };
}

export function useHotkeyRecorder() {
  const setHotkey = useAppStore((s) => s.setHotkey);
  const enabled = useAppStore((s) => s.hotkeyEnabled);
  const setEnabledInStore = useAppStore((s) => s.setHotkeyEnabled);
  const core = useHotkeyRecorderCore({
    load: settingsApi.getHotkey,
    save: settingsApi.updateHotkey,
    defaultValue: defaultMainHotkey(IS_MAC),
    onChange: setHotkey,
  });

  const setEnabled = useCallback((next: boolean) => {
    setEnabledInStore(next);
    void settingsApi.setHotkeyEnabled(next);
  }, [setEnabledInStore]);

  const applyHotkeyReset = useCallback((hotkey: string, isEnabled: boolean) => {
    core.applyHotkeyReset(hotkey);
    setEnabledInStore(isEnabled);
  }, [core, setEnabledInStore]);

  return { ...core, enabled, setEnabled, applyHotkeyReset };
}

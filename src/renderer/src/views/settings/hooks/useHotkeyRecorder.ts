import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { settingsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { defaultMainHotkey } from '../../../../../shared/types';
import type { HotkeyBindResult } from '../../../../../shared/types';

export const IS_MAC = navigator.platform.toLowerCase().startsWith('mac');

function getKeyFromEvent(e: React.KeyboardEvent<HTMLInputElement>): string {
  if (e.code.startsWith('Key')) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (e.key === 'ArrowUp') return 'Up';
  if (e.key === 'ArrowDown') return 'Down';
  if (e.key === 'ArrowLeft') return 'Left';
  if (e.key === 'ArrowRight') return 'Right';
  if (e.key === 'Enter') return 'Return';
  if (e.key === ' ') return 'Space';
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

export interface HotkeySlot {
  load: () => Promise<string>;
  save: (accelerator: string) => Promise<HotkeyBindResult>;
  defaultValue: string;
  onChange?: (accelerator: string) => void;
}

export function useHotkeyRecorderCore(slot: HotkeySlot) {
  const { load, save, defaultValue, onChange } = slot;
  const [currentHotkey, setCurrentHotkey] = useState('');
  const [hotkeyInput, setHotkeyInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<HotkeyBindResult>('ok');

  useEffect(() => {
    void load().then((hk) => {
      setCurrentHotkey(hk);
      setHotkeyInput(hk);
    });
  }, [load]);

  useEffect(() => {
    void settingsApi.setHotkeyPaused(recording);
  }, [recording]);

  /*
   * A refused combination is rolled back rather than left on screen: main did not store it,
   * so keeping it in the field would show a binding that does not exist. `taken` is stored —
   * the app currently holding the combination may well close — so it stays, with a warning.
   */
  const applyHotkey = useCallback(async (nextHotkey: string): Promise<HotkeyBindResult> => {
    const result = await save(nextHotkey);
    setStatus(result);
    if (result === 'conflict') {
      setHotkeyInput(currentHotkey);
      return result;
    }
    setCurrentHotkey(nextHotkey);
    setHotkeyInput(nextHotkey);
    onChange?.(nextHotkey);
    return result;
  }, [save, onChange, currentHotkey]);

  const saveHotkey = useCallback(async (nextHotkey: string) => {
    if (!nextHotkey.trim() || nextHotkey === currentHotkey) return;
    await applyHotkey(nextHotkey);
  }, [currentHotkey, applyHotkey]);

  const handleHotkeyKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') {
      setRecording(false);
      (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push(IS_MAC ? 'Command' : 'Meta');

    const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta', 'OS'];
    if (!modifierKeys.includes(e.key)) {
      const key = getKeyFromEvent(e);
      parts.push(key);
      if (parts.length > 1 || key.startsWith('F')) {
        const next = parts.join('+');
        setHotkeyInput(next);
        void saveHotkey(next);
        setRecording(false);
        (e.currentTarget as HTMLInputElement).blur();
      }
    } else {
      setHotkeyInput(parts.join('+'));
    }
  }, [recording, saveHotkey]);

  const handleClearHotkey = useCallback(async () => {
    await applyHotkey(defaultValue);
  }, [applyHotkey, defaultValue]);

  const applyHotkeyReset = useCallback((hotkey: string) => {
    setCurrentHotkey(hotkey);
    setHotkeyInput(hotkey);
    setStatus('ok');
    onChange?.(hotkey);
  }, [onChange]);

  return {
    currentHotkey,
    hotkeyInput,
    recording,
    status,
    defaultValue,
    setRecording,
    setHotkeyInput,
    handleHotkeyKeyDown,
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

  /*
   * The switch lives in the store rather than here because the welcome screen reads it too:
   * it walks new users through "press <hotkey>", which is a lie once the binding is released.
   */
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

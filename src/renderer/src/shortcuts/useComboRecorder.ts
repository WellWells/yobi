import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { comboFromEvent, comboLabel, joinTokens, modifiersFromEvent, toTokens } from '../../../shared/shortcuts';
import { settingsApi } from '../api/electronApi';
import { isMac } from '../utils/keyLabels';

const FUNCTION_KEY = /^F\d{1,2}$/;

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph']);

const BARE_KEYS = new Set([
  'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace',
  'Up', 'Down', 'Left', 'Right',
]);

export interface ComboRecorderOptions {
  onCommit: (combo: string) => void;
  onAbort?: () => void;
  allowBareKeys?: boolean;
  /**
   * Backspace or Delete pressed alone commits an empty combo: the shortcut is switched off.
   * Settings has no on/off switch beside a shortcut, so this is how one is turned off.
   */
  clearable?: boolean;
}

const CLEAR_KEYS = new Set(['Backspace', 'Delete']);

export function isClearPress(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): boolean {
  return CLEAR_KEYS.has(event.key) && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

export interface ComboRecorder {
  recording: boolean;
  draft: string;
  rejected: boolean;
  start: () => void;
  stop: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function isCommittable(combo: string, allowBareKeys = false): boolean {
  if (!combo) return false;
  const parts = combo.split('+');
  if (parts.length > 1) return true;
  const key = parts[0] ?? '';
  if (FUNCTION_KEY.test(key)) return true;
  return allowBareKeys && BARE_KEYS.has(key);
}

export function useComboRecorder({
  onCommit, onAbort, allowBareKeys = false, clearable = false,
}: ComboRecorderOptions): ComboRecorder {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    // Only a field that is actually recording pauses the global hotkeys; the cleanup unpauses.
    if (!recording) return undefined;
    void settingsApi.setHotkeyPaused(true).catch(() => {});
    return () => { void settingsApi.setHotkeyPaused(false).catch(() => {}); };
  }, [recording]);

  const start = useCallback(() => {
    setDraft('');
    setRejected(false);
    setRecording(true);
  }, []);

  const stop = useCallback(() => {
    setRecording(false);
    setDraft('');
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stop();
      (event.currentTarget as HTMLElement).blur();
      onAbort?.();
      return;
    }

    if (clearable && isClearPress(event)) {
      stop();
      (event.currentTarget as HTMLElement).blur();
      onCommit('');
      return;
    }

    if (MODIFIER_KEYS.has(event.key)) {
      setRejected(false);
      const partial = modifiersFromEvent(event, isMac);
      setDraft(partial.length ? joinTokens(toTokens(`${partial.join('+')}+X`, isMac).slice(0, -1), isMac) : '');
      return;
    }

    const combo = comboFromEvent(event, isMac);
    if (!combo || !isCommittable(combo, allowBareKeys)) {
      setRejected(true);
      setDraft(combo ? comboLabel(combo, isMac) : '');
      return;
    }

    stop();
    (event.currentTarget as HTMLElement).blur();
    onCommit(combo);
  }, [recording, stop, onCommit, onAbort, allowBareKeys, clearable]);

  return { recording, draft, rejected, start, stop, handleKeyDown };
}

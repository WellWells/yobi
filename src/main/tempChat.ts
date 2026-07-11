import { IPC } from '../shared/types';
import type { TempChatResult } from '../shared/types';
import { isMainWindowAlive, sendLog, sendToRenderer } from './helpers';

// Session-only incognito flag: deliberately never persisted, so every launch
// starts with temporary chat mode off and no trace of previous sessions.
let _tempChatMode = false;

// A temporary reply exists ONLY in its IPC payload (no file is written). If the
// main window happens to be destroyed at completion time (macOS red-button
// close keeps the app and hotkeys alive), hold the latest reply here until a
// renderer reattaches instead of silently dropping it.
let _pendingResult: TempChatResult | null = null;

export function isTempChatMode(): boolean {
  return _tempChatMode;
}

export function setTempChatMode(enabled: boolean): void {
  if (_tempChatMode === enabled) return;
  _tempChatMode = enabled;
  if (!enabled) _pendingResult = null;
  sendLog(enabled
    ? '👻 Temporary chat mode enabled — replies will not be saved'
    : '👻 Temporary chat mode disabled');
  sendToRenderer(IPC.TEMP_CHAT_MODE_CHANGED, enabled);
}

export function toggleTempChatMode(): void {
  setTempChatMode(!_tempChatMode);
}

export function deliverTempChatResult(payload: TempChatResult): void {
  if (isMainWindowAlive()) {
    sendToRenderer(IPC.TEMP_CHAT_RESULT, payload);
    return;
  }
  _pendingResult = payload;
}

// Called when a (re)booted renderer attaches (it always fetches the mode on
// bootstrap) — deliver a reply produced while no window existed.
export function flushPendingTempChatResult(): void {
  if (!_pendingResult || !isMainWindowAlive()) return;
  sendToRenderer(IPC.TEMP_CHAT_RESULT, _pendingResult);
  _pendingResult = null;
}

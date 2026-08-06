import { IPC } from '../shared/types';
import type { TempChatResult } from '../shared/types';
import { appendTurn, parseConversationDoc } from '../shared/conversationDoc';
import type { ConversationDoc, TurnMeta } from '../shared/conversationDoc';
import { conversationAliases } from './chat/conversationStore';
import { getLangCache, t } from './i18n';
import { isMainWindowAlive, sendLog, sendToRenderer } from './helpers';

let _tempChatMode = false;

let _conversationRaw = '';

let _pendingResult: TempChatResult | null = null;

export function isTempChatMode(): boolean {
  return _tempChatMode;
}

export function setTempChatMode(enabled: boolean): void {
  if (_tempChatMode === enabled) return;
  _tempChatMode = enabled;
  if (!enabled) {
    _pendingResult = null;
    _conversationRaw = '';
  }
  sendLog(enabled
    ? '👻 Temporary chat mode enabled — replies will not be saved'
    : '👻 Temporary chat mode disabled');
  sendToRenderer(IPC.TEMP_CHAT_MODE_CHANGED, enabled);
}

export function toggleTempChatMode(): void {
  setTempChatMode(!_tempChatMode);
}

export async function getTempChatConversation(): Promise<ConversationDoc | null> {
  if (!_conversationRaw) return null;
  return parseConversationDoc(_conversationRaw, await conversationAliases());
}

function turnLabels(): { prompt: string; response: string } {
  const strings = getLangCache();
  const pick = (key: string, fallback: string): string => {
    const value = t(strings, key);
    return value && value !== key ? value : fallback;
  };
  return { prompt: pick('md.prompt', 'Prompt'), response: pick('md.response', 'Response') };
}

export function deliverTempChatResult(payload: TempChatResult & {
  turn?: { prompt: string; response: string; meta: TurnMeta };
}): void {
  _conversationRaw = _conversationRaw && payload.turn
    ? appendTurn(_conversationRaw, payload.turn, turnLabels())
    : payload.content;

  const result: TempChatResult = { content: _conversationRaw };
  if (isMainWindowAlive()) {
    sendToRenderer(IPC.TEMP_CHAT_RESULT, result);
    return;
  }
  _pendingResult = result;
}

export function flushPendingTempChatResult(): void {
  if (!_pendingResult || !isMainWindowAlive()) return;
  sendToRenderer(IPC.TEMP_CHAT_RESULT, _pendingResult);
  _pendingResult = null;
}

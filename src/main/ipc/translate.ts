import { ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import dayjs from 'dayjs';
import { IPC } from '../../shared/types';
import {
  TRANSLATE_TEXT_MAX_CHARS, parseConversationTranslateRequest, parseTranslateRequest, parseTurnTranslationRequest,
} from '../../shared/translate';
import type {
  ConversationTranslateProgress, ConversationTranslateResult, TranslateProgress, TranslateResult, TurnTranslationResult,
} from '../../shared/translate';
import { languageDisplayName } from '../../shared/translateLanguages';
import { writeFileAtomic } from '../atomicWrite';
import { config } from '../config';
import { currentTurnLabels, loadConversation, setTurnTranslation } from '../chat/conversationStore';
import { assembleTranslatedConversation, translateConversationTurns } from '../chat/conversationTranslation';
import { oneShotIo, rememberQuickActionModel } from '../chat/oneShotRequest';
import { runTranslate } from '../chat/translateRun';
import { buildSafeFileNameFromTitle, getUniquePath, listOutputFiles } from '../files';
import { sendLog, sendToRenderer } from '../helpers';
import { getLangCache, t } from '../i18n';
import { isAllowedFilePath } from './context';
import { busyUntilSettled, markConversationBusy } from '../conversationBusy';

/**
 * Translation's own slots, apart from the writing tools': translating never cancels a rewrite.
 * One answer at a time (a new one replaces the one before), and one whole conversation at a time.
 */
let running: { id: string; controller: AbortController } | null = null;
let conversationRun: { id: string; path: string; controller: AbortController } | null = null;

/**
 * Stops a whole-conversation translation whose source is among `filePaths`, as it is deleted: the
 * copy would otherwise appear after the conversation it was made from is gone.
 */
export function cancelConversationTranslationFor(filePaths: readonly string[]): void {
  if (!conversationRun) return;
  const source = path.resolve(conversationRun.path);
  if (filePaths.some((filePath) => path.resolve(filePath) === source)) conversationRun.controller.abort();
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

export async function handleTranslateRun(raw: unknown): Promise<TranslateResult> {
  const rawText = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).text : undefined;
  if (typeof rawText === 'string' && rawText.length > TRANSLATE_TEXT_MAX_CHARS) return { ok: false, reason: 'tooLong' };
  const request = parseTranslateRequest(raw);
  if (!request) return { ok: false, reason: 'invalid' };
  if (request.filePath && !await isAllowedFilePath(request.filePath)) return { ok: false, reason: 'invalid' };
  rememberQuickActionModel(request.providerUrl);

  running?.controller.abort();
  const controller = new AbortController();
  running = { id: request.id, controller };
  sendLog(`🌐 [Translate] ${request.text.length} chars into ${request.to}`);
  try {
    const io = oneShotIo(controller.signal, (phase) => {
      sendToRenderer(IPC.TRANSLATE_PROGRESS, { id: request.id, phase } satisfies TranslateProgress);
    });
    // An answer's translation is written back into its conversation: not moved or deleted meanwhile.
    const result = await busyUntilSettled(request.filePath, 'translating', runTranslate(request, io));
    if (!result.ok && result.reason === 'failed') sendLog(`⚠️ [Translate] failed: ${result.error ?? ''}`);
    if (result.ok && result.unmatched) sendLog('⚠️ [Translate] code, formulas or links did not come back exactly once');
    return result;
  } finally {
    if (running?.controller === controller) running = null;
  }
}

function headingLabel(key: string, fallback: string): string {
  const value = t(getLangCache(), key);
  return value && value !== key ? value : fallback;
}

export async function handleTranslateConversation(raw: unknown): Promise<ConversationTranslateResult> {
  const request = parseConversationTranslateRequest(raw);
  if (!request || !await isAllowedFilePath(request.filePath)) return { ok: false, reason: 'invalid' };
  if (conversationRun) return { ok: false, reason: 'busy' };
  const loaded = await loadConversation(request.filePath);
  if (!loaded) return { ok: false, reason: 'invalid' };
  const turns = loaded.doc.turns.filter((turn) => turn.prompt.trim() || turn.response.trim());
  if (turns.length === 0) return { ok: false, reason: 'empty' };
  rememberQuickActionModel(request.providerUrl);

  const controller = new AbortController();
  conversationRun = { id: request.id, path: request.filePath, controller };
  // The copy is named after the source and saved beside it, so the source stays where it is meanwhile.
  const releaseBusy = markConversationBusy(request.filePath, 'translating');
  sendLog(`🌐 [Translate] ${turns.length} turn(s) of ${path.basename(request.filePath)} into ${request.to}`);
  let done = 0;
  const progress = (phase: ConversationTranslateProgress['phase']): void => {
    sendToRenderer(IPC.TRANSLATE_CONVERSATION_PROGRESS, {
      id: request.id, done, total: turns.length, phase,
    } satisfies ConversationTranslateProgress);
  };
  try {
    const io = oneShotIo(controller.signal, progress);
    const result = await translateConversationTurns(turns, request.to, request.providerUrl, io, (index) => { done = index; });
    if (!result.ok) {
      if (result.reason === 'failed') sendLog(`⚠️ [Translate] turn ${result.turn ?? '?'} failed: ${result.error ?? ''}`);
      return result;
    }
    // Deleted while it was being translated: no copy of a conversation the user just removed.
    if (controller.signal.aborted || !await exists(request.filePath)) return { ok: false, reason: 'cancelled' };
    const name = languageDisplayName(request.to, config.locale);
    const sourceTitle = loaded.doc.title?.trim() || path.basename(request.filePath, path.extname(request.filePath));
    const title = t(getLangCache(), 'chat.translate.conversation.title', { title: sourceTitle, language: name });
    const content = assembleTranslatedConversation({
      title,
      provider: loaded.doc.provider,
      time: dayjs().format('YYYY-MM-DDTHH:mm:ssZ'),
      labels: {
        ...currentTurnLabels(),
        provider: headingLabel('md.provider', 'Provider'),
        time: headingLabel('md.timestamp', 'Time'),
      },
      turns: result.turns,
    });
    const target = await getUniquePath(path.join(path.dirname(request.filePath), `${buildSafeFileNameFromTitle(title)}.md`), '');
    // Written once, whole: a cancel or a failure above leaves no half-translated file.
    await writeFileAtomic(target, content);
    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
    sendLog(`🌐 [Translate] saved ${path.basename(target)}`);
    return { ok: true, filePath: target, keptOriginal: result.kept };
  } finally {
    releaseBusy();
    if (conversationRun?.controller === controller) conversationRun = null;
  }
}

export function registerTranslateHandlers(): void {
  ipcMain.handle(IPC.TRANSLATE_RUN, (_event, request: unknown) => handleTranslateRun(request));
  ipcMain.handle(IPC.TRANSLATE_CANCEL, (_event, id: unknown): boolean => {
    if (!running || running.id !== id) return false;
    running.controller.abort();
    return true;
  });
  ipcMain.handle(IPC.TRANSLATE_CONVERSATION, (_event, request: unknown) => handleTranslateConversation(request));
  ipcMain.handle(IPC.TRANSLATE_CONVERSATION_CANCEL, (_event, id: unknown): boolean => {
    if (!conversationRun || conversationRun.id !== id) return false;
    conversationRun.controller.abort();
    return true;
  });
  ipcMain.handle(IPC.SET_TURN_TRANSLATION, async (_event, raw: unknown): Promise<TurnTranslationResult> => {
    const request = parseTurnTranslationRequest(raw);
    if (!request || !await isAllowedFilePath(request.filePath)) return { ok: false, reason: 'failed' };
    try {
      return await busyUntilSettled(request.filePath, 'translating', setTurnTranslation(request));
    } catch (err: unknown) {
      sendLog(`⚠️ Could not save the translation: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });
}

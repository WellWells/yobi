import { startTransition } from 'react';
import type { ConversationTranslateResult } from '../../../../../shared/translate';
import type { TranslateLanguage } from '../../../../../shared/translateLanguages';
import { fileApi, translateApi } from '../../../api/electronApi';
import { showAppNotice } from '../../../hooks/useUiNotifications';
import { useAppStore } from '../../../store/appStore';
import { useI18nStore } from '../../../store/i18nStore';
import { useTranslateStore } from '../../../store/translateStore';
import { ensureWritingModel } from '../writingToolsActions';
import { rememberLanguage } from './translateActions';

let sequence = 0;
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  translateApi.onConversationProgress(({ id, done, total, phase }) => {
    const store = useTranslateStore.getState();
    if (store.conversation?.id !== id) return;
    if (store.conversation.cancelling) void translateApi.cancelConversation(id).catch(() => false);
    store.setConversation({ ...store.conversation, done, total, phase });
  });
}

/** Opens the new conversation, the way a finished send opens its file. */
async function openFile(filePath: string): Promise<void> {
  const files = await fileApi.getList();
  const app = useAppStore.getState();
  app.setFiles(files);
  const file = files.find((candidate) => candidate.path === filePath);
  if (!file) return;
  app.selectFile(file);
  const content = await fileApi.getContent(filePath);
  if (useAppStore.getState().selectedFile?.path !== filePath) return;
  startTransition(() => useAppStore.getState().setFileContent(content));
}

/**
 * Translates every turn of a conversation into a new one, titled after it and the language, and opens it.
 * One at a time; the original is never changed.
 */
export async function translateConversation(path: string, to: TranslateLanguage): Promise<void> {
  const store = useTranslateStore.getState();
  if (store.conversation) return;
  ensureSubscribed();
  rememberLanguage(to);
  const id = `c${Date.now().toString(36)}${(sequence++).toString(36)}`;
  store.setConversation({ id, path, to, done: 0, total: 0, phase: 'starting' });
  const providerUrl = await ensureWritingModel();
  const result = await translateApi.translateConversation({ id, filePath: path, providerUrl, to })
    .catch(() => ({ ok: false as const, reason: 'failed' as const }));
  if (useTranslateStore.getState().conversation?.id === id) useTranslateStore.getState().setConversation(null);
  const { t } = useI18nStore.getState();

  if (result.ok) {
    await openFile(result.filePath);
    const message = result.keptOriginal > 0
      ? t('chat.translate.conversation.doneKept').replace('{{count}}', String(result.keptOriginal))
      : t('chat.translate.conversation.done');
    showAppNotice({ message, level: result.keptOriginal > 0 ? 'warning' : 'success' });
    return;
  }
  if (result.reason === 'cancelled') {
    showAppNotice({ message: t('chat.translate.conversation.cancelled'), level: 'info' });
    return;
  }
  showAppNotice({ title: t('chat.translate.conversation.failed'), message: conversationFailureDetail(result, t), level: 'error' });
}

/**
 * Why a whole-conversation translation failed, in the user's words. `empty` with a turn number is
 * the model answering one turn with nothing; without one, the conversation itself had no text.
 */
export function conversationFailureDetail(
  result: Extract<ConversationTranslateResult, { ok: false }>,
  t: (key: string) => string,
): string {
  const turn = result.turn ? String(result.turn) : '';
  switch (result.reason) {
    case 'tooLong':
      return t('chat.translate.conversation.tooLong').replace('{{turn}}', turn);
    case 'busy':
      return t('chat.translate.conversation.busy');
    case 'empty':
      return turn
        ? t('chat.translate.conversation.emptyTurn').replace('{{turn}}', turn)
        : t('chat.translate.conversation.empty');
    default:
      return result.error || t('chat.translate.error.failed');
  }
}

export function cancelConversationTranslation(): void {
  const job = useTranslateStore.getState().conversation;
  if (!job) return;
  useTranslateStore.getState().setConversation({ ...job, cancelling: true });
  void translateApi.cancelConversation(job.id).catch(() => false);
}

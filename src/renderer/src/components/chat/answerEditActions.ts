import { startTransition } from 'react';
import type { ResponseEditResult } from '../../../../shared/types';
import { fileApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { reloadOpenConversation } from '../../hooks/useReloadOpenConversation';
import { useAppStore } from '../../store/appStore';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { useI18nStore } from '../../store/i18nStore';

/** Puts the saved file on screen at once, instead of waiting for the folder watcher to notice it. */
export function showSavedContent(path: string, content: string): void {
  if (useAppStore.getState().selectedFile?.path !== path) return;
  startTransition(() => useAppStore.getState().setFileContent(content));
}

/**
 * Writes a new answer over the turn's, if the file still holds `expected`. A success shows at once
 * and offers undo, the same for an edit saved in the editor and a rewrite put in place.
 */
export async function writeAnswer(args: {
  path: string;
  turnIndex: number;
  turnCount: number;
  editedAt: string | null;
  expected: string;
  response: string;
}): Promise<ResponseEditResult> {
  const { path, turnIndex, expected } = args;
  const result: ResponseEditResult = await fileApi.editTurnResponse({ filePath: path, turnIndex, expected, response: args.response })
    .catch(() => ({ ok: false as const, reason: 'failed' as const }));
  if (!result.ok) return result;
  useAnswerEditStore.getState().setSaved({ path, turnIndex, before: expected, beforeEditedAt: args.editedAt, turnCount: args.turnCount });
  showSavedContent(path, result.content);
  return result;
}

/**
 * Saves the draft over the turn's answer. `overwrite` is the answer the file has now, given when
 * the user chose to keep their text after a conflict.
 */
export async function saveAnswerDraft(args: {
  path: string;
  turnIndex: number;
  turnCount: number;
  editedAt: string | null;
  overwrite?: string;
}): Promise<void> {
  const { path, turnIndex } = args;
  const store = useAnswerEditStore.getState();
  const draft = store.drafts[draftKey(path, turnIndex)];
  if (!draft || draft.saving || !draft.text.trim()) return;

  const expected = args.overwrite ?? draft.base;
  store.update(path, turnIndex, { saving: true });
  const result = await writeAnswer({ ...args, expected, response: draft.text });

  const after = useAnswerEditStore.getState();
  if (result.ok) {
    after.discard(path, turnIndex);
    return;
  }
  if (result.reason === 'conflict') {
    after.update(path, turnIndex, { saving: false, conflict: true });
    void reloadOpenConversation();
    return;
  }
  after.update(path, turnIndex, { saving: false });
  const { t } = useI18nStore.getState();
  showAppNotice({ level: 'error', message: t(result.reason === 'missing' ? 'chat.edit.missing' : 'chat.edit.failed') });
}

/** Puts back the answer from before the last save. `current` is the answer on screen now. */
export async function undoAnswerEdit(current: string): Promise<void> {
  const saved = useAnswerEditStore.getState().saved;
  if (!saved) return;
  useAnswerEditStore.getState().setSaved(null);
  const result = await fileApi.editTurnResponse({
    filePath: saved.path,
    turnIndex: saved.turnIndex,
    expected: current,
    response: saved.before,
    editedAt: saved.beforeEditedAt,
  }).catch(() => ({ ok: false as const, reason: 'failed' as const }));
  if (result.ok) {
    showSavedContent(saved.path, result.content);
    return;
  }
  const { t } = useI18nStore.getState();
  showAppNotice({ level: 'error', message: t('chat.edit.undoFailed') });
}

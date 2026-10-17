import { ipcMain } from 'electron';
import * as path from 'node:path';
import { IPC } from '../../shared/types';
import type { ConversationHistoryList, ConversationRestoreResult } from '../../shared/conversationHistory';
import { sendLog } from '../helpers';
import {
  deleteFileHistory,
  deleteFileVersion,
  keepBeforeExternalChange,
  listFileVersions,
  readFileVersion,
  restoreFileVersion,
} from '../chat/conversationVersions';
import { isAllowedFilePath } from './context';

/**
 * The ⋮ "Version history" of a conversation. The renderer names the conversation by its file
 * (checked to be in the outputs folder) and a version by its id; a version is never addressed by a
 * path the renderer sent.
 */
export function registerConversationHistoryHandlers(): void {
  ipcMain.handle(IPC.CONVERSATION_HISTORY_LIST, async (_event, filePath: unknown): Promise<ConversationHistoryList> => {
    if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath)) return { status: 'failed' };
    return listFileVersions(filePath).catch((): ConversationHistoryList => ({ status: 'failed' }));
  });

  ipcMain.handle(IPC.CONVERSATION_HISTORY_GET, async (_event, filePath: unknown, vid: unknown): Promise<string | null> => {
    if (typeof filePath !== 'string' || typeof vid !== 'string' || !await isAllowedFilePath(filePath)) return null;
    return readFileVersion(filePath, vid).catch(() => null);
  });

  ipcMain.handle(IPC.CONVERSATION_HISTORY_RESTORE, async (_event, filePath: unknown, vid: unknown): Promise<ConversationRestoreResult> => {
    if (typeof filePath !== 'string' || typeof vid !== 'string' || !await isAllowedFilePath(filePath)) {
      return { ok: false, reason: 'failed' };
    }
    try {
      const result = await restoreFileVersion(filePath, vid);
      if (result.ok) sendLog(`🕘 Restored an earlier version of ${path.basename(filePath)}`);
      return result;
    } catch (err: unknown) {
      sendLog(`⚠️ Could not restore the version: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });

  ipcMain.handle(IPC.CONVERSATION_HISTORY_DELETE, async (_event, filePath: unknown, vid: unknown): Promise<boolean> => {
    if (typeof filePath !== 'string' || typeof vid !== 'string' || !await isAllowedFilePath(filePath)) return false;
    return deleteFileVersion(filePath, vid).catch(() => false);
  });

  ipcMain.handle(IPC.CONVERSATION_HISTORY_DELETE_ALL, async (_event, filePath: unknown): Promise<boolean> => {
    if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath)) return false;
    return deleteFileHistory(filePath).catch(() => false);
  });

  ipcMain.handle(IPC.CONVERSATION_HISTORY_SNAPSHOT, async (_event, filePath: unknown, previous: unknown): Promise<boolean> => {
    if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath)) return false;
    return keepBeforeExternalChange(filePath, previous).catch(() => false);
  });
}

import { ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IPC } from '../../shared/types';
import type { TrashedConversation, TrashResult } from '../../shared/types';
import {
  deleteConversationsPermanently,
  listTrash,
  purgeTrash,
  restoreFromTrash,
  trashConversations,
} from '../conversationTrash';
import { getOutputDir, listOutputFiles } from '../files';
import { sendLog, sendToRenderer } from '../helpers';
import { isAllowedFilePath } from './context';
import { cancelConversationTranslationFor } from './translate';

/*
 * Deleting a conversation moves it to Recently Deleted; restoring and deleting for good take trash
 * ids only, looked up in main's own index — never a path from the renderer.
 */

/** The renderer's paths that are conversation files inside outputs, each once. */
async function conversationPaths(raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>();
  for (const filePath of raw) {
    if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.md')) continue;
    if (!await isAllowedFilePath(filePath)) continue;
    const isFile = await fs.stat(filePath).then((stat) => stat.isFile(), () => false);
    if (isFile) allowed.add(path.resolve(filePath));
  }
  return [...allowed];
}

export async function broadcastTrashChanged(): Promise<void> {
  sendToRenderer(IPC.TRASH_CHANGED, (await listTrash()).length);
}

async function broadcastFileList(): Promise<void> {
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
}

/** A whole-conversation translation of a file that is gone has nowhere to write. */
async function stopTranslatingDeleted(paths: readonly string[]): Promise<void> {
  const left = await Promise.all(paths.map((filePath) => fs.access(filePath).then(() => true, () => false)));
  cancelConversationTranslationFor(paths.filter((_, index) => !left[index]));
}

function failureText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function moveToTrash(raw: unknown): Promise<TrashResult> {
  const paths = await conversationPaths(raw);
  if (paths.length === 0) return { trashIds: [], failed: [], busy: [] };
  const result = await trashConversations(paths, await getOutputDir()).catch((err: unknown): TrashResult => {
    sendLog(`⚠️ Could not move conversations to Recently Deleted: ${failureText(err)}`);
    return { trashIds: [], failed: paths, busy: [] };
  });
  if (result.busy.length > 0) {
    sendLog(`⏳ Left ${result.busy.length} conversation(s) in use out of Recently Deleted: ${result.busy.map((item) => item.reason).join(', ')}`);
  }
  if (result.trashIds.length > 0) {
    // Only what actually moved: a busy file left in place may be the one being translated.
    const kept = new Set([...result.failed, ...result.busy.map((item) => item.path)]);
    cancelConversationTranslationFor(paths.filter((filePath) => !kept.has(filePath)));
    await broadcastFileList();
    await broadcastTrashChanged();
  }
  return result;
}

export function registerConversationTrashHandlers(): void {
  ipcMain.handle(IPC.DELETE_FILE, (_event, filePath: unknown): Promise<TrashResult> => moveToTrash([filePath]));

  ipcMain.handle(IPC.DELETE_FILES, (_event, filePaths: unknown): Promise<TrashResult> => moveToTrash(filePaths));

  // Only for files that could not go to the trash, after the user agreed to lose them.
  ipcMain.handle(IPC.DELETE_FILES_PERMANENTLY, async (_event, filePaths: unknown): Promise<number> => {
    const paths = await conversationPaths(filePaths);
    if (paths.length === 0) return 0;
    const deleted = await deleteConversationsPermanently(paths, await getOutputDir()).catch(() => 0);
    if (deleted > 0) {
      await stopTranslatingDeleted(paths);
      await broadcastFileList();
    }
    return deleted;
  });

  // Settings › Clear all history, already confirmed there: no conversation is left, in the trash either.
  ipcMain.handle(IPC.DELETE_ALL_FILES, async (): Promise<number> => {
    const outputDir = await getOutputDir();
    const paths = (await listOutputFiles()).map((file) => file.path);
    const deleted = paths.length === 0 ? 0 : await deleteConversationsPermanently(paths, outputDir).catch(() => 0);
    const purged = await purgeTrash('all', outputDir).catch(() => 0);
    await stopTranslatingDeleted(paths);
    await broadcastFileList();
    if (purged > 0) await broadcastTrashChanged();
    return deleted + purged;
  });

  ipcMain.handle(IPC.TRASH_LIST, (): Promise<TrashedConversation[]> => listTrash());

  ipcMain.handle(IPC.TRASH_RESTORE, async (_event, trashIds: unknown): Promise<string[]> => {
    if (!Array.isArray(trashIds)) return [];
    const restored = await restoreFromTrash(trashIds, await getOutputDir()).catch((err: unknown) => {
      sendLog(`⚠️ Could not restore from Recently Deleted: ${failureText(err)}`);
      return [];
    });
    if (restored.length > 0) {
      await broadcastFileList();
      await broadcastTrashChanged();
    }
    return restored;
  });

  ipcMain.handle(IPC.TRASH_PURGE, async (_event, trashIds: unknown): Promise<number> => {
    let which: readonly unknown[] | 'all';
    if (trashIds === 'all') which = 'all';
    else if (Array.isArray(trashIds)) which = trashIds;
    else return 0;
    const purged = await purgeTrash(which, await getOutputDir()).catch((err: unknown) => {
      sendLog(`⚠️ Could not empty Recently Deleted: ${failureText(err)}`);
      return 0;
    });
    if (purged > 0) await broadcastTrashChanged();
    return purged;
  });
}

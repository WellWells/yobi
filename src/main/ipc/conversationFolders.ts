import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { FolderActionResult, FolderDeleteResult } from '../../shared/conversationFolders';
import {
  createConversationFolder,
  deleteConversationFolder,
  listConversationFolders,
  renameConversationFolder,
} from '../conversationFolders';
import { listOutputFiles } from '../files';
import { sendToRenderer } from '../helpers';
import { broadcastTrashChanged } from './conversationTrash';
import { cancelConversationTranslationFor } from './translate';

/*
 * Folders are addressed by name only — never a path from the renderer — and main finds the folder
 * in outputs itself. Every change broadcasts the folder list, so an empty folder shows too.
 */

export async function broadcastFolderList(): Promise<void> {
  sendToRenderer(IPC.FOLDER_LIST_CHANGED, await listConversationFolders());
}

export async function handleFolderCreate(name: unknown, options?: unknown): Promise<FolderActionResult> {
  const restoring = typeof options === 'object' && options !== null && (options as Record<string, unknown>).restoring === true;
  const result = await createConversationFolder(name, { restoring });
  if (result.ok) await broadcastFolderList();
  return result;
}

export async function handleFolderRename(from: unknown, to: unknown): Promise<FolderActionResult> {
  const result = await renameConversationFolder(from, to);
  if (result.ok) await broadcastFolderList();
  return result;
}

export async function handleFolderDelete(name: unknown): Promise<FolderDeleteResult> {
  const { trashedPaths, ...result } = await deleteConversationFolder(name);
  if (!result.ok) return result;
  cancelConversationTranslationFor(trashedPaths);
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
  if (result.trashIds.length > 0) await broadcastTrashChanged();
  await broadcastFolderList();
  return result;
}

export function registerConversationFolderHandlers(): void {
  ipcMain.handle(IPC.FOLDER_LIST, () => listConversationFolders());
  ipcMain.handle(IPC.FOLDER_CREATE, (_event, name: unknown, options: unknown) => handleFolderCreate(name, options));
  ipcMain.handle(IPC.FOLDER_RENAME, (_event, from: unknown, to: unknown) => handleFolderRename(from, to));
  ipcMain.handle(IPC.FOLDER_DELETE, (_event, name: unknown) => handleFolderDelete(name));
}

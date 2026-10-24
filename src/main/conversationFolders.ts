import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  folderKey,
  folderNameProblem,
  isSystemFolder,
  normalizeFolderName,
} from '../shared/conversationFolders';
import type {
  ConversationFolder,
  FolderActionResult,
  FolderDeleteResult,
} from '../shared/conversationFolders';
import type { ConversationMove } from '../shared/conversationMove';
import { withConversationFile } from './chat/conversationStore';
import { conversationBusyReason } from './conversationBusy';
import { conversationIdAt, listConversationFiles } from './conversationIndex';
import { announceConversationMoves } from './conversationMove';
import { trashConversations } from './conversationTrash';
import { getOutputDir } from './files';
import { busyReasonReader } from './conversationBusyCheck';
import { sendLog } from './helpers';

/*
 * Conversation folders are real folders directly inside outputs, one level (Apple's sidebars stop
 * at two levels: the folder and its notes). Renaming one moves every conversation in it at once, so
 * it is refused while any of them is busy, exactly like moving them one by one; deleting one moves
 * its conversations to Recently Deleted, and the folder goes only when nothing else is left in it.
 */

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The folders directly inside outputs, by name; dot-named ones and anything not a folder are left out. */
export async function listConversationFolders(): Promise<ConversationFolder[]> {
  const root = await getOutputDir();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, system: isSystemFolder(entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The folder on disk called `name` (any case), or null. */
async function findFolder(name: unknown): Promise<ConversationFolder | null> {
  if (typeof name !== 'string') return null;
  const key = folderKey(normalizeFolderName(name));
  if (!key) return null;
  return (await listConversationFolders()).find((folder) => folderKey(folder.name) === key) ?? null;
}

export interface CreateFolderOptions {
  /**
   * Making a deleted folder again (the undo of deleting an empty one): a system folder's name is
   * fine, and a folder already back under that name (Yobi wrote there meanwhile) is success.
   */
  restoring?: boolean;
}

export async function createConversationFolder(raw: unknown, options: CreateFolderOptions = {}): Promise<FolderActionResult> {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const name = normalizeFolderName(raw);
  const existing = (await listConversationFolders()).map((folder) => folder.name);
  if (options.restoring) {
    const back = existing.find((other) => folderKey(other) === folderKey(name));
    if (back) return { ok: true, name: back };
  }
  // Restoring checks the name as its own: only a new folder is kept off the system names.
  const problem = folderNameProblem(name, existing, options.restoring ? name : undefined);
  if (problem) return { ok: false, error: problem };
  try {
    await fs.mkdir(path.join(await getOutputDir(), name));
    return { ok: true, name };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, error: 'duplicate' };
    sendLog(`⚠️ Could not create the folder ${name}: ${errorText(err)}`);
    return { ok: false, error: 'failed' };
  }
}

/** The conversations something is about to write to, or a question an Agent run left waiting on. */
async function busyConversations(files: readonly string[]): Promise<Set<string>> {
  const busyReasonOf = await busyReasonReader();
  return new Set(files.filter((file) => busyReasonOf(file) !== null));
}

/** Runs `work` holding every file's write queue, so nothing writes to them while the folder moves. */
function holdingFiles<T>(files: readonly string[], work: () => Promise<T>): Promise<T> {
  const held = files.reduceRight<() => Promise<T>>((inner, file) => () => withConversationFile(file, inner), work);
  return held();
}

class FolderBusyError extends Error {}

/**
 * Renames a folder, carrying everything that pointed at its conversations along (the bot chats,
 * saved Agent runs, the renderer's open conversation). Yobi's own folders cannot be renamed: it
 * writes into them by name.
 */
export async function renameConversationFolder(fromRaw: unknown, toRaw: unknown): Promise<FolderActionResult> {
  const folder = await findFolder(fromRaw);
  if (!folder) return { ok: false, error: 'missing' };
  if (folder.system) return { ok: false, error: 'system' };
  if (typeof toRaw !== 'string') return { ok: false, error: 'empty' };
  const name = normalizeFolderName(toRaw);
  if (name === folder.name) return { ok: true, name };
  const existing = (await listConversationFolders()).map((entry) => entry.name);
  const problem = folderNameProblem(name, existing, folder.name);
  if (problem) return { ok: false, error: problem };

  const root = await getOutputDir();
  const fromDir = path.join(root, folder.name);
  const toDir = path.join(root, name);
  const files = await listConversationFiles(fromDir);
  if ((await busyConversations(files)).size > 0) return { ok: false, error: 'busy' };

  try {
    await holdingFiles(files, async () => {
      // A send may have started while this waited for the files' queues.
      if (files.some((file) => conversationBusyReason(file) !== null)) throw new FolderBusyError();
      await fs.rename(fromDir, toDir);
    });
  } catch (err: unknown) {
    if (err instanceof FolderBusyError) return { ok: false, error: 'busy' };
    sendLog(`⚠️ Could not rename the folder ${folder.name}: ${errorText(err)}`);
    return { ok: false, error: 'failed' };
  }

  const moves: Array<ConversationMove & { id?: string }> = await Promise.all(files.map(async (from) => {
    const to = path.join(toDir, path.relative(fromDir, from));
    const id = await conversationIdAt(to);
    return id ? { from, to, id } : { from, to };
  }));
  sendLog(`📁 Renamed the folder ${folder.name} to ${name}`);
  await announceConversationMoves(moves);
  return { ok: true, name };
}

/** Removes the empty folders under `dir` and then `dir` itself when it is empty. True when it is gone. */
async function removeIfEmpty(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return false;
  for (const entry of entries) {
    if (entry.isDirectory()) await removeIfEmpty(path.join(dir, entry.name));
  }
  return fs.rmdir(dir).then(() => true, () => false);
}

/**
 * Deletes a folder the Apple Notes way: its conversations go to Recently Deleted (each remembers the
 * folder, so restoring one makes it again), then the folder goes unless something is still in it —
 * a conversation something is writing to, or files that are not conversations, which Yobi does not
 * own. A system folder can be deleted too; Yobi makes it again the next time it writes there.
 */
export async function deleteConversationFolder(raw: unknown): Promise<FolderDeleteResult & { trashedPaths: string[] }> {
  const folder = await findFolder(raw);
  const empty = { trashIds: [], busy: 0, failed: 0, removed: false, trashedPaths: [] };
  if (!folder) return { ok: false, ...empty, error: 'missing' };
  const root = await getOutputDir();
  const dir = path.join(root, folder.name);
  const files = await listConversationFiles(dir);
  const busy = await busyConversations(files);
  const free = files.filter((file) => !busy.has(file));

  let trashIds: string[] = [];
  let failed: string[] = [];
  // Recently Deleted checks again under its lock: a send may have started since the check above.
  let lateBusy: string[] = [];
  if (free.length > 0) {
    try {
      const result = await trashConversations(free, root);
      ({ trashIds, failed } = result);
      lateBusy = result.busy.map((item) => item.path);
    } catch (err: unknown) {
      sendLog(`⚠️ Could not move the folder ${folder.name} to Recently Deleted: ${errorText(err)}`);
      return { ok: false, ...empty, busy: busy.size, failed: free.length, error: 'failed' };
    }
  }
  const left = new Set([...failed, ...lateBusy]);
  const removed = await removeIfEmpty(dir);
  sendLog(`🗑️ Deleted the folder ${folder.name}: ${trashIds.length} conversation(s) to Recently Deleted${removed ? '' : ', folder kept'}`);
  return {
    ok: true,
    trashIds,
    busy: busy.size + lateBusy.length,
    failed: failed.length,
    removed,
    trashedPaths: trashIds.length > 0 ? free.filter((file) => !left.has(file)) : [],
  };
}

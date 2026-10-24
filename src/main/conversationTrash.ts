import * as fs from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isConversationId, threadOf } from '../shared/conversationHistory';
import { TRASH_RETENTION_DAYS } from '../shared/conversationTrash';
import type { TrashBusyFile, TrashedConversation, TrashResult } from '../shared/types';
import { writeFileAtomic } from './atomicWrite';
import type { ConversationBusyReason } from '../shared/conversationMove';
import { conversationBusyReason } from './conversationBusy';
import { busyReasonReader } from './conversationBusyCheck';
import { conversationTrashDir } from './conversationTrashPaths';
import { getOutputDir, getUniquePath } from './files';
import { Mutex } from './flow/lanes';
import { deleteConversationFiles, forgetOrphanedConversations } from './history/conversationHistory';

/*
 * Recently Deleted, like Apple Notes: deleting a conversation moves its file here for
 * TRASH_RETENTION_DAYS, and only then is it — with its versions and Notion sync state — gone for
 * good. The folder holds `<trashId>.md` files and `index.json`, which records where each came from.
 * Everything is addressed by a trash id found in the index, never by a path the renderer sent.
 * One lock covers every change, so the index is read, changed and written back in one piece.
 */

export { TRASH_DIR_NAME, conversationTrashDir } from './conversationTrashPaths';
export { TRASH_RETENTION_DAYS };

const DAY_MS = 24 * 60 * 60_000;
const INDEX_FILE = 'index.json';
const TRASH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIRST_LINE_H1 = /^#\s+(.+)$/;

interface TrashEntry {
  trashId: string;
  /** Relative to outputs, `/`-separated: the file name, or one folder and the file name. */
  originalRelativePath: string;
  title: string;
  deletedAt: string;
  /** The thread marker's id: what its versions and Notion sync state are filed under. */
  threadId?: string;
}

const lock = new Mutex();

function indexPath(): string {
  return path.join(conversationTrashDir(), INDEX_FILE);
}

export function isTrashId(value: unknown): value is string {
  return typeof value === 'string' && TRASH_ID_RE.test(value);
}

function storedPath(trashId: string): string {
  if (!isTrashId(trashId)) throw new Error('Invalid trash id');
  return path.join(conversationTrashDir(), `${trashId}.md`);
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function parseEntry(value: unknown): TrashEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (!isTrashId(entry.trashId) || typeof entry.originalRelativePath !== 'string' || typeof entry.title !== 'string'
    || typeof entry.deletedAt !== 'string' || Number.isNaN(Date.parse(entry.deletedAt))) return null;
  return {
    trashId: entry.trashId,
    originalRelativePath: entry.originalRelativePath,
    title: entry.title,
    deletedAt: entry.deletedAt,
    ...(isConversationId(entry.threadId) ? { threadId: entry.threadId } : {}),
  };
}

/**
 * The index. Only a missing index is an empty trash: one that cannot be read or makes no sense
 * throws, so nothing writes a fresh index over entries it could not see, and nothing is swept.
 */
async function readIndex(): Promise<TrashEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath(), 'utf-8');
  } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw) as { v?: unknown; items?: unknown } | null;
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) throw new Error('Unreadable trash index');
  return parsed.items.map(parseEntry).filter((entry): entry is TrashEntry => entry !== null);
}

async function writeIndex(entries: readonly TrashEntry[]): Promise<void> {
  await fs.mkdir(conversationTrashDir(), { recursive: true });
  await writeFileAtomic(indexPath(), `${JSON.stringify({ v: 1, items: entries }, null, 2)}\n`);
}

/** Rename, or copy then delete when the two folders are on different volumes. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
    return;
  } catch (err: unknown) {
    if (errorCode(err) !== 'EXDEV') throw err;
  }
  await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
  try {
    await fs.unlink(from);
  } catch (err: unknown) {
    await fs.rm(to, { force: true }).catch(() => undefined);
    throw err;
  }
}

function titleOf(raw: string | null, fileName: string): string {
  const firstLine = raw?.replace(/^﻿/, '').split(/\r?\n/, 1)[0]?.trim() ?? '';
  return FIRST_LINE_H1.exec(firstLine)?.[1]?.trim() || fileName.replace(/\.md$/i, '');
}

function expiresAt(entry: TrashEntry): number {
  return Date.parse(entry.deletedAt) + TRASH_RETENTION_DAYS * DAY_MS;
}

function isPlainSegment(segment: string): boolean {
  return segment !== '.' && segment !== '..' && !segment.includes(':');
}

/**
 * Where a conversation goes back to: its folder (one level, as the sidebar has; a deeper file goes
 * back to its top folder) and its name. A folder that climbs out or names a drive is dropped; a
 * name that does, or is not a `.md`, becomes `untitled.md`. The index is a file on disk, not proof.
 */
export function restoreTarget(outputDir: string, originalRelativePath: string): string {
  const segments = originalRelativePath.split(/[\\/]+/).filter(Boolean);
  const name = segments.at(-1) ?? '';
  const fileName = name.toLowerCase().endsWith('.md') && isPlainSegment(name) ? name : 'untitled.md';
  const folder = segments.length > 1 ? segments[0] : null;
  return folder && isPlainSegment(folder) ? path.join(outputDir, folder, fileName) : path.join(outputDir, fileName);
}

function toListing(entry: TrashEntry): TrashedConversation {
  return {
    trashId: entry.trashId,
    title: entry.title,
    originalRelativePath: entry.originalRelativePath,
    deletedAt: entry.deletedAt,
    expiresAt: new Date(expiresAt(entry)).toISOString(),
  };
}

/** What is in Recently Deleted, newest first. An unreadable index lists nothing. */
export async function listTrash(): Promise<TrashedConversation[]> {
  return lock.runExclusive(async () => {
    const entries = await readIndex().catch((err: unknown) => {
      console.warn(`[trash] could not read the index: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    });
    return entries
      .filter((entry) => existsSync(storedPath(entry.trashId)))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
      .map(toListing);
  });
}

/**
 * Splits off the files something is writing to right now, or that an Agent run is waiting on an
 * answer for (the answer would land in a new file); those stay where they are.
 */
function withoutBusy(
  filePaths: readonly string[],
  busy: TrashBusyFile[],
  busyReasonOf: (filePath: string) => ConversationBusyReason | null,
): string[] {
  return filePaths.filter((filePath) => {
    const reason = busyReasonOf(filePath);
    if (reason) busy.push({ path: filePath, reason });
    return !reason;
  });
}

/**
 * Moves conversations into Recently Deleted. Their versions and Notion sync state stay: the
 * conversation may come back. The index is written before the files move, so a crash between the
 * two leaves an entry without a file (dropped by the sweep), never a file nobody can find.
 * `failed` lists the files that could not be moved; a file already gone is in neither list.
 * A file something is writing to (`conversationBusyReason`) is left and listed in `busy`: the
 * answer on its way would otherwise land in a new file at the top of the list.
 */
export async function trashConversations(filePaths: readonly string[], outputDir: string, now = new Date()): Promise<TrashResult> {
  return lock.runExclusive(async () => {
    const busy: TrashBusyFile[] = [];
    const busyReasonOf = await busyReasonReader(now.getTime());
    const present = withoutBusy(filePaths.filter((filePath) => existsSync(filePath)), busy, busyReasonOf);
    let entries: TrashEntry[];
    try {
      entries = await readIndex();
    } catch {
      return { trashIds: [], failed: present, busy };
    }
    const planned = await Promise.all(present.map(async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
      const threadId: unknown = raw === null ? null : threadOf(raw).id;
      const entry: TrashEntry = {
        trashId: randomUUID(),
        originalRelativePath: path.relative(outputDir, path.resolve(filePath)).split(path.sep).join('/'),
        title: titleOf(raw, path.basename(filePath)),
        deletedAt: now.toISOString(),
        ...(isConversationId(threadId) ? { threadId } : {}),
      };
      return { filePath, entry };
    }));
    if (planned.length === 0) return { trashIds: [], failed: [], busy };
    try {
      await writeIndex([...entries, ...planned.map((item) => item.entry)]);
    } catch {
      return { trashIds: [], failed: present, busy };
    }
    const moved: TrashEntry[] = [];
    const failed: string[] = [];
    let skipped = 0;
    for (const { filePath, entry } of planned) {
      // A send may have started while the index was being read and written.
      const reason = conversationBusyReason(filePath);
      if (reason) {
        busy.push({ path: filePath, reason });
        skipped += 1;
        continue;
      }
      try {
        await moveFile(filePath, storedPath(entry.trashId));
        moved.push(entry);
      } catch {
        failed.push(filePath);
      }
    }
    if (failed.length + skipped > 0) await writeIndex([...entries, ...moved]).catch(() => undefined);
    return { trashIds: moved.map((entry) => entry.trashId), failed, busy };
  });
}

/**
 * Puts conversations back where they were: the folder is made again when it is gone, and a name
 * taken in the meantime gets a number. Ids not in the index are ignored. Returns the restored paths.
 */
export async function restoreFromTrash(trashIds: readonly unknown[], outputDir: string): Promise<string[]> {
  const wanted = new Set(trashIds.filter(isTrashId));
  if (wanted.size === 0) return [];
  return lock.runExclusive(async () => {
    const entries = await readIndex().catch(() => null);
    if (!entries) return [];
    const restored: string[] = [];
    const restoredIds = new Set<string>();
    for (const entry of entries) {
      if (!wanted.has(entry.trashId)) continue;
      let target = restoreTarget(outputDir, entry.originalRelativePath);
      // A file now sits where the folder was: back to the top level.
      if (!await fs.mkdir(path.dirname(target), { recursive: true }).then(() => true, () => false)) {
        target = path.join(outputDir, path.basename(target));
      }
      target = await getUniquePath(target, '');
      try {
        await moveFile(storedPath(entry.trashId), target);
      } catch {
        continue;
      }
      restored.push(target);
      restoredIds.add(entry.trashId);
    }
    if (restoredIds.size > 0) {
      await writeIndex(entries.filter((entry) => !restoredIds.has(entry.trashId))).catch(() => undefined);
    }
    return restored;
  });
}

/**
 * Deletes for good, then forgets the versions and Notion sync state of every id no conversation in
 * outputs or still in the trash names. Runs inside the lock: a file moving between the two folders
 * while they are read could be missed by both, and its history wrongly deleted.
 */
async function purgeEntries(pick: (entry: TrashEntry) => boolean, outputDir: string): Promise<number> {
  const entries = await readIndex().catch(() => null);
  if (!entries) return 0;
  const doomed = entries.filter(pick);
  if (doomed.length === 0) return 0;
  // Files first: if the index write then fails, its entries point at nothing and are dropped later.
  for (const entry of doomed) await fs.rm(storedPath(entry.trashId), { force: true }).catch(() => undefined);
  const gone = new Set(doomed.map((entry) => entry.trashId));
  await writeIndex(entries.filter((entry) => !gone.has(entry.trashId)));
  const ids = new Set(doomed.flatMap((entry) => (entry.threadId ? [entry.threadId] : [])));
  await forgetOrphanedConversations(ids, [outputDir, conversationTrashDir()]);
  return doomed.length;
}

/** Deletes the given conversations in the trash for good, or all of them. Returns how many. */
export async function purgeTrash(trashIds: readonly unknown[] | 'all', outputDir: string): Promise<number> {
  const wanted = trashIds === 'all' ? null : new Set(trashIds.filter(isTrashId));
  if (wanted?.size === 0) return 0;
  return lock.runExclusive(() => purgeEntries((entry) => wanted === null || wanted.has(entry.trashId), outputDir));
}

/** Deletes what has been in the trash for TRASH_RETENTION_DAYS, and entries whose file is gone. */
export async function sweepExpiredTrash(outputDir: string, now = new Date()): Promise<number> {
  return lock.runExclusive(() => purgeEntries(
    (entry) => expiresAt(entry) <= now.getTime() || !existsSync(storedPath(entry.trashId)),
    outputDir,
  ));
}

/**
 * Deletes outright, for files that could not go to the trash, after the user agreed. A history a
 * conversation in the trash still names stays.
 */
export async function deleteConversationsPermanently(filePaths: readonly string[], outputDir: string): Promise<number> {
  return lock.runExclusive(async () => {
    await fs.mkdir(conversationTrashDir(), { recursive: true }).catch(() => undefined);
    return deleteConversationFiles(filePaths, outputDir, [conversationTrashDir()]);
  });
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Sweeps now, then once a day while the app runs; `onSwept` hears when something was deleted. */
export function startTrashSweep(onSwept: () => void): void {
  if (sweepTimer) return;
  const sweep = (): void => {
    void getOutputDir()
      .then((outputDir) => sweepExpiredTrash(outputDir))
      .then((count) => { if (count > 0) onSwept(); })
      .catch((err: unknown) => {
        console.warn(`[trash] sweep failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  };
  sweep();
  sweepTimer = setInterval(sweep, DAY_MS);
  sweepTimer.unref?.();
}

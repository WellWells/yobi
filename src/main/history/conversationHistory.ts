import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CONVERSATION_VERSION_CAP,
  CONVERSATION_VERSION_MAX_BYTES,
  isConversationId,
  isVersionId,
  makeVersionId,
  parseVersionIndex,
  sameConversationText,
  threadOf,
} from '../../shared/conversationHistory';
import type { ConversationVersionEntry, ConversationVersionReason } from '../../shared/conversationHistory';
import { parseConversationDoc } from '../../shared/conversationDoc';
import { writeFileAtomic } from '../atomicWrite';
import { Mutex } from '../flow/lanes';
import { deleteNotionSync } from '../notion/notionSyncStore';
import { conversationHistoryRoot } from './historyPaths';

/*
 * The versions of one conversation: `history/conversations/<id>/index.json` and one `<vid>.md` per
 * version. Addressed only by an id and a version id that pass the strict patterns, never by a path
 * the renderer sent. Each id has its own lock: the index is read, changed and written back.
 */

const INDEX_FILE = 'index.json';
const locks = new Map<string, Mutex>();

function lockFor(id: string): Mutex {
  let lock = locks.get(id);
  if (!lock) {
    lock = new Mutex();
    locks.set(id, lock);
  }
  return lock;
}

export function newConversationId(): string {
  return randomUUID();
}

function dirFor(id: string): string {
  if (!isConversationId(id)) throw new Error('Invalid conversation id');
  return path.join(conversationHistoryRoot(), id);
}

function versionPath(id: string, vid: string): string {
  if (!isVersionId(vid)) throw new Error('Invalid version id');
  return path.join(dirFor(id), `${vid}.md`);
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/**
 * The index, oldest first. Only a missing index is an empty history: one that cannot be read or
 * makes no sense throws, so a save never writes a fresh index over versions it could not see.
 */
async function readIndex(id: string): Promise<ConversationVersionEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dirFor(id), INDEX_FILE), 'utf-8');
  } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return [];
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  const list: unknown = parsed && typeof parsed === 'object' ? (parsed as { versions?: unknown }).versions : null;
  const versions = parseVersionIndex(parsed);
  if (!Array.isArray(list) || (list.length > 0 && versions.length === 0)) throw new Error('Unreadable version index');
  return versions;
}

/** For reading only: an index that cannot be read lists as empty, so the dialog still opens. */
async function readIndexOrEmpty(id: string): Promise<ConversationVersionEntry[]> {
  try {
    return await readIndex(id);
  } catch (err: unknown) {
    console.warn(`[history] could not read a conversation's versions: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function writeIndex(id: string, versions: ConversationVersionEntry[]): Promise<void> {
  await writeFileAtomic(path.join(dirFor(id), INDEX_FILE), JSON.stringify({ versions }, null, 2));
}

async function readVersionText(id: string, vid: string): Promise<string | null> {
  try {
    return await fs.readFile(versionPath(id, vid), 'utf-8');
  } catch {
    return null;
  }
}

function titleOf(content: string): string {
  const { title } = parseConversationDoc(content, {
    provider: new Set(), time: new Set(), prompt: new Set(), response: new Set(),
  });
  return (title ?? '').slice(0, 200);
}

export type RecordOutcome = 'saved' | 'duplicate' | 'skipped' | 'failed';

/**
 * Keeps `content` as a version of conversation `id`, unless it reads the same as the newest one
 * (markers aside). The oldest beyond the cap are dropped, files and all. Never throws: a version
 * that could not be kept must not fail the edit it was taken for.
 */
export function recordConversationVersion(
  id: string,
  content: string,
  reason: ConversationVersionReason,
  now: () => number = Date.now,
): Promise<RecordOutcome> {
  if (!isConversationId(id) || !content.trim()) return Promise.resolve('skipped');
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > CONVERSATION_VERSION_MAX_BYTES) return Promise.resolve('skipped');
  return lockFor(id).runExclusive(async (): Promise<RecordOutcome> => {
    try {
      const versions = await readIndex(id);
      const latest = versions.at(-1);
      if (latest) {
        const latestText = await readVersionText(id, latest.vid);
        if (latestText !== null && sameConversationText(latestText, content)) return 'duplicate';
      }
      let vid = makeVersionId(now());
      while (versions.some((entry) => entry.vid === vid)) vid = makeVersionId(now());
      await fs.mkdir(dirFor(id), { recursive: true });
      await writeFileAtomic(versionPath(id, vid), content);
      const next = [...versions, { vid, at: new Date(now()).toISOString(), reason, title: titleOf(content), bytes }];
      const dropped = next.length > CONVERSATION_VERSION_CAP ? next.splice(0, next.length - CONVERSATION_VERSION_CAP) : [];
      await writeIndex(id, next);
      await Promise.all(dropped.map((entry) => fs.rm(versionPath(id, entry.vid), { force: true }).catch(() => undefined)));
      return 'saved';
    } catch (err: unknown) {
      console.warn(`[history] could not keep a conversation version: ${err instanceof Error ? err.message : String(err)}`);
      return 'failed';
    }
  });
}

/** Newest first. */
export async function listConversationVersions(id: string): Promise<ConversationVersionEntry[]> {
  if (!isConversationId(id)) return [];
  return (await lockFor(id).runExclusive(() => readIndexOrEmpty(id))).reverse();
}

/** Whether versions were ever kept under this id and are still on disk. */
export async function hasConversationHistory(id: string): Promise<boolean> {
  if (!isConversationId(id)) return false;
  try {
    return (await fs.stat(dirFor(id))).isDirectory();
  } catch {
    return false;
  }
}

export async function readConversationVersion(id: string, vid: string): Promise<string | null> {
  if (!isConversationId(id) || !isVersionId(vid)) return null;
  return lockFor(id).runExclusive(async () => {
    const listed = (await readIndexOrEmpty(id)).some((entry) => entry.vid === vid);
    return listed ? readVersionText(id, vid) : null;
  });
}

export async function deleteConversationVersion(id: string, vid: string): Promise<boolean> {
  if (!isConversationId(id) || !isVersionId(vid)) return false;
  return lockFor(id).runExclusive(async () => {
    const versions = await readIndex(id);
    const next = versions.filter((entry) => entry.vid !== vid);
    if (next.length === versions.length) return false;
    await writeIndex(id, next);
    await fs.rm(versionPath(id, vid), { force: true });
    return true;
  });
}

/** Every version of the conversation, gone from disk. */
export async function deleteConversationHistory(id: string): Promise<void> {
  if (!isConversationId(id)) return;
  await lockFor(id).runExclusive(() => fs.rm(dirFor(id), { recursive: true, force: true }));
}

/**
 * Of `ids`, the ones no conversation in any of `dirs` names any more. A copy of a file (made in
 * Explorer) carries the same id as its original, so the original still names it; so does a
 * conversation waiting in Recently Deleted. Throws when a folder or a file in it cannot be read:
 * then nobody can tell, and every history stays.
 */
async function idsNoLongerNamed(ids: ReadonlySet<string>, dirs: readonly string[]): Promise<Set<string>> {
  const left = new Set(ids);
  for (const dir of dirs) {
    const names = await fs.readdir(dir, { recursive: true });
    const named = await Promise.all(names.filter((name) => name.endsWith('.md')).map(async (name): Promise<unknown> => {
      let raw: string;
      try {
        raw = await fs.readFile(path.join(dir, name), 'utf-8');
      } catch (err: unknown) {
        // Gone since the listing, or a folder named like a file: neither is a conversation.
        if (errorCode(err) === 'ENOENT' || errorCode(err) === 'EISDIR') return null;
        throw err;
      }
      return [...left].some((id) => raw.includes(id)) ? threadOf(raw).id : null;
    }));
    for (const id of named) if (typeof id === 'string') left.delete(id);
  }
  return left;
}

/**
 * Removes what Yobi kept beside each conversation — its versions and a Notion document's sync
 * state (the page in Notion is never touched) — for the ids no conversation in `dirs` names any
 * more. When a folder cannot be read, everything stays.
 */
export async function forgetOrphanedConversations(ids: ReadonlySet<string>, dirs: readonly string[]): Promise<void> {
  if (ids.size === 0) return;
  const orphaned = await idsNoLongerNamed(ids, dirs).catch((err: unknown) => {
    console.warn(`[history] kept the versions of deleted conversations: ${err instanceof Error ? err.message : String(err)}`);
    return new Set<string>();
  });
  for (const id of orphaned) {
    await deleteConversationHistory(id).catch(() => undefined);
    await deleteNotionSync(id).catch(() => undefined);
  }
}

/**
 * Deleting conversations for good deletes their versions with them: forgetting has to mean the
 * earlier versions too. An id is read before its file goes; a file that cannot be read still goes.
 * A history another conversation in `outputDir` or `alsoNamedIn` still names (a copy, or one in
 * Recently Deleted) stays, and so does every history when a folder cannot be read. Returns the
 * number of files deleted.
 */
export async function deleteConversationFiles(
  filePaths: readonly string[],
  outputDir: string,
  alsoNamedIn: readonly string[] = [],
): Promise<number> {
  const ids = new Set<string>();
  let deleted = 0;
  for (const filePath of filePaths) {
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
    try {
      await fs.unlink(filePath);
    } catch {
      continue;
    }
    deleted += 1;
    const id: unknown = raw === null ? null : threadOf(raw).id;
    if (isConversationId(id)) ids.add(id);
  }
  await forgetOrphanedConversations(ids, [outputDir, ...alsoNamedIn]);
  return deleted;
}

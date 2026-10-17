import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isConversationId } from '../../shared/conversationHistory';
import type { MergeConflict } from '../../shared/notion/notionDiff';
import type { NotionCallError } from '../../shared/notion/notionFetch';
import { writeFileAtomic } from '../atomicWrite';
import { Mutex } from '../flow/lanes';
import { getFlowDataDir } from '../flow/paths';

/*
 * What Yobi last knew of each Notion document's page: the common ancestor for the three-way merge,
 * and the conflicts waiting for the user. Kept beside the version history, outside outputs (every
 * .md there is read as a conversation), one JSON file per document id.
 */

export const NOTION_SYNC_DIR_NAME = 'notion-sync';

export interface NotionSyncState {
  v: 1;
  /** Notion's text (not spaced) when the document last matched the page. */
  base: string;
  baseTitle: string;
  /** `page_last_edited_at` at that moment. Empty: never synced, the next pull takes Notion's text. */
  baseEditedAt: string;
  syncedAt: string;
  conflicts: MergeConflict[];
  lastError?: { kind: NotionCallError; at: string };
  /** Notion left blocks out of the last read. */
  partial?: boolean;
}

const locks = new Map<string, Mutex>();

function lockFor(id: string): Mutex {
  let lock = locks.get(id);
  if (!lock) {
    lock = new Mutex();
    locks.set(id, lock);
  }
  return lock;
}

export function notionSyncRoot(): string {
  return path.join(getFlowDataDir(), NOTION_SYNC_DIR_NAME);
}

function fileFor(id: string): string {
  if (!isConversationId(id)) throw new Error('Invalid document id');
  return path.join(notionSyncRoot(), `${id}.json`);
}

function isBlockList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((block) => typeof block === 'string');
}

function parseState(value: unknown): NotionSyncState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  if (state.v !== 1 || typeof state.base !== 'string' || typeof state.baseTitle !== 'string'
    || typeof state.baseEditedAt !== 'string' || typeof state.syncedAt !== 'string') return null;
  const conflicts = Array.isArray(state.conflicts)
    ? state.conflicts.filter((item): item is MergeConflict => {
      const conflict = item as Record<string, unknown> | null;
      return Boolean(conflict) && isBlockList(conflict?.base) && isBlockList(conflict?.local) && isBlockList(conflict?.remote)
        && Number.isInteger(conflict?.at) && Number.isInteger(conflict?.localAt);
    })
    : [];
  const lastError = state.lastError as { kind?: unknown; at?: unknown } | undefined;
  return {
    v: 1,
    base: state.base,
    baseTitle: state.baseTitle,
    baseEditedAt: state.baseEditedAt,
    syncedAt: state.syncedAt,
    conflicts,
    ...(state.partial === true ? { partial: true } : {}),
    ...(lastError && typeof lastError.kind === 'string' && typeof lastError.at === 'string'
      ? { lastError: { kind: lastError.kind as NotionCallError, at: lastError.at } }
      : {}),
  };
}

async function readUnlocked(id: string): Promise<NotionSyncState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(fileFor(id), 'utf-8');
  } catch {
    return null;
  }
  try {
    return parseState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readNotionSync(id: string): Promise<NotionSyncState | null> {
  return lockFor(id).runExclusive(() => readUnlocked(id));
}

/**
 * Reads, changes and writes one document's state under its lock. `change` returning null deletes
 * the state. An unreadable file reads as none: the next pull then takes Notion's text as the base,
 * which never sends anything to Notion by itself.
 */
export function updateNotionSync(
  id: string,
  change: (state: NotionSyncState | null) => NotionSyncState | null | Promise<NotionSyncState | null>,
): Promise<NotionSyncState | null> {
  return lockFor(id).runExclusive(async () => {
    const next = await change(await readUnlocked(id));
    if (next === null) {
      await fs.rm(fileFor(id), { force: true });
      return null;
    }
    await fs.mkdir(notionSyncRoot(), { recursive: true });
    await writeFileAtomic(fileFor(id), JSON.stringify(next, null, 2));
    return next;
  });
}

export async function deleteNotionSync(id: string): Promise<void> {
  if (!isConversationId(id)) return;
  await lockFor(id).runExclusive(() => fs.rm(fileFor(id), { force: true }));
}

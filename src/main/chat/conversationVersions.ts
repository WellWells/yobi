import * as fs from 'node:fs/promises';
import {
  canVersionConversation,
  conversationIdOf,
  isVersionId,
  restoredConversation,
  sameConversationText,
  shouldKeepBeforeReload,
  withConversationId,
  CONVERSATION_VERSION_MAX_BYTES,
} from '../../shared/conversationHistory';
import type { ConversationHistoryList, ConversationRestoreResult } from '../../shared/conversationHistory';
import { writeFileAtomic } from '../atomicWrite';
import {
  deleteConversationHistory,
  deleteConversationVersion,
  hasConversationHistory,
  listConversationVersions,
  newConversationId,
  readConversationVersion,
  recordConversationVersion,
} from '../history/conversationHistory';
import { withConversationFile } from './conversationStore';

/*
 * A conversation file's versions, addressed by the file (which main has already checked is in the
 * outputs folder) and a version id. The id in the file's marker picks the history; reads and writes
 * of the file queue behind every other write to it.
 */

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function listFileVersions(filePath: string): Promise<ConversationHistoryList> {
  const raw = await readText(filePath);
  if (raw === null) return { status: 'failed' };
  if (!canVersionConversation(raw)) return { status: 'unversionable' };
  const id = conversationIdOf(raw);
  return { status: 'ok', versions: id ? await listConversationVersions(id) : [] };
}

export async function readFileVersion(filePath: string, vid: string): Promise<string | null> {
  if (!isVersionId(vid)) return null;
  const raw = await readText(filePath);
  const id = raw === null ? null : conversationIdOf(raw);
  return id ? readConversationVersion(id, vid) : null;
}

export async function deleteFileVersion(filePath: string, vid: string): Promise<boolean> {
  if (!isVersionId(vid)) return false;
  const raw = await readText(filePath);
  const id = raw === null ? null : conversationIdOf(raw);
  return id ? deleteConversationVersion(id, vid) : false;
}

export async function deleteFileHistory(filePath: string): Promise<boolean> {
  const raw = await readText(filePath);
  const id = raw === null ? null : conversationIdOf(raw);
  if (!id) return false;
  await deleteConversationHistory(id);
  return true;
}

/**
 * The id the screen's text carried, when versions are still kept under it. Another app that saves
 * the file without its thread marker must not split the history in two; an id with no history on
 * disk is not taken from the renderer.
 */
async function previousConversationId(previous: string): Promise<string | null> {
  const id = conversationIdOf(previous);
  return id && await hasConversationHistory(id) ? id : null;
}

/**
 * The text the screen showed, about to be replaced by what another app wrote. Kept unless the file
 * reads the same (markers aside) or only gained a turn; the file gets an id first if it had none,
 * the screen's own id when its history is still there. `previous` comes from the renderer, so it
 * is checked here, not trusted.
 */
export function keepBeforeExternalChange(filePath: string, previous: unknown): Promise<boolean> {
  if (typeof previous !== 'string' || Buffer.byteLength(previous, 'utf-8') > CONVERSATION_VERSION_MAX_BYTES) {
    return Promise.resolve(false);
  }
  return withConversationFile(filePath, async () => {
    const current = await readText(filePath);
    if (current === null || !shouldKeepBeforeReload(previous, current)) return false;
    const kept = await previousConversationId(previous);
    const versioned = withConversationId(current, () => kept ?? newConversationId());
    if (!versioned) return false;
    if (versioned.raw !== current) await writeFileAtomic(filePath, versioned.raw);
    return (await recordConversationVersion(versioned.id, previous, 'external')) === 'saved';
  });
}

/**
 * Puts a version back. The text on disk is kept as a version first, so a restore is one more step,
 * never a rewind; the file keeps its id, and loses its tie to the provider's thread and summary.
 */
export function restoreFileVersion(filePath: string, vid: string): Promise<ConversationRestoreResult> {
  if (!isVersionId(vid)) return Promise.resolve({ ok: false, reason: 'missing' });
  return withConversationFile(filePath, async (): Promise<ConversationRestoreResult> => {
    const current = await readText(filePath);
    const id = current === null ? null : conversationIdOf(current);
    if (current === null || !id) return { ok: false, reason: 'missing' };
    const version = await readConversationVersion(id, vid);
    if (version === null) return { ok: false, reason: 'missing' };
    const next = restoredConversation(version, current);
    if (!sameConversationText(current, next)) {
      // Nothing is written unless what is there now was kept (or already is the newest version).
      const kept = await recordConversationVersion(id, current, 'restore');
      if (kept === 'skipped') return { ok: false, reason: 'tooLarge' };
      if (kept === 'failed') return { ok: false, reason: 'failed' };
    }
    await writeFileAtomic(filePath, next);
    return { ok: true, content: next };
  });
}

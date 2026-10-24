import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IPC } from '../shared/types';
import { stampConversationId } from '../shared/conversationHistory';
import type {
  ConversationMove,
  ConversationMovedEvent,
  ConversationMoveOutcome,
  ConversationMoveResult,
} from '../shared/conversationMove';
import { writeFileAtomic } from './atomicWrite';
import { repointBotConversations } from './botConversations';
import { withConversationFile } from './chat/conversationStore';
import { conversationBusyReason } from './conversationBusy';
import { conversationPathKey } from './conversationPaths';
import { invalidateConversationIndex, noteConversationMoved } from './conversationIndex';
import { getOutputDir, getUniquePath, listOutputFiles } from './files';
import { repointRunConversations } from './flow/agent/agentRunStore';
import { busyReasonReader } from './conversationBusyCheck';
import { sendLog, sendToRenderer } from './helpers';
import { newConversationId } from './history/conversationHistory';

/*
 * The only way Yobi moves a conversation file. Everything that kept the old path is told: the bot
 * chats' map, saved Agent runs, the id index, and the renderer's path-keyed state. A conversation
 * something is about to write to is refused, never moved under it.
 */

/** One drop or one menu action; a longer list is not something the user picked. */
export const MOVE_MAX_FILES = 500;

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The folder a move may go to, or null: the outputs folder itself, or one folder directly inside
 * it (one level only) whose name does not start with a dot. A relative name is a folder in outputs.
 */
export function resolveMoveTarget(outputDir: string, target: string): string | null {
  if (typeof target !== 'string') return null;
  const root = path.resolve(outputDir);
  const trimmed = target.trim();
  if (!trimmed) return root;
  if (!path.isAbsolute(trimmed) && /[\\/]/.test(trimmed)) return null;
  const resolved = path.resolve(root, trimmed);
  if (conversationPathKey(resolved) === conversationPathKey(root)) return root;
  if (!isInside(root, resolved)) return null;
  const parts = path.relative(root, resolved).split(path.sep);
  if (parts.length !== 1) return null;
  const name = parts[0] ?? '';
  if (!name || name.startsWith('.') || name !== name.trim()) return null;
  return resolved;
}

/** A conversation file the move may take: a .md inside outputs (any folder). */
function isMovableSource(root: string, filePath: string): boolean {
  return typeof filePath === 'string' && /\.md$/i.test(filePath) && isInside(root, path.resolve(filePath));
}

/** The target folder exists as a real folder inside outputs (created when missing, never through a link). */
async function ensureTargetFolder(root: string, target: string): Promise<boolean> {
  if (target === root) return true;
  try {
    await fs.mkdir(target);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
  }
  try {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory()) return false;
    const real = await fs.realpath(target);
    return isInside(await fs.realpath(root), real);
  } catch {
    return false;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Moves each file into `targetDir` (the outputs folder or a folder directly in it), one at a time,
 * under a free name there. A file something is writing to is reported busy and left; a file with
 * no id is given one first, inside its write queue, so it can be found again after the move.
 */
export async function moveConversations(paths: readonly string[], targetDir: string): Promise<ConversationMoveResult> {
  const root = path.resolve(await getOutputDir());
  const target = resolveMoveTarget(root, targetDir);
  const sources = paths.slice(0, MOVE_MAX_FILES);
  if (!target || !await ensureTargetFolder(root, target)) {
    return { outcomes: [], error: 'invalidTarget' };
  }

  // Read once: a question an Agent run left waiting, after a restart too, holds its conversation.
  const busyReasonOf = await busyReasonReader();
  const outcomes: ConversationMoveOutcome[] = [];
  const moved: Array<ConversationMove & { id: string }> = [];

  for (const from of sources) {
    if (!isMovableSource(root, from)) {
      outcomes.push({ from, status: 'invalid' });
      continue;
    }
    const source = path.resolve(from);
    if (conversationPathKey(path.dirname(source)) === conversationPathKey(target)) {
      outcomes.push({ from, status: 'unchanged' });
      continue;
    }
    const busyBefore = busyReasonOf(source);
    if (busyBefore) {
      outcomes.push({ from, status: 'busy', reason: busyBefore });
      continue;
    }
    try {
      const outcome = await withConversationFile(source, async (): Promise<ConversationMoveOutcome> => {
        let raw: string;
        try {
          raw = await fs.readFile(source, 'utf-8');
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { from, status: 'missing' };
          throw err;
        }
        // A send may have started while this waited for the file's queue.
        const busy = conversationBusyReason(source);
        if (busy) return { from, status: 'busy', reason: busy };
        const stamped = stampConversationId(raw, newConversationId);
        if (stamped.raw !== raw) await writeFileAtomic(source, stamped.raw);
        const destination = await getUniquePath(path.join(target, path.basename(source)), '');
        await fs.rename(source, destination);
        moved.push({ from, to: destination, id: stamped.id });
        return { from, status: 'moved', to: destination };
      });
      outcomes.push(outcome);
    } catch (err: unknown) {
      sendLog(`⚠️ Could not move ${path.basename(source)}: ${errorText(err)}`);
      outcomes.push({ from, status: 'failed', error: errorText(err) });
    }
  }

  if (moved.length > 0) await announceConversationMoves(moved);
  return { outcomes };
}

/**
 * Tells everything that kept the old paths where the files went: the id index, the bot chats' map,
 * saved Agent runs, then the renderer (the moves first, the refreshed list after). Shared by moving
 * files and renaming a folder, which moves every file in it at once.
 */
export async function announceConversationMoves(moved: ReadonlyArray<ConversationMove & { id?: string }>): Promise<void> {
  if (moved.length === 0) return;
  for (const move of moved) {
    if (move.id) noteConversationMoved(move.from, move.to, move.id);
  }
  invalidateConversationIndex();
  await repointBotConversations(moved).catch((err: unknown) => {
    sendLog(`⚠️ Could not update the bot chats for moved conversations: ${errorText(err)}`);
  });
  await repointRunConversations(moved).catch((err: unknown) => {
    sendLog(`⚠️ Could not update saved Agent runs for moved conversations: ${errorText(err)}`);
  });
  sendLog(`📁 Moved ${moved.length} conversation file(s)`);
  // Ahead of the list: the renderer re-keys the open conversation first, so the list keeps it open.
  sendToRenderer(IPC.CONVERSATION_MOVED, {
    moves: moved.map(({ from, to }) => ({ from, to })),
  } satisfies ConversationMovedEvent);
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
}

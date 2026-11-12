import * as fs from 'node:fs/promises';
import { parseConversationDoc, truncateTurnsFrom, withConversationTitle, writeThreadMeta } from '../../shared/conversationDoc';
import { cleanTitle } from '../../shared/conversationTitle';
import type { ThreadMeta } from '../../shared/conversationDoc';
import type { PromptRewindRequest, PromptRewindResult } from '../../shared/types';
import { withConversationId } from '../../shared/conversationHistory';
import { notionDocParts } from '../../shared/notion/notionDoc';
import { writeFileAtomic } from '../atomicWrite';
import { newConversationId, recordConversationVersion } from '../history/conversationHistory';
import { conversationAliases, withConversationFile } from './conversationStore';

/**
 * Editing a question the way Gemini, ChatGPT and Claude do: the conversation goes back to just
 * before that question, and the edited one is sent as the next turn. The text before the cut is
 * kept as a version, so the dropped turns can be restored from the history.
 */

/** The renderer's request, or null when any field is off. */
export function parsePromptRewindRequest(value: unknown): PromptRewindRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { filePath, turnIndex, expected, text } = value as Record<string, unknown>;
  if (typeof filePath !== 'string' || !filePath) return null;
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) return null;
  if (typeof expected !== 'string' || typeof text !== 'string') return null;
  return { filePath, turnIndex, expected, text };
}

/**
 * Editing the first question starts the conversation over, so the H1 becomes the placeholder a new
 * conversation gets from its first question. The send that follows then renames it the way any
 * first send does, which only replaces that placeholder: left on the old title, it named the
 * question that was just replaced.
 */
function withRestartedTitle(raw: string, turnIndex: number, text: string): string {
  if (turnIndex !== 0) return raw;
  return withConversationTitle(raw, cleanTitle(text) || 'Untitled') ?? raw;
}

/**
 * The marker once the turns after the cut are gone. The provider's thread holds them all, so it is
 * dropped and the next turn replays the file (as after a restore); a rolling summary that covers a
 * dropped turn goes too. The id, the pin and the conversation's modes stay.
 */
export function threadAfterRewind(thread: ThreadMeta, keptTurns: number): ThreadMeta {
  const { threadUrl: _url, threadTurns: _turns, threadAt: _at, summary, summarizedTurns, ...rest } = thread;
  const summaryStays = summary !== undefined && (summarizedTurns ?? 0) <= keptTurns;
  return {
    ...rest,
    ...(summaryStays ? { summary, ...(summarizedTurns !== undefined ? { summarizedTurns } : {}) } : {}),
    v: 1,
  };
}

/**
 * Removes turn `turnIndex` and every turn after it. `expected` is the question the user started
 * editing: when the file says something else there (another app changed it, or the turns moved),
 * nothing is written.
 */
export function rewindConversation(args: PromptRewindRequest): Promise<PromptRewindResult> {
  return withConversationFile(args.filePath, async (): Promise<PromptRewindResult> => {
    const raw = await fs.readFile(args.filePath, 'utf-8');
    if (notionDocParts(raw)) return { ok: false, reason: 'failed' };
    const aliases = await conversationAliases();
    const doc = parseConversationDoc(raw, aliases);
    const turn = doc.turns[args.turnIndex];
    if (!turn) return { ok: false, reason: 'missing' };
    if (turn.prompt.trim() !== args.expected.trim()) return { ok: false, reason: 'conflict' };

    const cut = truncateTurnsFrom(raw, aliases, args.turnIndex);
    if (cut === null) return { ok: false, reason: 'failed' };
    let next = writeThreadMeta(
      withRestartedTitle(cut, args.turnIndex, args.text),
      threadAfterRewind(doc.thread, args.turnIndex),
    );
    const versioned = withConversationId(next, newConversationId);
    if (versioned) {
      next = versioned.raw;
      await recordConversationVersion(versioned.id, raw, 'edit');
    }
    await writeFileAtomic(args.filePath, next);
    return { ok: true, content: next };
  });
}

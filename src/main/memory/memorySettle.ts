import { MEMORY_NOTE_KEYS } from '../../shared/userMemory';
import type { MemoryNote, UserMemorySource } from '../../shared/userMemory';
import { sendLog } from '../helpers';
import { parseMemoryReply } from './memoryProtocol';
import { admitMemoryOps, withTidyReview } from './memoryRules';
import type { MemoryAccess } from './memoryRules';
import { applyMemoryOps } from './memoryState';
import { updateUserMemory } from './memoryStore';

export interface SettleMemoryContext {
  access: MemoryAccess;
  source: UserMemorySource;
  /** This turn read an attachment, a fetched page or a tool result. */
  tainted: boolean;
  /** What the user typed for this turn, for the explicit-intent check. */
  userText: string;
  /** File name of the conversation the answer lands in. */
  conversation?: string;
  logPrefix?: string;
  /**
   * What to say when the reply was nothing but memory lines. Without it the answer comes out empty
   * — which /agent reports as a failure although the change it made has landed.
   */
  emptyReply?: (notes: readonly MemoryNote[]) => string;
}

export interface SettledReply {
  text: string;
  notes: MemoryNote[];
}

/**
 * Takes the memory lines off a reply and applies the ones this turn may make. The lines are removed
 * whatever happens to them — the user must never see the machinery — but they only change the
 * memory on a surface that may write it and past the taint check. A failure here never fails the
 * answer: the reply is delivered without its notes and the log says why.
 */
export async function settleMemoryReply(reply: string, ctx: SettleMemoryContext): Promise<SettledReply> {
  const parsed = parseMemoryReply(reply);
  if (ctx.access !== 'readWrite') {
    if (parsed.ops.length > 0) sendLog(`${ctx.logPrefix ?? '[Memory]'} 🧠 ${parsed.ops.length} memory line(s) ignored — memory is not writable here`);
    return { text: parsed.cleaned, notes: [] };
  }
  const ops = withTidyReview(parsed.ops, ctx.userText);
  if (ops.length === 0) return { text: parsed.cleaned, notes: [] };
  const prefix = ctx.logPrefix ?? '[Memory]';
  const admitted = admitMemoryOps(ops, { tainted: ctx.tainted, userText: ctx.userText });
  if (admitted.blocked > 0) {
    sendLog(`${prefix} 🧠 ${admitted.blocked} memory change(s) dropped — this turn read outside content and the user did not ask to remember or forget`);
  }
  if (admitted.ops.length === 0) return { text: parsed.cleaned, notes: [] };

  let notes: MemoryNote[] = [];
  try {
    await updateUserMemory((state) => {
      if (!state.enabled) return null;
      const applied = applyMemoryOps(state, admitted.ops, {
        source: ctx.source,
        now: new Date().toISOString(),
        ...(ctx.conversation ? { conversation: ctx.conversation } : {}),
      });
      notes = applied.notes;
      return applied.state === state ? null : { state: applied.state, result: applied.notes };
    });
  } catch (err: unknown) {
    sendLog(`${prefix} ⚠️ memory update failed: ${err instanceof Error ? err.message : String(err)}`);
    return { text: parsed.cleaned, notes: [] };
  }
  if (notes.length > 0) {
    sendLog(`${prefix} 🧠 memory: ${notes.map((note) => `${note.op}${note.id ? ` ${note.id}` : ''}`).join(', ')}`);
  }
  const text = parsed.cleaned || (notes.length > 0 && ctx.emptyReply ? ctx.emptyReply(notes) : parsed.cleaned);
  return { text, notes };
}

/** The whole reply when a model answered with memory lines alone: a plain "done", or that it did not fit. */
export function memoryOnlyReply(
  notes: readonly MemoryNote[],
  translate: (key: string) => string,
): string {
  return translate(notes.every((note) => note.op === 'full') ? 'memory.reply.full' : 'memory.reply.done');
}

/**
 * The same notes as the chat shows under a reply, as plain lines for a bot message. A review has
 * no button to press in a bot chat, so its line says where to go instead.
 */
export function formatMemoryNotes(
  notes: readonly MemoryNote[],
  translate: (key: string, vars: Record<string, string>) => string,
): string {
  return notes
    .map((note) => `🧠 ${translate(note.op === 'review' ? 'memory.note.review.bot' : MEMORY_NOTE_KEYS[note.op], { text: note.text })}`)
    .join('\n');
}

export function withMemoryNotes(
  text: string,
  notes: readonly MemoryNote[],
  translate: (key: string, vars: Record<string, string>) => string,
): string {
  if (notes.length === 0) return text;
  return `${text}\n\n${formatMemoryNotes(notes, translate)}`;
}

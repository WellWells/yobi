import type { ConversationTurn } from './conversationDoc';

function timeOf(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

/** When the turn's answer was last edited in Yobi, or null when it never was. */
export function editedAt(turn: ConversationTurn): string | null {
  const value: unknown = turn.meta.ed;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Indices of the turns whose edited answer the model has not seen yet.
 *
 * Any turn answered after an edit was sent with it: a native follow-up carries the edited answers
 * along, and every other send re-sends the conversation from the file. So an edit is news only
 * when it is newer than the latest turn — or when that turn has no time to compare against.
 */
export function unsentEditedTurns(turns: readonly ConversationTurn[]): number[] {
  const latest = timeOf(turns.at(-1)?.meta.t);
  return turns.flatMap((turn, index) => {
    const edited = timeOf(editedAt(turn));
    if (Number.isNaN(edited)) return [];
    return Number.isNaN(latest) || edited > latest ? [index] : [];
  });
}

import type { ConversationDoc, ConversationTurn } from './conversationDoc';

/** Longest recap line kept, in code points: one or two sentences, never a second answer. */
export const RECAP_MAX_CHARS = 300;

export interface RecapView {
  /** The recap, as the model is shown it on the next send. */
  text: string;
  lines: string[];
  /** `meta.t` of the turn that wrote it; '' when that turn carries no time. */
  at: string;
}

/** Collapses whitespace and cuts to `max` code points, so a CJK sentence is never split mid-surrogate. */
export function cleanRecap(raw: string, max = RECAP_MAX_CHARS): string {
  const chars = [...raw.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

/** The stored recap: a string (possibly the '' sentinel) or null for no key or a hand-broken value. */
function readRecap(turn: ConversationTurn): string | null {
  const rc: unknown = turn.meta.rc;
  return typeof rc === 'string' ? rc.trim() : null;
}

/**
 * Where the conversation stands: the newest recap the model wrote — chat and Agent alike, each one
 * a summary of the whole conversation so far. Turns without one are passed over (the model left it
 * out, an Agent stopped to ask, a flow command ran); a turn made without the rule (a bot reply)
 * stops the walk, since past it an older line may describe a conversation that has moved on.
 */
export function currentRecap(doc: Pick<ConversationDoc, 'turns'>): RecapView | null {
  for (let index = doc.turns.length - 1; index >= 0; index -= 1) {
    const turn = doc.turns[index];
    const recap = readRecap(turn);
    if (recap === '') return null;
    if (recap) return { text: recap, lines: [recap], at: turn.meta.t ?? '' };
  }
  return null;
}

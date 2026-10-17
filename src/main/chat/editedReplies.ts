import type { ConversationTurn } from '../../shared/conversationDoc';
import { fenceUntrusted } from '../../shared/promptFencing';
import { compactPreview } from '../../shared/textBudget';
import { ROLE_ASSISTANT, ROLE_USER } from './conversationFrame';

export const TAG_EDITED_REPLY = 'edited_reply';

/** How much of the question each edited reply is introduced with: enough to find it, not to resend it. */
const QUESTION_EXCERPT_CHARS = 300;

/**
 * What a native follow-up carries ahead of the question when the user edited earlier answers in
 * Yobi. The provider's thread still holds the original wording, so without this the model would
 * keep building on the text the user corrected. Each reply is introduced by its question, not a
 * turn number: a thread started from a replay numbers its turns differently from the file.
 */
export function buildEditedRepliesNote(turns: readonly ConversationTurn[]): string {
  if (turns.length === 0) return '';
  const lead = turns.length === 1
    ? 'The user edited one of your earlier replies in this conversation.'
    : `The user edited ${turns.length} of your earlier replies in this conversation.`;
  const blocks = turns.map((turn) => fenceUntrusted(
    TAG_EDITED_REPLY,
    `${ROLE_USER}: ${compactPreview(turn.prompt, QUESTION_EXCERPT_CHARS)}\n\n${ROLE_ASSISTANT}: ${turn.response.trim()}`,
  ));
  return [
    `System Instruction: ${lead} Treat the edited version as what you said, in place of your original wording, and build on it from here.`,
    ...blocks,
  ].join('\n');
}

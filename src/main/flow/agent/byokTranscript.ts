import type { ByokChatMessage } from '../../providers/byokClient';

/**
 * A BYOK run's conversation. An API key has no thread of its own, so the run keeps one here and
 * sends all of it every turn — the way a browser provider's own thread already holds every earlier
 * turn. The first message is the full turn prompt; after it come the model's replies and the
 * deltas, so an observation stays in view instead of falling out of a fixed window of steps.
 */
export interface ByokTranscript {
  messages: ByokChatMessage[];
  /**
   * What the steps rendered inside the first message cost. They are observations too, so they
   * count against the same budget as everything after the first message.
   */
  baseChars: number;
  /**
   * This request's opening message, then any rejected reply and the repair that answered it.
   * Committed only when a reply passes, and then without the rejected pairs: a mistake left in
   * the conversation is one every later turn reads, and pays for.
   */
  pending: ByokChatMessage[];
}

export function createByokTranscript(): ByokTranscript {
  return { messages: [], baseChars: 0, pending: [] };
}

/** Starts the conversation over; the next request sends the full prompt. */
export function resetByokTranscript(transcript: ByokTranscript, baseChars: number): void {
  transcript.messages = [];
  transcript.pending = [];
  transcript.baseChars = baseChars;
}

/** The observation characters a request would carry if `next` were sent as the next message. */
export function transcriptChars(transcript: ByokTranscript, next: string): number {
  const after = transcript.messages.slice(1).reduce((sum, message) => sum + message.content.length, 0);
  return transcript.baseChars + after + next.length;
}

function request(transcript: ByokTranscript): readonly ByokChatMessage[] {
  return [...transcript.messages, ...transcript.pending];
}

/** Opens a request with the user's next message and returns the conversation to send. */
export function openTurn(transcript: ByokTranscript, content: string): readonly ByokChatMessage[] {
  transcript.pending = [{ role: 'user', content }];
  return request(transcript);
}

/** As much of a rejected reply as the full-prompt repair (`buildRepairPrompt`) ever quoted. */
const REJECTED_REPLY_MAX = 1_500;

/**
 * Puts a rejected reply and its repair after the open request's message, and returns what to send
 * next. Only the latest rejection rides along, clipped — a long prose answer re-sent whole, and
 * once more per attempt, would make a repair the largest request of the run.
 */
export function rejectReply(transcript: ByokTranscript, raw: string, repair: string): readonly ByokChatMessage[] {
  transcript.pending = [
    ...transcript.pending.slice(0, 1),
    { role: 'assistant', content: raw.slice(0, REJECTED_REPLY_MAX) },
    { role: 'user', content: repair },
  ];
  return request(transcript);
}

/** Commits the open request's first message and the reply that passed. */
export function acceptReply(transcript: ByokTranscript, raw: string): void {
  const opening = transcript.pending[0];
  if (opening) transcript.messages.push(opening, { role: 'assistant', content: raw });
  transcript.pending = [];
}

/** Every reply was rejected: the conversation stays as it was before the request. */
export function dropPending(transcript: ByokTranscript): void {
  transcript.pending = [];
}

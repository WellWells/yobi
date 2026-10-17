import { isByokTargetUrl } from '../../shared/types';
import { measureFor, promptCapFor } from './conversationContext';

/**
 * The pure core of a one-off AI request (writing tools, translation): one prompt, one reply, sent
 * to a new chat on a browser provider or straight to a BYOK key. It never goes through the chat
 * send, so no answer preferences, reply-language rule, memory or recap ride along, and never into
 * a conversation's own thread. The Electron-bound side is in `oneShotRequest.ts`.
 */

/** Stands in for a blank line: browser providers get every prompt with its blank lines removed. */
const PARAGRAPH_MARK = '¶';
export const PARAGRAPH_RULE = `- A line holding only ${PARAGRAPH_MARK} marks a break between paragraphs: keep one on its own line wherever a paragraph break belongs in your reply.`;
const BLANK_RUN = /\n[ \t]*\n(?:[ \t]*\n)*/g;

/** Blank lines as paragraph marks, for a browser provider; trimmed either way. */
export function markParagraphs(value: string, mark: boolean): string {
  return mark ? value.trim().replace(BLANK_RUN, `\n${PARAGRAPH_MARK}\n`) : value.trim();
}

/** Paragraph marks in a reply back to blank lines. */
export function restoreParagraphs(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === PARAGRAPH_MARK ? '' : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

const WRAPPING_FENCE = /^(`{3,}|~{3,})[ \t]*(?:markdown|md|text)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i;
const QUOTE_PAIRS: ReadonlyArray<[string, string]> = [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』']];

/**
 * The reply without what a chat model tends to wrap around it: one code block holding the whole
 * reply, or one pair of quotes. A fence or a quote inside the text is the text and stays, and so
 * does one around the whole reply when the original was wrapped that way (a selected code block,
 * a quoted sentence).
 */
export function cleanOneShotReply(raw: string, original = ''): string {
  let text = raw.trim();
  const source = original.trim();
  const fenced = WRAPPING_FENCE.exec(text);
  if (fenced && !WRAPPING_FENCE.test(source)) text = fenced[2].trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length < 2 || !text.startsWith(open) || !text.endsWith(close)) continue;
    const inner = text.slice(open.length, text.length - close.length);
    const sourceQuoted = source.startsWith(open) && source.endsWith(close);
    if (!sourceQuoted && !inner.includes(open) && !inner.includes(close)) text = inner.trim();
    break;
  }
  return text;
}

/** The longest prompt the provider takes in one message; BYOK has no known limit beyond its budget. */
export function fitsProvider(providerUrl: string, prompt: string, byokBudgetChars: number): boolean {
  const cap = isByokTargetUrl(providerUrl) ? byokBudgetChars : promptCapFor(providerUrl);
  return cap <= 0 || measureFor(providerUrl)(prompt) <= cap;
}

export type OneShotPhase = 'waiting' | 'running';

export interface OneShotIo {
  byokBudgetChars: number;
  signal: AbortSignal;
  onProgress: (phase: OneShotPhase) => void;
  /** Another AI request holds the browser window, so this one will wait. */
  laneBusy: () => boolean;
  /** Runs in the browser window's queue; `onStart` fires when this request's turn comes. */
  runBrowser: (providerUrl: string, prompt: string, onStart: () => void) => Promise<string>;
  runByok: (providerUrl: string, prompt: string) => Promise<string>;
  /** The error as the user should read it. */
  describeError: (err: unknown) => string;
}

export type OneShotReply =
  | { ok: true; reply: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'failed'; error: string };

/**
 * Sends one prompt and waits for the reply. A browser request waits its turn in the window's queue
 * (and says so); a BYOK key is called directly. A browser request cannot be stopped once typed, so
 * a cancelled one's late answer is dropped.
 */
export async function runOneShot(providerUrl: string, prompt: string, io: OneShotIo): Promise<OneShotReply> {
  try {
    let reply: string;
    if (!isByokTargetUrl(providerUrl)) {
      if (io.laneBusy()) io.onProgress('waiting');
      reply = await io.runBrowser(providerUrl, prompt, () => io.onProgress('running'));
    } else {
      io.onProgress('running');
      reply = await io.runByok(providerUrl, prompt);
    }
    if (io.signal.aborted) return { ok: false, reason: 'cancelled' };
    return { ok: true, reply };
  } catch (err: unknown) {
    if (io.signal.aborted) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', error: io.describeError(err) };
  }
}

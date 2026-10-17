import type { TelegramReplyTarget } from '../../shared/types';
import type { TelegramMessagingContext } from './messaging';

/**
 * One status message rewritten as a run moves along. Telegram rate-limits edits (and rejects an
 * edit that changes nothing), so lines arriving faster than `intervalMs` collapse into the latest
 * one, and edits go out one at a time in order.
 */
export interface ProgressMessage {
  push: (text: string) => void;
  /** Stops further edits; resolves once the last one has gone out, so a final edit lands after it. */
  close: () => Promise<void>;
}

export function createProgressMessage(
  edit: (text: string) => Promise<unknown>,
  intervalMs = 3_000,
  now: () => number = Date.now,
): ProgressMessage {
  let shown = '';
  let pending: string | null = null;
  let lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let closed = false;

  const flush = (): void => {
    timer = null;
    if (closed || pending === null) return;
    const text = pending;
    pending = null;
    lastAt = now();
    shown = text;
    chain = chain.then(() => edit(text)).then(() => undefined, () => undefined);
  };

  return {
    push(text) {
      if (closed || !text || text === (pending ?? shown)) return;
      pending = text;
      if (timer) return;
      const wait = Math.max(0, lastAt + intervalMs - now());
      if (wait === 0) flush();
      else timer = setTimeout(flush, wait);
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      return chain;
    },
  };
}

const QUEUED_PROGRESS_INTERVAL_MS = 4_000;

/**
 * Rewrites the "queued" acknowledgement in place while a builtin or /agent run moves along.
 * Without an acknowledgement there is nothing to rewrite, so every line is dropped.
 */
export function queuedMessageProgress(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  intervalMs: number = QUEUED_PROGRESS_INTERVAL_MS,
): ProgressMessage {
  const messageId = target.queuedMessageId;
  if (messageId === undefined) return { push: () => {}, close: async () => {} };
  return createProgressMessage(async (text) => {
    await mctx.getBot()?.api.editMessageText(target.chatId, messageId, text);
  }, intervalMs);
}

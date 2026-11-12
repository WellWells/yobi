/**
 * A request's scratch pictures and files (`BotAgentMedia`) kept while its agent run waits for the
 * user's answer: the resumed run uploads them again (a web model starts a new thread), so they go
 * only once the run is really over — answered without a new question, its question dropped or
 * replaced by a new request, or the longest answer time passed. Keyed by chat and person, as the
 * question is.
 */
import { AGENT_ASK_TTL_MAX_MINUTES } from '../../shared/types';
import type { BotAgentMedia } from './types';

/** Longer than any question waits (`askTtlMinutes` is at most this), so no answer can still need them. */
export const HELD_MEDIA_MAX_MS = (AGENT_ASK_TTL_MAX_MINUTES + 1) * 60_000;

export type HeldMedia = Pick<BotAgentMedia, 'dispose' | 'failureText'>;

interface Held {
  media: HeldMedia;
  timer: ReturnType<typeof setTimeout>;
}

export class HeldMediaStore {
  private readonly held = new Map<string, Held>();

  /** Keeps `media` for the answer to the question in this chat; one held before is let go. */
  hold(chatId: string, userId: string, media: HeldMedia): void {
    const key = heldKey(chatId, userId);
    void this.release(chatId, userId);
    const timer = setTimeout(() => {
      void this.release(chatId, userId);
    }, HELD_MEDIA_MAX_MS);
    timer.unref?.();
    this.held.set(key, { media, timer });
  }

  /** The media held for this chat's question, taken out (the answer's run now owns it). */
  take(chatId: string, userId: string): HeldMedia | null {
    const key = heldKey(chatId, userId);
    const entry = this.held.get(key);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.held.delete(key);
    return entry.media;
  }

  /** Deletes what is held for this chat, if anything. */
  async release(chatId: string, userId: string): Promise<void> {
    await this.take(chatId, userId)?.dispose().catch(() => undefined);
  }
}

function heldKey(chatId: string, userId: string): string {
  return `${chatId}\n${userId}`;
}

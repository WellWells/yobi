import { t } from './i18n';

/**
 * How often one person may start work on a bot: an agent run, a link's flow, a flow command, a
 * picture. Two rules, both per person and platform:
 *
 * - Everyone, the owner included: a request sent sooner than `BOT_PACE_PAIRED_MS` (paired) or
 *   `BOT_PACE_UNPAIRED_MS` (anyone else) after the last one taken is not taken.
 * - Someone unpaired (a group's grant reaches strangers): one at a time — what they sent while
 *   their last request was still running is not taken either. Spacing alone lets a stranger who
 *   sends exactly every ten seconds keep the bot busy forever.
 *
 * Times are the message's own (Telegram `date`, LINE `timestamp`), not when it is read: Telegram
 * updates are handled one at a time, so a burst's tail is read long after it was sent and would
 * all look spaced out by then.
 */
export const BOT_PACE_PAIRED_MS = 5_000;
export const BOT_PACE_UNPAIRED_MS = 10_000;
/** Telegram's `date` is in whole seconds, and the clocks differ a little. */
const DONE_SLACK_MS = 2_000;
/** A run that never reported back does not lock its sender out for good. */
const BUSY_MAX_MS = 30 * 60_000;
const FORGET_AFTER_MS = 10 * 60_000;
const PRUNE_AT = 500;

export type BotPaceRefusal = 'tooSoon' | 'busy';

/** What a taken request holds; `done` when its work has finished (called twice = once). */
export interface BotPaceTicket {
  done: () => void;
}

export type BotPaceVerdict =
  | ({ ok: true } & BotPaceTicket)
  | { ok: false; reason: BotPaceRefusal; seconds: number; tell: boolean };

export interface BotRequestPace {
  /** `key` names the person on this bot; `sentAt` is the message's own time in ms. */
  admit: (key: string, request: { sentAt: number; paired: boolean }) => BotPaceVerdict;
}

interface PaceEntry {
  lastSentAt: number;
  /** Local time the unpaired person's running request started; absent = none running. */
  busySince?: number;
  /** Local time (less the slack) their last request finished: anything sent before is refused. */
  freeSince: number;
  /** Already told since the last request taken: further refusals stay silent. */
  told: boolean;
  touchedAt: number;
}

/** For a caller with no pace (tests, a path that is never paced). */
export const UNPACED: BotPaceTicket = { done: () => {} };

export function createBotRequestPace(now: () => number = Date.now): BotRequestPace {
  const entries = new Map<string, PaceEntry>();

  const prune = (at: number): void => {
    if (entries.size < PRUNE_AT) return;
    for (const [key, entry] of entries) {
      if (entry.busySince === undefined && at - entry.touchedAt > FORGET_AFTER_MS) entries.delete(key);
    }
  };

  const refuse = (entry: PaceEntry, reason: BotPaceRefusal, seconds: number): BotPaceVerdict => {
    const tell = !entry.told;
    entry.told = true;
    return { ok: false, reason, seconds, tell };
  };

  return {
    admit: (key, { sentAt, paired }) => {
      const at = now();
      prune(at);
      const interval = paired ? BOT_PACE_PAIRED_MS : BOT_PACE_UNPAIRED_MS;
      const seconds = interval / 1_000;
      const entry = entries.get(key);
      if (entry) {
        entry.touchedAt = at;
        if (entry.busySince !== undefined && at - entry.busySince > BUSY_MAX_MS) {
          entry.busySince = undefined;
          entry.freeSince = at - DONE_SLACK_MS;
        }
        if (!paired && (entry.busySince !== undefined || sentAt < entry.freeSince)) return refuse(entry, 'busy', seconds);
        if (sentAt - entry.lastSentAt < interval) return refuse(entry, 'tooSoon', seconds);
      }
      const next: PaceEntry = entry ?? { lastSentAt: sentAt, freeSince: 0, told: false, touchedAt: at };
      next.lastSentAt = sentAt;
      next.told = false;
      entries.set(key, next);
      if (paired) return { ok: true, done: () => {} };
      next.busySince = at;
      let finished = false;
      return {
        ok: true,
        done: () => {
          if (finished) return;
          finished = true;
          next.busySince = undefined;
          next.freeSince = now() - DONE_SLACK_MS;
        },
      };
    },
  };
}

/** The one line a sender gets when a request is not taken. */
export function botPaceNotice(strings: Record<string, string>, refusal: { reason: BotPaceRefusal; seconds: number }): string {
  return refusal.reason === 'busy'
    ? t(strings, 'bot.pace.busy')
    : t(strings, 'bot.pace.tooSoon', { seconds: String(refusal.seconds) });
}

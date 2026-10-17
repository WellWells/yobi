import { getBotRights } from '../../botPermissions/rights';
import { telegramSendLimitBytes } from '../../telegram/largeUpload';
import { NO_BOT_RIGHTS } from '../../../shared/botPermissions';
import { exceedsLimit } from '../../../shared/ytdl';
import type { SizeLimit, YtdlChoice } from '../../../shared/ytdl';
import { isBotPlatform } from '../../../shared/types';

/**
 * What the person who started the run may get from a download. Someone at the computer (the app,
 * a schedule) gets everything. A bot user without the admin grant is capped (`BOT_USER_CAP_BYTES`)
 * and never told where a file sits on this computer; an admin is told only in their own private
 * chat, since a group would read the path too.
 */
export interface YtdlAccess {
  capped: boolean;
  showPath: boolean;
}

/**
 * The most a bot user without the admin right may download, Telegram or LINE.
 * An admin has no cap of Yobi's: only what Telegram itself takes (`telegramSendLimitBytes`).
 */
export const BOT_USER_CAP_BYTES = 100_000_000;

const AT_THE_COMPUTER: YtdlAccess = { capped: false, showPath: true };

/** Read live from the config, like every other bot right: a grant taken back applies at once. */
export async function ytdlAccessFor(config: Record<string, string>): Promise<YtdlAccess> {
  const platform = (config.__triggerPlatform ?? '').trim().toLowerCase();
  if (!isBotPlatform(platform)) return AT_THE_COMPUTER;
  const userId = (config.__triggerUserId ?? '').trim();
  const chatId = (config.__triggerChatId ?? '').trim();
  const rights = await getBotRights(platform, userId, chatId).catch(() => NO_BOT_RIGHTS);
  if (!rights.admin) return { capped: true, showPath: false };
  return { capped: false, showPath: Boolean(chatId) && chatId === userId };
}

/** The largest file this person gets in a Telegram chat: their cap, and never more than the bot can send right now. */
export function telegramLimitBytes(access: YtdlAccess): number {
  const send = telegramSendLimitBytes();
  return access.capped ? Math.min(BOT_USER_CAP_BYTES, send) : send;
}

/**
 * The largest file this person gets for `destination`, all limits taken together: a capped
 * person's `BOT_USER_CAP_BYTES` (Telegram or LINE) — and for Telegram never more than the bot can
 * send right now. Over it, a capped person gets nothing (`overCap`); anyone else gets the file
 * saved on the computer only. Null = no limit (this computer, for someone at it or an admin).
 */
export function downloadLimitBytes(access: YtdlAccess, destination: 'telegram' | 'local'): SizeLimit {
  if (destination === 'telegram') return telegramLimitBytes(access);
  return access.capped ? BOT_USER_CAP_BYTES : null;
}

/** The qualities a capped person may pick: the estimate fits. An unknown size is still tried. */
export function choicesWithinCap(choices: readonly YtdlChoice[], access: YtdlAccess, limitBytes: SizeLimit): YtdlChoice[] {
  return access.capped ? choices.filter((c) => !exceedsLimit(c, limitBytes)) : [...choices];
}

/**
 * The qualities a menu lists: `listed` (from 360p up when there is any) within the cap or, when
 * none of those fits a capped person, the smaller ones from `all` that do.
 */
export function menuChoicesWithinCap(
  listed: readonly YtdlChoice[],
  all: readonly YtdlChoice[],
  access: YtdlAccess,
  limitBytes: SizeLimit,
): YtdlChoice[] {
  const fits = choicesWithinCap(listed, access, limitBytes);
  return fits.length > 0 ? fits : choicesWithinCap(all, access, limitBytes);
}

/** A capped person's file is over their limit: they get nothing. */
export function overCap(sizeBytes: number, access: YtdlAccess, limitBytes: SizeLimit): boolean {
  return access.capped && limitBytes !== null && sizeBytes > limitBytes;
}

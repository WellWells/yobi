/**
 * A group the bot is added to waits for the owner's approval: the bot does nothing there until the
 * owner allows it in settings. Being added is the moment the owner needs to hear about it, so the
 * join raises one notification per group — a busy group that re-sends its join, or a promotion
 * reported as another membership change, does not raise it again.
 */
import { sendWebNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import type { BotPlatform } from '../../shared/types';
import { isBotGroupPending } from './rights';

const PLATFORM_NAMES: Readonly<Record<BotPlatform, string>> = { telegram: 'Telegram', line: 'LINE' } as const;

const noticed = new Set<string>();

/**
 * The bot was just added to this group. Notifies the owner once, and only while the group is
 * still pending (a group allowed before, removed and added back keeps its grants). Returns
 * whether a notification went out.
 */
export function notifyBotGroupJoined(platform: BotPlatform, group: { id: string; title?: string }): boolean {
  const id = group.id.trim();
  const key = `${platform}:${id}`;
  if (!id || noticed.has(key) || !isBotGroupPending(platform, id)) return false;
  noticed.add(key);
  const strings = getLangCache();
  sendWebNotification(
    t(strings, 'bot.group.notify.title'),
    t(strings, 'bot.group.notify.body', { platform: PLATFORM_NAMES[platform], name: group.title?.trim() || id }),
    'info',
    { id: 'open-bot-settings', label: t(strings, 'bot.group.notify.action') },
  );
  return true;
}

export function __resetGroupJoinNotices(): void {
  noticed.clear();
}

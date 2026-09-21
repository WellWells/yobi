import type { Bot } from 'grammy';
import type { TelegramContext } from './commands';
import {
  reachabilityFromStatus,
  type BotContactInput,
  type BotContactKind,
  type BotReachability,
} from '../botDirectory';

export interface PresenceEvent {
  contact: BotContactInput;
  reachability: BotReachability;
}

export interface PresenceOptions {
  onPresence: (event: PresenceEvent) => void;
  onLog: (message: string) => void;
}

/**
 * my_chat_member is the only push Telegram gives about reachability: it fires when a user blocks or
 * unblocks the bot in a private chat, and when the bot is added to or thrown out of a group or
 * channel. Catching it here means a dead recipient is known before the next send fails, and a user
 * who unblocks is picked back up without anyone touching the settings page.
 */
export function attachPresenceTracking(bot: Bot<TelegramContext>, options: PresenceOptions): void {
  bot.on('my_chat_member', (ctx, next) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const status = update.new_chat_member.status;
    const kind: BotContactKind = chat.type === 'private' ? 'user' : 'chat';
    const reachability = reachabilityFromStatus(kind, status);

    const contact: BotContactInput = chat.type === 'private'
      ? {
        platform: 'telegram',
        kind: 'user',
        id: String(chat.id),
        ...(chat.username ? { username: chat.username } : {}),
        ...(chat.first_name ? { firstName: chat.first_name } : {}),
        ...(chat.last_name ? { lastName: chat.last_name } : {}),
      }
      : {
        platform: 'telegram',
        kind: 'chat',
        id: String(chat.id),
        ...(chat.title ? { title: chat.title } : {}),
        ...('username' in chat && chat.username ? { username: chat.username } : {}),
        chatType: chat.type,
      };

    options.onPresence({ contact, reachability });
    if (reachability !== 'ok') {
      const label = chat.type === 'private'
        ? `user ${chat.id}`
        : `${chat.type} "${chat.title}"`;
      options.onLog(`[telegram] ${label} is now ${reachability} (status: ${status})`);
    }
    return next();
  });
}

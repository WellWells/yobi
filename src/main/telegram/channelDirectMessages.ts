import type { Bot } from 'grammy';
import type { TelegramContext } from './commands';

/**
 * A channel with direct messages turned on gets a companion chat for them: a supergroup flagged
 * `is_direct_messages`, titled like the channel, that Telegram adds the channel's admin bot to by
 * itself. It is part of the channel, not a group anyone added the bot to.
 */
export function isChannelDirectMessages(chat: unknown): boolean {
  if (!chat || typeof chat !== 'object') return false;
  const { type, is_direct_messages: direct } = chat as Record<string, unknown>;
  return type === 'supergroup' && direct === true;
}

export interface ChannelDirectMessagesOptions {
  /** First update from such a chat this run: drop whatever was recorded for it as a group. */
  onFirstSeen: (chatId: number) => void;
  onLog: (message: string) => void;
}

/**
 * Registered before every other handler, so a channel's direct-messages chat never reaches
 * presence tracking (the join notice and approval card), channel discovery or the pending-group
 * gate — none of which would otherwise tell it from a group.
 */
export function attachChannelDirectMessagesFilter(bot: Bot<TelegramContext>, options: ChannelDirectMessagesOptions): void {
  const seen = new Set<number>();
  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    if (!chat || !isChannelDirectMessages(chat)) return next();
    if (!seen.has(chat.id)) {
      seen.add(chat.id);
      options.onLog(`[telegram] chat ${chat.id} is a channel's direct messages, not a group — its updates are ignored`);
      options.onFirstSeen(chat.id);
    }
  });
}

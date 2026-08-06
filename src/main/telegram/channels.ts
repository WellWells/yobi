import type { Bot } from 'grammy';
import type { TelegramChannel } from '../../shared/types';
import type { TelegramContext } from './commands';

/**
 * A `my_chat_member` update flattened into the fields channel discovery cares about.
 * Exported for the test suite.
 */
export interface ChannelMemberEvent {
  chatId: number;
  chatType: string;
  title: string;
  username?: string;
  status: string;
  canPostMessages?: boolean;
  fromUserId: number;
}

export type ChannelChange = 'added' | 'updated' | 'lost' | 'ignored';

export interface ChannelReduceResult {
  next: TelegramChannel[];
  change: ChannelChange;
  channel?: TelegramChannel;
}

function canPublish(event: ChannelMemberEvent): boolean {
  if (event.status === 'creator') return true;
  if (event.status !== 'administrator') return false;
  // Telegram omits can_post_messages on some payloads; only an explicit false revokes posting.
  return event.canPostMessages !== false;
}

/**
 * Pure reducer for channel discovery. Exported for the test suite.
 *
 * Channels are never dropped on demotion — a flow may already reference the chat id, so a lost
 * channel stays in the list flagged `canPost: false` and is only removed when the user forgets it.
 */
export function reduceChannelState(
  channels: TelegramChannel[],
  event: ChannelMemberEvent,
  isPairedUser: (userId: number) => boolean,
  now: string,
): ChannelReduceResult {
  if (event.chatType !== 'channel') return { next: channels, change: 'ignored' };
  if (!Number.isFinite(event.chatId) || event.chatId === 0) return { next: channels, change: 'ignored' };

  const index = channels.findIndex((item) => item.chatId === event.chatId);
  const existing = index >= 0 ? channels[index] : undefined;

  // Anyone can add a bot to their own channel; only accept promotions performed by a paired user.
  if (!isPairedUser(event.fromUserId)) return { next: channels, change: 'ignored' };

  const username = event.username?.replace(/^@/, '').trim() ?? '';
  const title = event.title.trim();

  if (canPublish(event)) {
    const channel: TelegramChannel = {
      chatId: event.chatId,
      title: title || existing?.title || '',
      ...(username ? { username } : {}),
      canPost: true,
      discoveredAt: existing?.discoveredAt ?? now,
    };
    const next = [...channels];
    if (existing) next[index] = channel; else next.push(channel);
    return { next, change: existing ? 'updated' : 'added', channel };
  }

  if (!existing) return { next: channels, change: 'ignored' };

  const channel: TelegramChannel = {
    ...existing,
    title: title || existing.title,
    ...(username ? { username } : {}),
    canPost: false,
    lostAt: existing.lostAt ?? now,
  };
  const next = [...channels];
  next[index] = channel;
  return { next, change: 'lost', channel };
}

export function forgetChannel(channels: TelegramChannel[], chatId: number): TelegramChannel[] {
  return channels.filter((item) => item.chatId !== chatId);
}

export interface ChannelDiscoveryOptions {
  isPairedUser: (userId: number) => boolean;
  getChannels: () => TelegramChannel[];
  saveChannels: (next: TelegramChannel[]) => void;
  onLog: (message: string) => void;
}

export function attachChannelDiscovery(
  bot: Bot<TelegramContext>,
  options: ChannelDiscoveryOptions,
): void {
  bot.on('my_chat_member', (ctx, next) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    if (chat.type !== 'channel') return next();

    const member = update.new_chat_member;
    const event: ChannelMemberEvent = {
      chatId: chat.id,
      chatType: chat.type,
      title: chat.title,
      username: chat.username,
      status: member.status,
      canPostMessages: 'can_post_messages' in member ? member.can_post_messages : undefined,
      fromUserId: update.from.id,
    };

    const label = event.title || `chat ${event.chatId}`;
    if (!options.isPairedUser(event.fromUserId)) {
      options.onLog(
        `[telegram] channel "${label}" change by unpaired user ${event.fromUserId} — ignored (pair that account first)`,
      );
      return next();
    }

    const result = reduceChannelState(
      options.getChannels(),
      event,
      options.isPairedUser,
      new Date().toISOString(),
    );
    if (result.change === 'ignored') return next();

    options.saveChannels(result.next);
    if (result.change === 'lost') {
      options.onLog(`[telegram] channel "${label}" can no longer be posted to (status: ${event.status})`);
    } else {
      options.onLog(`[telegram] channel "${label}" ${result.change} (${event.chatId})`);
    }
    return next();
  });
}

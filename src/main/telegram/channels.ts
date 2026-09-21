import type { Bot } from 'grammy';
import type { TelegramChannel, TelegramChatKind } from '../../shared/types';
import type { TelegramContext } from './commands';
import { canPostFromMember } from './directory';

export interface ChannelMemberEvent {
  chatId: number;
  chatType: string;
  title: string;
  username?: string;
  status: string;
  canPostMessages?: boolean;
  isMember?: boolean;
  fromUserId: number;
}

export type ChannelChange = 'added' | 'updated' | 'lost' | 'ignored';

export interface ChannelReduceResult {
  next: TelegramChannel[];
  change: ChannelChange;
  channel?: TelegramChannel;
}

function asChatKind(chatType: string): TelegramChatKind | null {
  if (chatType === 'channel' || chatType === 'group' || chatType === 'supergroup') return chatType;
  return null;
}

function canPublish(kind: TelegramChatKind, event: ChannelMemberEvent): boolean {
  return canPostFromMember(kind, {
    status: event.status,
    ...(event.canPostMessages === undefined ? {} : { canPostMessages: event.canPostMessages }),
    ...(event.isMember === undefined ? {} : { isMember: event.isMember }),
  });
}

export function reduceChannelState(
  channels: TelegramChannel[],
  event: ChannelMemberEvent,
  isPairedUser: (userId: number) => boolean,
  now: string,
): ChannelReduceResult {
  const kind = asChatKind(event.chatType);
  if (!kind) return { next: channels, change: 'ignored' };
  if (!Number.isFinite(event.chatId) || event.chatId === 0) return { next: channels, change: 'ignored' };

  const index = channels.findIndex((item) => item.chatId === event.chatId);
  const existing = index >= 0 ? channels[index] : undefined;

  if (!isPairedUser(event.fromUserId)) return { next: channels, change: 'ignored' };

  const username = event.username?.replace(/^@/, '').trim() ?? '';
  const title = event.title.trim();

  if (canPublish(kind, event)) {
    const channel: TelegramChannel = {
      chatId: event.chatId,
      title: title || existing?.title || '',
      ...(username ? { username } : {}),
      chatType: kind,
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
    chatType: kind,
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
    if (chat.type === 'private') return next();

    const member = update.new_chat_member;
    const event: ChannelMemberEvent = {
      chatId: chat.id,
      chatType: chat.type,
      title: chat.title,
      username: 'username' in chat ? chat.username : undefined,
      status: member.status,
      canPostMessages: 'can_post_messages' in member ? member.can_post_messages : undefined,
      isMember: 'is_member' in member ? member.is_member : undefined,
      fromUserId: update.from.id,
    };

    const label = event.title || `chat ${event.chatId}`;
    if (!options.isPairedUser(event.fromUserId)) {
      options.onLog(
        `[telegram] ${chat.type} "${label}" change by unpaired user ${event.fromUserId} — ignored (pair that account first)`,
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
      options.onLog(`[telegram] ${chat.type} "${label}" can no longer be posted to (status: ${event.status})`);
    } else {
      options.onLog(`[telegram] ${chat.type} "${label}" ${result.change} (${event.chatId})`);
    }
    return next();
  });
}

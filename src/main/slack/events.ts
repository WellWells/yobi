import type { BotChatEvent } from '../botChat/types';

/**
 * A typed line, filed like every platform's: a DM under the person's own id, a channel under the
 * channel's id. `channel` is where answers go; in a channel they go into the asking message's
 * thread (`threadTs`), as people answer in Slack.
 */
export interface SlackTextEvent extends BotChatEvent {
  channel: string;
  /** The message itself; absent for a button press. */
  ts?: string;
  /** The thread an answer goes into, in a channel. */
  threadTs?: string;
  hasFiles?: boolean;
}

interface RawEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: unknown[];
}

/** A Slack `ts` ("1700000000.123456") in milliseconds. */
export function slackTime(ts: string | undefined): number | undefined {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : undefined;
}

function mentionPattern(botUserId: string): RegExp {
  return new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, 'g');
}

/**
 * The events the app subscribes to: `message` in a DM (`message.im`) and `app_mention` in a
 * channel. Edits, joins, bot posts and the app's own messages are not someone talking to it; a
 * message with files keeps its text (the files themselves cannot be read).
 */
export function parseSlackEvent(raw: unknown, botUserId: string, retried: boolean): SlackTextEvent | null {
  const event = (raw ?? {}) as RawEvent;
  if (!event.user || event.bot_id || !event.channel || !event.ts) return null;
  if (event.user === botUserId) return null;
  if (event.subtype && event.subtype !== 'file_share' && event.subtype !== 'thread_broadcast') return null;
  const isDm = event.type === 'message' && event.channel_type === 'im';
  const isMention = event.type === 'app_mention';
  if (!isDm && !isMention) return null;
  const content = event.text ?? '';
  const text = (botUserId ? content.replace(mentionPattern(botUserId), ' ') : content).replace(/[ \t]+\n/g, '\n').trim();
  const sentAt = slackTime(event.ts);
  return {
    userId: event.user,
    chatId: isDm ? event.user : event.channel,
    chatKind: isDm ? 'user' : 'group',
    channel: event.channel,
    ts: event.ts,
    ...(isDm ? {} : { threadTs: event.thread_ts ?? event.ts }),
    text: decodeSlackText(text),
    mentionsBot: isMention,
    ...(sentAt !== undefined ? { sentAt } : {}),
    ...(retried ? { redelivered: true as const } : {}),
    ...((event.files?.length ?? 0) > 0 ? { hasFiles: true } : {}),
  };
}

/**
 * What the person typed, as text: Slack writes `&`, `<` and `>` as entities and wraps links as
 * `<url>` or `<url|label>`; a link becomes its address, so a pasted link reaches the downloader as
 * one, and other mentions keep their label.
 */
export function decodeSlackText(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g, '$1')
    .replace(/<mailto:([^|>]+)(?:\|[^>]*)?>/g, '$1')
    .replace(/<[@#!][^|>]*\|([^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export interface SlackButtonPress {
  actionId: string;
  userId: string;
  channel: string;
  /** The message the button is on. */
  messageTs?: string;
  /** The thread that message is in (or the message itself, in a channel). */
  threadTs?: string;
}

interface RawAction {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string; thread_ts?: string };
  message?: { ts?: string; thread_ts?: string };
  actions?: Array<{ action_id?: string }>;
}

/** A press on one of the bot's buttons (`block_actions`); null for anything else. */
export function parseSlackButtonPress(raw: unknown): SlackButtonPress | null {
  const payload = (raw ?? {}) as RawAction;
  if (payload.type !== 'block_actions') return null;
  const actionId = payload.actions?.[0]?.action_id ?? '';
  const userId = payload.user?.id ?? '';
  const channel = payload.channel?.id ?? payload.container?.channel_id ?? '';
  if (!actionId || !userId || !channel) return null;
  const messageTs = payload.message?.ts ?? payload.container?.message_ts;
  const threadTs = payload.message?.thread_ts ?? payload.container?.thread_ts;
  return { actionId, userId, channel, ...(messageTs ? { messageTs } : {}), ...(threadTs ? { threadTs } : {}) };
}

/** A DM's channel id starts with D. */
export function isSlackDm(channel: string): boolean {
  return channel.startsWith('D');
}

/** A press as the typed line it stands for, in the chat it was pressed in. */
export function slackPressEvent(press: SlackButtonPress, text: string): SlackTextEvent {
  const dm = isSlackDm(press.channel);
  return {
    userId: press.userId,
    chatId: dm ? press.userId : press.channel,
    chatKind: dm ? 'user' : 'group',
    channel: press.channel,
    ...(dm ? {} : { threadTs: press.threadTs ?? press.messageTs }),
    text,
    mentionsBot: true,
    sentAt: Date.now(),
  };
}

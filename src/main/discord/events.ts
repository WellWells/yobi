import type { BotChatEvent } from '../botChat/types';

/** Discord's epoch (2015-01-01): a snowflake's top bits count milliseconds from it. */
const DISCORD_EPOCH_MS = 1_420_070_400_000;

/** When a snowflake was made (ms since 1970); undefined for anything that is not one. */
export function snowflakeTime(id: string): number | undefined {
  if (!/^\d{15,21}$/.test(id)) return undefined;
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
}

/**
 * A typed line, filed the way every platform files chats: a DM under the person's own id (so the
 * private-chat rules — memory, admin, local tools — read it as private), a server channel under the
 * channel's id. `channelId` is where answers go either way.
 */
export interface DiscordTextEvent extends BotChatEvent {
  channelId: string;
  /** The message itself, quoted by the answer; absent for a button press. */
  messageId?: string;
  guildId?: string;
  /** The server nickname, else the display name, else the username. */
  displayName?: string;
  /** The message also carried files, which the bot cannot read. */
  hasAttachments?: boolean;
}

interface RawAuthor {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
}

interface RawMessage {
  id?: string;
  type?: number;
  channel_id?: string;
  guild_id?: string;
  content?: string;
  author?: RawAuthor;
  member?: { nick?: string | null };
  mentions?: Array<{ id?: string }>;
  webhook_id?: string;
  attachments?: unknown[];
}

/** Ordinary messages and replies; joins, pins and the rest are not someone talking to the bot. */
const TALK_TYPES: ReadonlySet<number> = new Set([0, 19]);

function mentionPattern(botId: string): RegExp {
  return new RegExp(`<@!?${botId}>`, 'g');
}

export function parseDiscordMessage(raw: unknown, botId: string): DiscordTextEvent | null {
  const message = (raw ?? {}) as RawMessage;
  const author = message.author;
  if (!author?.id || author.bot || message.webhook_id || !message.id || !message.channel_id) return null;
  if (!TALK_TYPES.has(message.type ?? 0)) return null;
  const content = typeof message.content === 'string' ? message.content : '';
  const guildId = message.guild_id;
  const mentionsBot = Boolean(botId) && (
    (message.mentions ?? []).some((user) => user.id === botId) || mentionPattern(botId).test(content)
  );
  const text = botId ? content.replace(mentionPattern(botId), ' ').replace(/\s+\n/g, '\n').trim() : content.trim();
  const displayName = message.member?.nick || author.global_name || author.username || undefined;
  const sentAt = snowflakeTime(message.id);
  return {
    userId: author.id,
    chatId: guildId ? message.channel_id : author.id,
    chatKind: guildId ? 'group' : 'user',
    channelId: message.channel_id,
    messageId: message.id,
    text,
    mentionsBot,
    ...(guildId ? { guildId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(sentAt !== undefined ? { sentAt } : {}),
    ...((message.attachments?.length ?? 0) > 0 ? { hasAttachments: true } : {}),
  };
}

export interface DiscordButtonPress {
  interactionId: string;
  interactionToken: string;
  customId: string;
  userId: string;
  channelId: string;
  guildId?: string;
  /** The message the button is on. */
  messageId?: string;
  displayName?: string;
}

interface RawInteraction {
  id?: string;
  token?: string;
  type?: number;
  channel_id?: string;
  guild_id?: string;
  data?: { custom_id?: string; component_type?: number };
  member?: { nick?: string | null; user?: RawAuthor };
  user?: RawAuthor;
  message?: { id?: string };
}

/** A press on one of the bot's buttons (an interaction of type 3); null for anything else. */
export function parseDiscordButtonPress(raw: unknown): DiscordButtonPress | null {
  const interaction = (raw ?? {}) as RawInteraction;
  if (interaction.type !== 3 || interaction.data?.component_type !== 2) return null;
  const user = interaction.member?.user ?? interaction.user;
  const customId = interaction.data.custom_id ?? '';
  if (!interaction.id || !interaction.token || !interaction.channel_id || !user?.id || !customId) return null;
  const displayName = interaction.member?.nick || user.global_name || user.username || undefined;
  return {
    interactionId: interaction.id,
    interactionToken: interaction.token,
    customId,
    userId: user.id,
    channelId: interaction.channel_id,
    ...(interaction.guild_id ? { guildId: interaction.guild_id } : {}),
    ...(interaction.message?.id ? { messageId: interaction.message.id } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

/** A press as the typed line it stands for, in the chat it was pressed in. */
export function buttonPressEvent(press: DiscordButtonPress, text: string): DiscordTextEvent {
  return {
    userId: press.userId,
    chatId: press.guildId ? press.channelId : press.userId,
    chatKind: press.guildId ? 'group' : 'user',
    channelId: press.channelId,
    text,
    mentionsBot: true,
    sentAt: Date.now(),
    ...(press.guildId ? { guildId: press.guildId } : {}),
    // The pressed message stands in for the asking one: what the press starts quotes it.
    ...(press.messageId ? { messageId: press.messageId } : {}),
    ...(press.displayName ? { displayName: press.displayName } : {}),
  };
}

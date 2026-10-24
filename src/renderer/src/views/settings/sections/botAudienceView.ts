/**
 * What the settings page shows for a bot's groups and the people who used it, derived from the
 * same capability table main decides with (`shared/botCapabilities.ts`): a group's menu offers
 * exactly what a group may grant. Pure: no React, no IPC.
 */
import { GROUP_CAPABILITIES } from '../../../../../shared/botCapabilities';
import { PUBLIC_DATA_CONNECTOR_IDS } from '../../../../../shared/builtinConnectors';
import { CONNECTOR_GRANT_PREFIX, PRESELECTED_GROUP_GRANTS, connectorGrant, normalizeGroupGrantList } from '../../../../../shared/botPermissions';
import type { BotGroupGrant } from '../../../../../shared/botPermissions';
import type { BotAudienceGroup, BotAudienceUser, BotContact, BotReachability, TelegramChannel } from '../../../../../shared/types';
import type { BotConnectorOption } from './botPermissionsView';

type Translate = (key: string) => string;

/**
 * One channel or group the bot is in, listed once: the Telegram recipient entry (forgettable)
 * and the group's approval with its grants are the same chat, so they share a row.
 */
export interface BotChatRow {
  id: string;
  /** Unset for an old recipient entry saved before the chat type was recorded. */
  kind?: 'channel' | 'group';
  title: string;
  username?: string;
  /** The flow-recipient entry (Telegram only); its row can be removed from the list. */
  channel?: TelegramChannel;
  /** The group's approval and grants; absent for a channel. */
  group?: BotAudienceGroup;
  /** Set when Telegram refused the last send or the bot was removed. */
  unreachable?: Exclude<BotReachability, 'ok'>;
}

/**
 * Channels first (they have no permissions, only a recipient entry), then the groups in the
 * order main lists them, then recipient groups the directory no longer lists as a group.
 */
export function mergeBotChats(
  groups: readonly BotAudienceGroup[],
  channels: readonly TelegramChannel[],
  contacts: readonly BotContact[] = [],
): BotChatRow[] {
  const byId = new Map(channels.map((channel) => [String(channel.chatId), channel]));
  const reachOf = (id: string, fallback?: BotReachability): BotChatRow['unreachable'] => {
    const reach = contacts.find((entry) => entry.kind === 'chat' && entry.id === id)?.reachability ?? fallback;
    return reach && reach !== 'ok' ? reach : undefined;
  };
  const kindOf = (channel: TelegramChannel | undefined, group: BotAudienceGroup | undefined): BotChatRow['kind'] => {
    if (channel?.chatType === 'channel') return 'channel';
    return group || channel?.chatType ? 'group' : undefined;
  };
  const row = (id: string, channel: TelegramChannel | undefined, group: BotAudienceGroup | undefined): BotChatRow => {
    const unreachable = reachOf(id, group?.reachability);
    const kind = kindOf(channel, group);
    return {
      id,
      ...(kind ? { kind } : {}),
      title: group?.title || channel?.title || '',
      ...(channel?.username ? { username: channel.username } : {}),
      ...(channel ? { channel } : {}),
      ...(group ? { group } : {}),
      ...(unreachable ? { unreachable } : {}),
    };
  };
  const seen = new Set<string>();
  const rows: BotChatRow[] = [];
  for (const channel of channels) {
    if (channel.chatType !== 'channel') continue;
    const id = String(channel.chatId);
    seen.add(id);
    rows.push(row(id, channel, undefined));
  }
  for (const group of groups) {
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    rows.push(row(group.id, byId.get(group.id), group));
  }
  for (const channel of channels) {
    const id = String(channel.chatId);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row(id, channel, undefined));
  }
  return rows;
}

/**
 * Two hint sentences as one paragraph. English needs a space between them; a sentence that ends in
 * full-width punctuation (zh) already separates itself, and a space there shows as a stray gap.
 */
export function joinSentences(first: string, second: string): string {
  if (!second) return first;
  return /[。！？」）]$/.test(first) ? `${first}${second}` : `${first} ${second}`;
}

/** A chat's name; the numeric id is an implementation detail and never shown. */
export function chatName(row: BotChatRow, t: Translate): string {
  if (row.title) return row.title;
  if (row.username) return `@${row.username}`;
  return t('settings.bot.chat.untitled');
}

/** The line under a chat's name: its @username (when the name is not already it) and whether flows can post there. */
export function chatDetail(row: BotChatRow, t: Translate): string {
  const parts: string[] = [];
  if (row.username && row.title) parts.push(`@${row.username}`);
  if (row.channel) parts.push(t(row.channel.canPost ? 'settings.telegram.channels.active' : 'settings.telegram.channels.lost'));
  return parts.join(' · ');
}

export interface GroupGrantItem {
  grant: BotGroupGrant;
  label: string;
  description: string;
}

export function groupGrantItem(grant: BotGroupGrant, connectors: readonly BotConnectorOption[], t: Translate): GroupGrantItem {
  switch (grant) {
    case 'chat':
      return { grant, label: t('settings.bot.group.grant.chat'), description: t('settings.bot.group.grant.chat.desc') };
    case 'web':
      return { grant, label: t('settings.bot.perm.grant.web'), description: t('settings.bot.group.grant.web.desc') };
    case 'download':
      return { grant, label: t('settings.bot.perm.grant.download'), description: t('settings.bot.perm.grant.download.desc') };
    default: {
      const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
      const known = connectors.find((option) => option.id === id);
      return {
        grant,
        label: known ? known.name : t('settings.bot.perm.grant.missingConnector'),
        description: t('settings.bot.group.grant.connector.desc'),
      };
    }
  }
}

/** The chips of a group's grants, in the order the table lists them. */
export function groupGrantChips(grants: readonly BotGroupGrant[], connectors: readonly BotConnectorOption[], t: Translate): GroupGrantItem[] {
  return normalizeGroupGrantList(grants).map((grant) => groupGrantItem(grant, connectors, t));
}

/** What a group's "+" menu offers: what a group may grant, minus what it has; connectors only when switched on. */
export function groupGrantMenu(grants: readonly BotGroupGrant[], connectors: readonly BotConnectorOption[], t: Translate): GroupGrantItem[] {
  const has = new Set(grants);
  const candidates: BotGroupGrant[] = [
    ...GROUP_CAPABILITIES,
    ...PUBLIC_DATA_CONNECTOR_IDS.filter((id) => connectors.some((option) => option.id === id)).map(connectorGrant),
  ];
  return candidates.filter((grant) => !has.has(grant)).map((grant) => groupGrantItem(grant, connectors, t));
}

/** What "Allow" writes for a pending group: the table's preselected rows, editable afterwards. */
export function allowGroupGrants(): BotGroupGrant[] {
  return [...PRESELECTED_GROUP_GRANTS];
}

export function addGroupGrant(grants: readonly BotGroupGrant[], grant: BotGroupGrant): BotGroupGrant[] {
  return normalizeGroupGrantList([...grants, grant]);
}

export function removeGroupGrant(grants: readonly BotGroupGrant[], grant: BotGroupGrant): BotGroupGrant[] {
  return normalizeGroupGrantList(grants.filter((g) => g !== grant));
}

/**
 * The account id under someone asking to use the bot: their name is whatever they typed, so the
 * id is what tells two people with one name apart. Not repeated when the name already is the id.
 */
export function requestId(user: BotAudienceUser): string {
  if (!user.requested || user.name === `ID ${user.id}`) return '';
  return `ID ${user.id}`;
}

/** Where someone last used the bot: the group's name, or "private chat". */
export function userWhere(user: BotAudienceUser, t: Translate): string {
  return user.where || t('settings.bot.users.private');
}

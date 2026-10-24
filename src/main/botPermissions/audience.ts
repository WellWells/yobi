/**
 * What the settings page lists under a bot: the groups it is in (each pending the owner's approval,
 * or with what it grants everyone in it) and the unpaired people who addressed it, most recent
 * first — the list the owner blocks from. Built purely from the contact directory and the config.
 */
import { listBotContacts } from '../botDirectory';
import { config } from '../config';
import { groupGrantsOf } from '../../shared/botPermissions';
import type { BotGroupGrant } from '../../shared/botPermissions';
import type { BotAudienceSnapshot, BotAudienceUser, BotContact, BotPlatform } from '../../shared/types';
import { pairedBotUserIds } from './rights';
import { isPairingRequestWaiting } from './pairingRequests';

export const MAX_AUDIENCE_USERS = 200;

export interface AudienceSource {
  contacts: readonly BotContact[];
  groupPermissions: Readonly<Record<string, BotGroupGrant[]>>;
  blockedUsers: readonly string[];
  pairedIds: readonly string[];
}

function personName(contact: BotContact | undefined, id: string): string {
  const full = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ');
  if (full) return full;
  return contact?.username ? `@${contact.username}` : `ID ${id}`;
}

export function buildBotAudience(source: AudienceSource): BotAudienceSnapshot {
  const chats = source.contacts.filter((c) => c.kind === 'chat');
  const groups = chats
    .filter((c) => c.chatType !== 'channel' && c.reachability !== 'removed')
    .map((c) => {
      const grants = groupGrantsOf(source.groupPermissions, c.id);
      return {
        id: c.id,
        ...(c.title ? { title: c.title } : {}),
        reachability: c.reachability,
        grants: grants ?? [],
        pending: grants === null,
      };
    })
    .sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id));

  const blocked = new Set(source.blockedUsers);
  const paired = new Set(source.pairedIds);
  const people = new Map(source.contacts.filter((c) => c.kind === 'user').map((c) => [c.id, c]));
  const titleOf = (chatId: string): string => chats.find((c) => c.id === chatId)?.title ?? chatId;
  const ids = new Set<string>([
    ...[...people.values()].filter((c) => c.lastUsedAt || c.pairingRequestedAt).map((c) => c.id),
    ...blocked,
  ]);
  const users: BotAudienceUser[] = [...ids]
    .filter((id) => !paired.has(id))
    .map((id) => {
      const contact = people.get(id);
      const chatId = contact?.lastUsedChatId ?? id;
      const requested = isPairingRequestWaiting(contact, { paired: false, blocked: blocked.has(id) });
      return {
        id,
        name: personName(contact, id),
        ...(contact?.username ? { username: contact.username } : {}),
        lastUsedAt: contact?.lastUsedAt ?? contact?.pairingRequestedAt ?? '',
        useCount: contact?.useCount ?? 0,
        where: chatId === id ? '' : titleOf(chatId),
        blocked: blocked.has(id),
        ...(requested ? { requested: true as const } : {}),
      };
    })
    .sort((a, b) => Number(Boolean(b.requested)) - Number(Boolean(a.requested)) || b.lastUsedAt.localeCompare(a.lastUsedAt));
  // Requests first, then the newest; a blocked person is never dropped off the end, or they could
  // not be unblocked.
  const kept = users.filter((u, index) => index < MAX_AUDIENCE_USERS || u.blocked);
  return { groups, users: kept };
}

export async function getBotAudience(platform: BotPlatform): Promise<BotAudienceSnapshot> {
  const target = config[platform];
  return buildBotAudience({
    contacts: await listBotContacts({ platform }),
    groupPermissions: target?.groupPermissions ?? {},
    blockedUsers: target?.blockedUsers ?? [],
    pairedIds: pairedBotUserIds(platform),
  });
}

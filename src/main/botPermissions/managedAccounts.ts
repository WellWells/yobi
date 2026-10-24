/**
 * What the account cards read, for either platform: the waiting requests (newest first) and the
 * paired accounts, each with its state, grants and the "me" mark — from the config, the contact
 * directory and the memory file as they are now. The platform says who is paired and what it
 * calls them; everything else is the same on both.
 */
import type { BotContact, BotPlatform } from '../../shared/types';
import { BUILTIN_CONNECTORS } from '../../shared/builtinConnectors';
import { findBotContact, listBotContacts } from '../botDirectory';
import { config } from '../config';
import { isBotSelfAccount } from '../memory/memoryContext';
import { loadUserMemoryChecked } from '../memory/memoryStore';
import type { UserMemoryState } from '../memory/memoryState';
import type { ManagedAccount } from './accountAdminPlan';
import { isPairingRequestWaiting } from './pairingRequests';
import { getBotGrants, isBotGroupPending, isBotUserBlocked } from './rights';

/** Whether a built-in connector is switched on in this app (a card offers an off one only to take it away). */
export function isBuiltinConnectorOn(serverId: string): boolean {
  const builtin = BUILTIN_CONNECTORS.find((entry) => entry.id === serverId);
  return Boolean(builtin && config[builtin.flag]);
}

/** One paired account as the platform's own pairing list names it. */
export interface PairedAccountInfo {
  id: string;
  name: string;
  username?: string;
}

export interface ManagedAccountSource {
  platform: BotPlatform;
  /** The accounts paired right now, read on every call. */
  paired: () => readonly PairedAccountInfo[];
  /** Whether an id has the platform's shape; anything else is not an account. */
  isUserId: (id: string) => boolean;
}

function nameOf(contact: Pick<BotContact, 'firstName' | 'lastName'> | undefined): string {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ');
}

/** An allowed group where this person used the bot (a pending group's talk never reaches anyone). */
async function usedIn(platform: BotPlatform, contact: BotContact | undefined): Promise<ManagedAccount['usedIn']> {
  const chatId = contact?.lastUsedChatId;
  if (!contact || !chatId || chatId === contact.id || isBotGroupPending(platform, chatId)) return undefined;
  const group = await findBotContact(platform, 'chat', chatId);
  return { group: group?.title || chatId, count: contact.useCount ?? 0 };
}

function pairedAccount(
  platform: BotPlatform,
  info: PairedAccountInfo,
  contact: BotContact | undefined,
  memory: UserMemoryState | null,
): ManagedAccount {
  const grants = getBotGrants(platform, info.id);
  const username = contact?.username ?? info.username;
  return {
    id: info.id,
    name: nameOf(contact) || info.name,
    ...(username ? { username } : {}),
    state: 'paired',
    owner: memory ? isBotSelfAccount(memory, platform, info.id) : false,
    // Without the memory file nobody can tell which account is the owner's.
    ...(memory ? {} : { ownerUnknown: true }),
    admin: grants.includes('admin'),
    grants,
  };
}

async function accountOf(source: ManagedAccountSource, id: string, memory: UserMemoryState | null): Promise<ManagedAccount | null> {
  if (!source.isUserId(id)) return null;
  const { platform } = source;
  const contact = await findBotContact(platform, 'user', id);
  const paired = source.paired().find((entry) => entry.id === id);
  if (paired) return pairedAccount(platform, paired, contact, memory);
  const blocked = isBotUserBlocked(platform, id);
  if (!contact && !blocked) return null;
  const waiting = isPairingRequestWaiting(contact, { paired: false, blocked });
  const used = waiting ? await usedIn(platform, contact) : undefined;
  return {
    id,
    name: nameOf(contact),
    ...(contact?.username ? { username: contact.username } : {}),
    state: blocked ? 'blocked' : waiting ? 'requested' : 'none',
    owner: false,
    admin: false,
    grants: [],
    ...(used ? { usedIn: used } : {}),
  };
}

/** The memory file, or null when it exists but cannot be read — then no account is the owner's for sure. */
async function readMemory(): Promise<UserMemoryState | null> {
  try {
    const loaded = await loadUserMemoryChecked();
    return loaded.trusted ? loaded.state : null;
  } catch {
    return null;
  }
}

/**
 * Paired accounts in pairing order, then waiting requests (newest first): a flood of throwaway
 * requests must not push the paired accounts off a capped list.
 */
export async function listManagedAccounts(source: ManagedAccountSource): Promise<ManagedAccount[]> {
  const { platform } = source;
  const memory = await readMemory();
  const paired = source.paired();
  const pairedIds = new Set(paired.map((entry) => entry.id));
  const contacts = await listBotContacts({ platform, kind: 'user' });
  const requested = contacts
    .filter((c) => isPairingRequestWaiting(c, { paired: pairedIds.has(c.id), blocked: isBotUserBlocked(platform, c.id) }))
    .sort((a, b) => (b.pairingRequestedAt ?? '').localeCompare(a.pairingRequestedAt ?? ''));
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return [
    ...paired.map((info) => pairedAccount(platform, info, byId.get(info.id), memory)),
    ...(await Promise.all(requested.map((c) => accountOf(source, c.id, memory)))).filter((a): a is ManagedAccount => a !== null),
  ];
}

/** One account as it is now; null = an id the bot knows nothing of, or not an id at all. */
export async function findManagedAccount(source: ManagedAccountSource, id: string): Promise<ManagedAccount | null> {
  return accountOf(source, id, await readMemory());
}

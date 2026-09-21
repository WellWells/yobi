import type { TelegramChannel, TelegramKnownUser, TelegramPairingState } from '../../shared/types';
import type { BotContactInput } from '../botDirectory';

export type DirectoryChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface ResolvedIdentity {
  chatId: number;
  type: DirectoryChatType;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface ResolvedMember {
  status: string;
  canPostMessages?: boolean;
  isMember?: boolean;
}

export interface DirectoryApi {
  getChat: (chatId: number) => Promise<unknown>;
  getChatMember: (chatId: number, userId: number) => Promise<unknown>;
}

export interface DirectoryCandidates {
  chatIds: number[];
  userIds: number[];
  previouslyPairedUserIds: number[];
}

export interface DirectorySources {
  channels: TelegramChannel[];
  pairedUserIds: number[];
  adminUserIds: number[];
  flowRecipientIds: number[];
  conversationUserIds: number[];
  ledgerChatIds: number[];
  ledgerPairedUserIds: number[];
}

/**
 * Two sources count as proof of a prior pairing: the contact directory, which records the grant at
 * the moment it happens, and — for installs that predate it — bot-conversations.json, whose keys are
 * only written after handleDirectMessage has cleared isPairedUser. That is the line this module
 * draws: an id seen in either may be re-authorized, an id merely sitting in a flow recipient list may
 * not — it only earns a display name.
 */
export function collectDirectoryCandidates(sources: DirectorySources): DirectoryCandidates {
  const chatIds = new Set<number>();
  const userIds = new Set<number>();

  const add = (raw: number): void => {
    if (!Number.isFinite(raw) || raw === 0) return;
    if (raw < 0) chatIds.add(raw); else userIds.add(raw);
  };

  for (const channel of sources.channels) add(channel.chatId);
  for (const id of sources.pairedUserIds) add(id);
  for (const id of sources.adminUserIds) add(id);
  for (const id of sources.flowRecipientIds) add(id);
  for (const id of sources.conversationUserIds) add(id);
  for (const id of sources.ledgerChatIds) add(id);
  for (const id of sources.ledgerPairedUserIds) add(id);

  const pairedSet = new Set(sources.pairedUserIds);
  const previouslyPairedUserIds = [...new Set([
    ...sources.ledgerPairedUserIds,
    ...sources.conversationUserIds,
  ])].filter((id) => Number.isFinite(id) && id > 0 && !pairedSet.has(id));

  return {
    chatIds: [...chatIds],
    userIds: [...userIds],
    previouslyPairedUserIds,
  };
}

/**
 * Bot-step recipients are comma separated and may hold {{template}} placeholders that only resolve
 * at run time — only the literal numeric ones can be looked up.
 */
export function parseRecipientIds(rawValues: string[]): number[] {
  const ids = new Set<number>();
  for (const raw of rawValues) {
    for (const part of raw.split(',')) {
      const token = part.trim();
      if (!/^-?\d+$/.test(token)) continue;
      const id = Number(token);
      if (!Number.isFinite(id) || id === 0) continue;
      ids.add(id);
    }
  }
  return [...ids];
}

export function parseIdentity(chatId: number, raw: unknown): ResolvedIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const chat = raw as Record<string, unknown>;
  const type = chat.type;
  if (type !== 'private' && type !== 'group' && type !== 'supergroup' && type !== 'channel') return null;
  const username = typeof chat.username === 'string' ? chat.username.replace(/^@/, '').trim() : '';
  const title = typeof chat.title === 'string' ? chat.title.trim() : '';
  const firstName = typeof chat.first_name === 'string' ? chat.first_name.trim() : '';
  const lastName = typeof chat.last_name === 'string' ? chat.last_name.trim() : '';
  return {
    chatId,
    type,
    ...(title ? { title } : {}),
    ...(username ? { username } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  };
}

export function parseMember(raw: unknown): ResolvedMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const member = raw as Record<string, unknown>;
  if (typeof member.status !== 'string') return null;
  return {
    status: member.status,
    ...(typeof member.can_post_messages === 'boolean' ? { canPostMessages: member.can_post_messages } : {}),
    ...(typeof member.is_member === 'boolean' ? { isMember: member.is_member } : {}),
  };
}

/**
 * can_post_messages is a channel-only admin right — a plain group member may already post, so the
 * two chat kinds cannot share one predicate.
 */
export function canPostFromMember(type: DirectoryChatType, member: ResolvedMember): boolean {
  if (member.status === 'creator') return true;
  if (type === 'channel') {
    if (member.status !== 'administrator') return false;
    return member.canPostMessages !== false;
  }
  if (member.status === 'administrator' || member.status === 'member') return true;
  if (member.status === 'restricted') return member.isMember === true;
  return false;
}

export function upsertResolvedChannel(
  channels: TelegramChannel[],
  identity: ResolvedIdentity,
  canPost: boolean,
  now: string,
): TelegramChannel[] {
  if (identity.type === 'private') return channels;
  const index = channels.findIndex((item) => item.chatId === identity.chatId);
  const existing = index >= 0 ? channels[index] : undefined;
  const entry: TelegramChannel = {
    chatId: identity.chatId,
    title: identity.title || existing?.title || '',
    ...(identity.username ? { username: identity.username } : {}),
    chatType: identity.type,
    canPost,
    discoveredAt: existing?.discoveredAt ?? now,
    ...(canPost ? {} : { lostAt: existing?.lostAt ?? now }),
  };
  const next = [...channels];
  if (existing) next[index] = entry; else next.push(entry);
  return next;
}

export function upsertKnownUser(
  users: TelegramKnownUser[],
  identity: ResolvedIdentity,
  now: string,
): TelegramKnownUser[] {
  if (identity.type !== 'private') return users;
  const index = users.findIndex((item) => item.userId === identity.chatId);
  const entry: TelegramKnownUser = {
    userId: identity.chatId,
    ...(identity.username ? { username: identity.username } : {}),
    ...(identity.firstName ? { firstName: identity.firstName } : {}),
    ...(identity.lastName ? { lastName: identity.lastName } : {}),
    resolvedAt: now,
  };
  const next = [...users];
  if (index >= 0) next[index] = entry; else next.push(entry);
  return next;
}

export function restorePairedUsers(
  pairing: TelegramPairingState,
  known: TelegramKnownUser[],
  userIds: number[],
  now: string,
): { next: TelegramPairingState; restored: TelegramKnownUser[] } {
  const alreadyPaired = new Set(pairing.pairedUsers.map((user) => user.userId));
  const restored: TelegramKnownUser[] = [];
  const pairedUsers = [...pairing.pairedUsers];

  for (const userId of userIds) {
    if (alreadyPaired.has(userId)) continue;
    const profile = known.find((item) => item.userId === userId);
    if (!profile) continue;
    alreadyPaired.add(userId);
    restored.push(profile);
    pairedUsers.push({
      userId,
      ...(profile.username ? { username: profile.username } : {}),
      ...(profile.firstName ? { firstName: profile.firstName } : {}),
      ...(profile.lastName ? { lastName: profile.lastName } : {}),
      pairedAt: now,
    });
  }

  return { next: { ...pairing, pairedUsers }, restored };
}

export function describeKnownUser(user: TelegramKnownUser): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  if (fullName) return user.username ? `${fullName} (@${user.username})` : fullName;
  return user.username ? `@${user.username}` : `ID ${user.userId}`;
}

export interface DirectoryBackfillSinks {
  getChannels: () => TelegramChannel[];
  saveChannels: (next: TelegramChannel[]) => void;
  getKnownUsers: () => TelegramKnownUser[];
  saveKnownUsers: (next: TelegramKnownUser[]) => void;
  getPairing: () => TelegramPairingState;
  savePairing: (next: TelegramPairingState) => void;
  recordContact: (input: BotContactInput) => void;
  onLog: (message: string) => void;
}

export interface DirectoryBackfillResult {
  channelsResolved: number;
  usersResolved: number;
  pairingsRestored: number;
}

/**
 * Runs once per bot start. Every lookup is best-effort: a chat the bot was removed from answers with
 * a 400 and must not abort the ids queued behind it.
 */
export async function runDirectoryBackfill(
  api: DirectoryApi,
  botId: number,
  candidates: DirectoryCandidates,
  sinks: DirectoryBackfillSinks,
): Promise<DirectoryBackfillResult> {
  const now = new Date().toISOString();
  let channelsResolved = 0;
  let usersResolved = 0;

  for (const chatId of candidates.chatIds.slice(0, MAX_LOOKUPS)) {
    const identity = parseIdentity(chatId, await safeCall(() => api.getChat(chatId)));
    if (!identity || identity.type === 'private') continue;
    const member = parseMember(await safeCall(() => api.getChatMember(chatId, botId)));
    /*
     * A getChatMember that simply failed says nothing about the bot's rights — treating that as
     * "false" would grey out a perfectly good recipient on the first flaky start.
     */
    const existing = sinks.getChannels().find((item) => item.chatId === chatId);
    const canPost = member ? canPostFromMember(identity.type, member) : (existing?.canPost ?? false);
    sinks.saveChannels(upsertResolvedChannel(sinks.getChannels(), identity, canPost, now));
    sinks.recordContact({
      platform: 'telegram',
      kind: 'chat',
      id: String(chatId),
      ...(identity.title ? { title: identity.title } : {}),
      ...(identity.username ? { username: identity.username } : {}),
      chatType: identity.type,
    });
    channelsResolved += 1;
    sinks.onLog(
      `[telegram] recovered ${identity.type} "${identity.title || chatId}" (${chatId}) — canPost: ${canPost}`,
    );
  }

  for (const userId of candidates.userIds.slice(0, MAX_LOOKUPS)) {
    const identity = parseIdentity(userId, await safeCall(() => api.getChat(userId)));
    if (!identity || identity.type !== 'private') continue;
    sinks.saveKnownUsers(upsertKnownUser(sinks.getKnownUsers(), identity, now));
    /*
     * Config is the authority on who holds a grant, so a pairing made before this ledger existed is
     * mirrored into it here. Without this an install that paired months ago carries names only, and
     * the next time config is lost there is nothing left to restore from.
     */
    const grant = sinks.getPairing().pairedUsers.find((user) => user.userId === userId);
    sinks.recordContact({
      platform: 'telegram',
      kind: 'user',
      id: String(userId),
      ...(identity.username ? { username: identity.username } : {}),
      ...(identity.firstName ? { firstName: identity.firstName } : {}),
      ...(identity.lastName ? { lastName: identity.lastName } : {}),
      ...(grant ? { pairedAt: grant.pairedAt } : {}),
    });
    usersResolved += 1;
  }

  const { next, restored } = restorePairedUsers(
    sinks.getPairing(),
    sinks.getKnownUsers(),
    candidates.previouslyPairedUserIds,
    now,
  );
  if (restored.length > 0) {
    sinks.savePairing(next);
    for (const user of restored) {
      sinks.recordContact({
        platform: 'telegram',
        kind: 'user',
        id: String(user.userId),
        ...(user.username ? { username: user.username } : {}),
        ...(user.firstName ? { firstName: user.firstName } : {}),
        ...(user.lastName ? { lastName: user.lastName } : {}),
        pairedAt: now,
      });
      sinks.onLog(`[telegram] restored pairing for ${describeKnownUser(user)} (${user.userId})`);
    }
  }

  if (channelsResolved > 0 || usersResolved > 0) {
    sinks.onLog(
      `[telegram] directory backfill: ${channelsResolved} chat(s), ${usersResolved} user(s), ${restored.length} pairing(s) restored`,
    );
  }

  return { channelsResolved, usersResolved, pairingsRestored: restored.length };
}

/** One start-up pass must never turn into a flood-wait; a desktop install has a handful of chats. */
const MAX_LOOKUPS = 50;

async function safeCall(work: () => Promise<unknown>): Promise<unknown> {
  try {
    return await work();
  } catch {
    return null;
  }
}

import { config } from '../config';
import { isBotSelfAccount } from '../memory/memoryContext';
import { loadUserMemory } from '../memory/memoryStore';
import type { UserMemoryState } from '../memory/memoryState';
import {
  NO_BOT_RIGHTS,
  groupGrantsOf,
  normalizeGrantList,
  resolveBotRights,
  resolveGroupRights,
  rightsAllowBuiltin,
  unionBotRights,
} from '../../shared/botPermissions';
import type { BotGrant, BotGroupGrant, BotRights } from '../../shared/botPermissions';
import { isBuiltinFlowId } from '../../shared/linkSites/registry';
import { BOT_BUILTIN_COMMAND_KEYS } from '../../shared/types';
import type { BotBuiltinCommandKey, BotPlatform } from '../../shared/types';

/** The ids paired on a platform right now, as strings. Read live: pairing changes while running. */
export function pairedBotUserIds(platform: BotPlatform): string[] {
  return platform === 'telegram'
    ? config.telegram.pairing.pairedUsers.map((user) => String(user.userId))
    : config.line.pairing.pairedUsers.map((user) => user.userId);
}

export function isBotUserPaired(platform: BotPlatform, userId: string): boolean {
  const id = String(userId ?? '').trim();
  return Boolean(id) && pairedBotUserIds(platform).includes(id);
}

/** The grants stored for one paired account; an unpaired id has none, whatever the file says. */
export function getBotGrants(platform: BotPlatform, userId: string): BotGrant[] {
  const id = String(userId ?? '').trim();
  if (!isBotUserPaired(platform, id)) return [];
  const stored = platform === 'telegram' ? config.telegram.permissions : config.line.permissions;
  return normalizeGrantList(stored?.[id], platform);
}

/** Blocked by the owner. Only unpaired people are on the list: a paired account is unpaired instead. */
export function isBotUserBlocked(platform: BotPlatform, userId: string): boolean {
  const id = String(userId ?? '').trim();
  const blocked = platform === 'telegram' ? config.telegram.blockedUsers : config.line.blockedUsers;
  return Boolean(id) && (blocked ?? []).includes(id) && !isBotUserPaired(platform, id);
}

/** The grants one group gives everyone in it, or null while it waits for the owner's approval. */
function getGroupGrants(platform: BotPlatform, chatId: string): BotGroupGrant[] | null {
  const stored = platform === 'telegram' ? config.telegram.groupPermissions : config.line.groupPermissions;
  return groupGrantsOf(stored, chatId);
}

/**
 * Whether a group (or LINE multi-person chat) still waits for the owner to allow it. The bot does
 * nothing there for anyone — paired accounts and the owner included — so the chat handlers drop
 * its updates first; `computeBotRights` refuses it again. Callers pass group chats only.
 */
export function isBotGroupPending(platform: BotPlatform, chatId: string): boolean {
  const chat = String(chatId ?? '').trim();
  return Boolean(chat) && getGroupGrants(platform, chat) === null;
}

/**
 * What one person may do in one chat, from the config and the memory file as they are now.
 * `state` is the user-memory file (for the "me" mark); null — unreadable — means not the owner.
 * - a private chat: a paired account's own rights; an unpaired person gets nothing;
 * - a group the owner has allowed: what the group grants everyone, plus a paired account's own
 *   rights there; a group still pending: nothing for anyone;
 * - blocked: nothing anywhere.
 */
export function computeBotRights(
  state: UserMemoryState | null,
  platform: BotPlatform,
  userId: string,
  chatId: string,
): BotRights {
  const id = String(userId ?? '').trim();
  const chat = String(chatId ?? '').trim();
  if (!id || isBotUserBlocked(platform, id)) return { ...NO_BOT_RIGHTS };
  const isPrivate = Boolean(chat) && chat === id;
  const groupGrants = isPrivate || !chat ? [] : getGroupGrants(platform, chat);
  if (groupGrants === null) return { ...NO_BOT_RIGHTS };
  const paired = isBotUserPaired(platform, id);
  const own = paired
    ? resolveBotRights({ platform, isOwner: state ? isBotSelfAccount(state, platform, id) : false, isPrivate, grants: getBotGrants(platform, id) })
    : { ...NO_BOT_RIGHTS };
  if (isPrivate || !chat) return own;
  return unionBotRights(own, resolveGroupRights(groupGrants));
}

/** `computeBotRights` with a fresh read of the memory file; a read failure fails closed. */
export async function getBotRights(platform: BotPlatform, userId: string, chatId: string): Promise<BotRights> {
  const state = await loadUserMemory().catch(() => null);
  return computeBotRights(state, platform, userId, chatId);
}

/** Admin is a Telegram grant on a still-paired account. Never implied by "me". */
export function isTelegramAdminGrant(userId: number): boolean {
  if (!Number.isFinite(userId) || userId <= 0) return false;
  return getBotGrants('telegram', String(userId)).includes('admin');
}

/**
 * Whether this account may run a flow command limited to admins, in this chat: the owner ("me")
 * or a Telegram admin-grant holder, still paired, in their own private chat. LINE has no admin
 * grant, so there it is the owner alone. Never in a group: the command reads the owner's data.
 * `state` is the memory file; null (unreadable) means not the owner.
 */
export function computeBotFlowAdmin(
  state: UserMemoryState | null,
  platform: BotPlatform,
  userId: string,
  chatId: string,
): boolean {
  const id = String(userId ?? '').trim();
  if (!id || String(chatId ?? '').trim() !== id || !isBotUserPaired(platform, id)) return false;
  if (state && isBotSelfAccount(state, platform, id)) return true;
  return platform === 'telegram' && getBotGrants(platform, id).includes('admin');
}

/** `computeBotFlowAdmin` with a fresh read of the memory file; unreadable leaves only the admin grant. */
export async function botFlowAdminAllowed(platform: BotPlatform, userId: string, chatId: string): Promise<boolean> {
  const state = await loadUserMemory().catch(() => null);
  return computeBotFlowAdmin(state, platform, userId, chatId);
}

/**
 * Every paired account's rights in its own private chat, from one read of the memory file — what
 * the Telegram "/" menu of that chat should list.
 */
async function pairedPrivateRights(platform: BotPlatform): Promise<Array<{ userId: string; rights: BotRights; flowAdmin: boolean }>> {
  const state = await loadUserMemory().catch(() => null);
  return pairedBotUserIds(platform).map((userId) => ({
    userId,
    rights: computeBotRights(state, platform, userId, userId),
    flowAdmin: computeBotFlowAdmin(state, platform, userId, userId),
  }));
}

/** Whether this person may talk to the bot in this chat at all, read now. */
export async function botChatAllowed(platform: BotPlatform, userId: string, chatId: string): Promise<boolean> {
  return (await getBotRights(platform, userId, chatId)).chat;
}

/** Whether a pasted link (or a button under one) may run the downloader for this account here, read now. */
export async function botDownloadAllowed(platform: BotPlatform, userId: string, chatId: string): Promise<boolean> {
  return (await getBotRights(platform, userId, chatId)).download;
}

/**
 * Whether a bot may start this flow for this account. The downloader's built-in flows need the
 * download grant; a flow command of the owner's own is guarded by its allow list instead, which
 * the bot checks before it gets here. The last line of defence behind the chat handlers' check.
 */
export async function botFlowAllowed(platform: BotPlatform, flowId: string, userId: string, chatId: string): Promise<boolean> {
  return !isBuiltinFlowId(flowId) || botDownloadAllowed(platform, userId, chatId);
}

/** Whether an account may type a built-in command (e.g. `/search`) in this chat, read now. */
export async function botBuiltinAllowed(
  platform: BotPlatform,
  key: BotBuiltinCommandKey,
  userId: string,
  chatId: string,
): Promise<boolean> {
  return rightsAllowBuiltin(await getBotRights(platform, userId, chatId), key);
}

interface BotMenuAccess {
  userId: string;
  /** The built-in commands this account may type in its private chat. */
  builtins: BotBuiltinCommandKey[];
  admin: boolean;
  /** May run flow commands limited to admins (the owner, or the admin grant). */
  flowAdmin: boolean;
}

/** Per paired account, the commands beyond the shared ones its own private-chat menu should list. */
export async function pairedMenuAccess(platform: BotPlatform): Promise<BotMenuAccess[]> {
  return (await pairedPrivateRights(platform)).map(({ userId, rights, flowAdmin }) => ({
    userId,
    builtins: BOT_BUILTIN_COMMAND_KEYS.filter((key) => rightsAllowBuiltin(rights, key)),
    admin: rights.admin,
    flowAdmin,
  }));
}

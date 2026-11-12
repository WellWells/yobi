import { config } from '../config';
import { isLineSelfChat } from '../lineSelf/chats';
import { isBotSelfAccount } from '../memory/memoryContext';
import { loadUserMemory } from '../memory/memoryStore';
import type { UserMemoryState } from '../memory/memoryState';
import {
  NO_BOT_RIGHTS,
  botGroupGrantsOf,
  isGrantAvailableOn,
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
  return (config[platform]?.pairing.pairedUsers ?? []).map((user) => String(user.userId));
}

export function isBotUserPaired(platform: BotPlatform, userId: string): boolean {
  const id = String(userId ?? '').trim();
  return Boolean(id) && pairedBotUserIds(platform).includes(id);
}

/** The grants stored for one paired account; an unpaired id has none, whatever the file says. */
export function getBotGrants(platform: BotPlatform, userId: string): BotGrant[] {
  const id = String(userId ?? '').trim();
  if (!isBotUserPaired(platform, id)) return [];
  return normalizeGrantList(config[platform]?.permissions?.[id], platform);
}

/** Blocked by the owner. Only unpaired people are on the list: a paired account is unpaired instead. */
export function isBotUserBlocked(platform: BotPlatform, userId: string): boolean {
  const id = String(userId ?? '').trim();
  return Boolean(id) && (config[platform]?.blockedUsers ?? []).includes(id) && !isBotUserPaired(platform, id);
}

/**
 * The grants one group gives everyone in it, or null while it waits for the owner's approval. LINE
 * PC's chats never wait (`botGroupsNeedApproval`): with nothing set, a group or a 1:1 chat gives
 * everyone nothing, and each person there asks on their own rights. Its other chats (open chats)
 * are never the bot's, so they stay closed like a pending group.
 */
function getGroupGrants(platform: BotPlatform, chatId: string): BotGroupGrant[] | null {
  if (platform === 'lineSelf' && !isLineSelfChat(chatId)) return null;
  return botGroupGrantsOf(platform, config[platform]?.groupPermissions, chatId);
}

/**
 * Whether this chat is the person's own for their rights: their private chat, or — on LINE PC,
 * where only the user has a private chat and everyone else asks in a group they share with the
 * user — any group or 1:1 chat. A paired account's rights there follow the person, not the chat
 * (the user's own, or what the user granted someone they let in); the unpaired get the group's
 * grants only.
 * Personal memory is not decided here: it stays in the private chat (`botMemoryContext`), since it
 * reaches every answer unasked and the others in a group read them. Nor is being an admin
 * (`isAdminChat`): on LINE PC another admin is one in their own 1:1 chat only.
 */
function isOwnChat(platform: BotPlatform, userId: string, chatId: string): boolean {
  if (!chatId) return false;
  return chatId === userId || platform === 'lineSelf';
}

/**
 * Where an account counts as an admin of the bot (flow admin, connector changes, the admin grant):
 * its own private chat. On LINE PC the owner keeps every chat — every line the bot sends is the
 * owner's own message — while an admin who is not the owner is one only in their own 1:1 chat with
 * the owner (its chat id is their id): in a group the others would read what admins get, the
 * owner's data included.
 */
function isAdminChat(platform: BotPlatform, userId: string, chatId: string, owner: boolean): boolean {
  if (!chatId) return false;
  return chatId === userId || (platform === 'lineSelf' && owner);
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
 * - a group the owner has allowed (LINE PC: any group or 1:1 chat): what the group grants
 *   everyone, plus a paired account's own rights there (LINE PC: all of them, as in the private
 *   chat); a group still pending: nothing for anyone;
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
  const isOwner = paired && state !== null && isBotSelfAccount(state, platform, id);
  const resolved = paired
    ? resolveBotRights({
      platform,
      isOwner,
      isPrivate: isPrivate || isOwnChat(platform, id, chat),
      grants: getBotGrants(platform, id),
    })
    : { ...NO_BOT_RIGHTS };
  // Rights follow the person on LINE PC; the admin grant stays where only admins read the answer.
  const own = resolved.admin && !isAdminChat(platform, id, chat, isOwner) ? { ...resolved, admin: false } : resolved;
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
 * Whether this account is an admin of the bot, in whatever chat: the owner ("me") or an admin-grant
 * holder on a platform with admins (Telegram, LINE, LINE PC), still paired. On Discord and Slack it
 * is the owner alone. `state` is the memory file; null (unreadable) means not the owner.
 */
export function computeBotAdmin(state: UserMemoryState | null, platform: BotPlatform, userId: string): boolean {
  const id = String(userId ?? '').trim();
  if (!id || !isBotUserPaired(platform, id)) return false;
  if (state && isBotSelfAccount(state, platform, id)) return true;
  return isGrantAvailableOn('admin', platform) && getBotGrants(platform, id).includes('admin');
}

/** Whether this paired account is the owner's ("me"), read now; an unreadable memory file is not. */
export async function botOwnerAllowed(platform: BotPlatform, userId: string): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id || !isBotUserPaired(platform, id)) return false;
  const state = await loadUserMemory().catch(() => null);
  return state !== null && isBotSelfAccount(state, platform, id);
}

/**
 * Whether this account may run a flow command limited to admins, in this chat: an admin
 * (`computeBotAdmin`) where it counts as one (`isAdminChat`: their own private chat; the LINE PC
 * owner anywhere). Never another admin in a group: the command reads the owner's data.
 */
export function computeBotFlowAdmin(
  state: UserMemoryState | null,
  platform: BotPlatform,
  userId: string,
  chatId: string,
): boolean {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const owner = state !== null && isBotUserPaired(platform, id) && isBotSelfAccount(state, platform, id);
  return isAdminChat(platform, id, String(chatId ?? '').trim(), owner) && computeBotAdmin(state, platform, id);
}

/**
 * Whether a connector change may be put to this person as a question in the chat: the owner ("me"),
 * still paired, in their own private chat. A connector granted to anyone else was the owner sharing
 * their data, never a write permission, so everyone else's changes are refused as before. `state`
 * is the memory file; null (unreadable) means not the owner.
 */
export function computeBotConnectorChanges(
  state: UserMemoryState | null,
  platform: BotPlatform,
  userId: string,
  chatId: string,
): boolean {
  const id = String(userId ?? '').trim();
  if (!id || !isBotUserPaired(platform, id) || state === null || !isBotSelfAccount(state, platform, id)) return false;
  return isAdminChat(platform, id, String(chatId ?? '').trim(), true);
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

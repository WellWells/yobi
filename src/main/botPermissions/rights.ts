import { config } from '../config';
import { isBotSelfAccount } from '../memory/memoryContext';
import { loadUserMemory } from '../memory/memoryStore';
import type { UserMemoryState } from '../memory/memoryState';
import { NO_BOT_RIGHTS, normalizeGrantList, resolveBotRights, rightsAllowBuiltin } from '../../shared/botPermissions';
import type { BotGrant, BotRights } from '../../shared/botPermissions';
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

/**
 * What one account may do in one chat, from the config and the memory file as they are now.
 * `state` is the user-memory file (for the "me" mark); null — unreadable — means not the owner.
 * Unpaired accounts get nothing at all.
 */
export function computeBotRights(
  state: UserMemoryState | null,
  platform: BotPlatform,
  userId: string,
  chatId: string,
): BotRights {
  const id = String(userId ?? '').trim();
  if (!isBotUserPaired(platform, id)) return { ...NO_BOT_RIGHTS };
  const isPrivate = Boolean(chatId) && String(chatId).trim() === id;
  const isOwner = state ? isBotSelfAccount(state, platform, id) : false;
  return resolveBotRights({ platform, isOwner, isPrivate, grants: getBotGrants(platform, id) });
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
 * Every paired account's rights in its own private chat, from one read of the memory file — what
 * the Telegram "/" menu of that chat should list.
 */
export async function pairedPrivateRights(platform: BotPlatform): Promise<Array<{ userId: string; rights: BotRights }>> {
  const state = await loadUserMemory().catch(() => null);
  return pairedBotUserIds(platform).map((userId) => ({ userId, rights: computeBotRights(state, platform, userId, userId) }));
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

export interface BotMenuAccess {
  userId: string;
  /** The built-in commands this account may type in its private chat. */
  builtins: BotBuiltinCommandKey[];
  admin: boolean;
}

/** Per paired account, the commands beyond the shared ones its own private-chat menu should list. */
export async function pairedMenuAccess(platform: BotPlatform): Promise<BotMenuAccess[]> {
  return (await pairedPrivateRights(platform)).map(({ userId, rights }) => ({
    userId,
    builtins: BOT_BUILTIN_COMMAND_KEYS.filter((key) => rightsAllowBuiltin(rights, key)),
    admin: rights.admin,
  }));
}

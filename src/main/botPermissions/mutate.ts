import { config, saveConfig } from '../config';
import {
  groupGrantsOf,
  isBotChatId,
  isBotGrant,
  isBotGroupGrant,
  isDefaultableGrant,
  isGrantAvailableOn,
  normalizeBlockedUsers,
  normalizeDefaultGrantList,
  normalizeGroupGrantList,
  sortBotGrants,
} from '../../shared/botPermissions';
import type {
  BotGrant,
  BotSetBlockedResult,
  BotSetDefaultGrantsResult,
  BotSetGroupPermissionsResult,
  BotSetPermissionsResult,
} from '../../shared/botPermissions';
import { isBotPlatform } from '../../shared/types';
import type { BotPlatform } from '../../shared/types';
import { isBotUserPaired } from './rights';
import { telegramAdminMirror } from './normalize';

function isPlatform(value: unknown): value is BotPlatform {
  return typeof value === 'string' && isBotPlatform(value);
}

/** Saves one platform's section of the config. */
function savePlatform(platform: BotPlatform): void {
  saveConfig({ [platform]: config[platform] });
}

function readUserId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Writes one platform's permissions map, keeping the Telegram admin list as a mirror: an older
 * build reading this config still finds its admins. Nothing reads the mirror except migration.
 */
function writePermissions(platform: BotPlatform, permissions: Record<string, BotGrant[]>): void {
  config[platform].permissions = permissions;
  if (platform === 'telegram') {
    config.telegram.adminUserIds = telegramAdminMirror(
      permissions,
      config.telegram.pairing.pairedUsers.map((user) => user.userId),
    );
  }
  savePlatform(platform);
}

function currentPermissions(platform: BotPlatform): Record<string, BotGrant[]> {
  return { ...config[platform].permissions };
}

/**
 * Replaces one paired account's grants. Strict, unlike the config normalizer: a request naming
 * an unknown token or offering admin on LINE is refused whole rather than quietly trimmed, so
 * the settings page never shows a change that was not saved.
 */
export function setBotPermissions(request: unknown): BotSetPermissionsResult {
  const body = (request && typeof request === 'object') ? request as Record<string, unknown> : {};
  const { platform } = body;
  const userId = readUserId(body.userId);
  if (!isPlatform(platform) || !userId || !Array.isArray(body.grants)) return { ok: false, reason: 'invalidRequest' };
  if (!isBotUserPaired(platform, userId)) return { ok: false, reason: 'notPaired' };

  const unique = new Set<BotGrant>();
  for (const value of body.grants) {
    const token = typeof value === 'string' ? value.trim() : value;
    if (!isBotGrant(token)) return { ok: false, reason: 'invalidGrant' };
    if (!isGrantAvailableOn(token, platform)) return { ok: false, reason: 'adminUnavailable' };
    unique.add(token);
  }
  const grants = sortBotGrants([...unique]);

  const permissions = currentPermissions(platform);
  if (grants.length > 0) permissions[userId] = grants;
  else delete permissions[userId];
  writePermissions(platform, permissions);
  return { ok: true, grants };
}

/**
 * Replaces what a platform's accounts get the moment they pair. Strict like the account grants,
 * and shell or admin refuse the whole request: a pairing code passes through other hands.
 * Accounts already paired keep what they have.
 */
export function setBotDefaultGrants(request: unknown): BotSetDefaultGrantsResult {
  const body = (request && typeof request === 'object') ? request as Record<string, unknown> : {};
  const { platform } = body;
  if (!isPlatform(platform) || !Array.isArray(body.grants)) return { ok: false, reason: 'invalidRequest' };

  const unique = new Set<BotGrant>();
  for (const value of body.grants) {
    const token = typeof value === 'string' ? value.trim() : value;
    if (!isBotGrant(token)) return { ok: false, reason: 'invalidGrant' };
    if (!isDefaultableGrant(token)) return { ok: false, reason: 'explicitGrant' };
    unique.add(token);
  }
  const grants = sortBotGrants([...unique]);

  config[platform].defaultGrants = grants;
  savePlatform(platform);
  return { ok: true, grants };
}

/**
 * Gives an account that has just paired with a code the platform's default grants, replacing
 * whatever was there. Only the pairing bridges call it, and only for an id that was not paired
 * before: a pairing restored from the contact directory at startup gets no grants. Does not
 * save: the pairing save that follows writes it.
 */
export function grantPairingDefaults(platform: BotPlatform, userId: string): void {
  const id = String(userId ?? '').trim();
  if (!id) return;
  const target = config[platform];
  const defaults = normalizeDefaultGrantList(target.defaultGrants, platform);
  const { [id]: _previous, ...rest } = target.permissions;
  target.permissions = defaults.length > 0 ? { ...rest, [id]: defaults } : rest;
}

/**
 * Allows a group with what it grants everyone in it, or (`grants: null`) puts it back to waiting
 * for approval, where the bot does nothing there. Strict like the account grants: one token a
 * group may not grant refuses the whole request.
 */
export function setBotGroupPermissions(request: unknown): BotSetGroupPermissionsResult {
  const body = (request && typeof request === 'object') ? request as Record<string, unknown> : {};
  const { platform } = body;
  const chatId = readUserId(body.chatId);
  if (!isPlatform(platform) || !chatId || !isBotChatId(chatId)) return { ok: false, reason: 'invalidRequest' };
  if (body.grants !== null && !Array.isArray(body.grants)) return { ok: false, reason: 'invalidRequest' };
  const target = config[platform];
  const map = { ...target.groupPermissions };
  if (body.grants === null) {
    delete map[chatId];
  } else {
    for (const value of body.grants as unknown[]) {
      if (!isBotGroupGrant(typeof value === 'string' ? value.trim() : value)) return { ok: false, reason: 'invalidGrant' };
    }
    map[chatId] = normalizeGroupGrantList(body.grants);
  }
  target.groupPermissions = map;
  savePlatform(platform);
  const grants = groupGrantsOf(map, chatId);
  return { ok: true, grants: grants ?? [], pending: grants === null };
}

/** Blocks or unblocks one person. A paired account is not blocked — it is unpaired instead. */
export function setBotUserBlocked(request: unknown): BotSetBlockedResult {
  const body = (request && typeof request === 'object') ? request as Record<string, unknown> : {};
  const { platform } = body;
  const userId = readUserId(body.userId);
  if (!isPlatform(platform) || !userId || typeof body.blocked !== 'boolean') return { ok: false, reason: 'invalidRequest' };
  if (body.blocked && isBotUserPaired(platform, userId)) return { ok: false, reason: 'paired' };
  const target = config[platform];
  const rest = target.blockedUsers.filter((id) => id !== userId);
  target.blockedUsers = normalizeBlockedUsers(body.blocked ? [...rest, userId] : rest);
  savePlatform(platform);
  return { ok: true, blocked: body.blocked };
}

/**
 * Unpairing takes the account's grants with it, so pairing the same id again later starts from
 * nothing. Does not save: the unpair handler saves once with the pairing change.
 */
export function dropBotPermissions(platform: BotPlatform, userId: string): void {
  const id = String(userId ?? '').trim();
  if (!id) return;
  const { [id]: _dropped, ...rest } = config[platform].permissions;
  config[platform].permissions = rest;
  if (platform === 'telegram') {
    config.telegram.adminUserIds = config.telegram.adminUserIds.filter((adminId) => String(adminId) !== id);
  }
}

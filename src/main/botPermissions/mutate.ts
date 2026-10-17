import { config, saveConfig } from '../config';
import {
  groupGrantsOf,
  isBotChatId,
  isBotGrant,
  isBotGroupGrant,
  isGrantAvailableOn,
  normalizeBlockedUsers,
  normalizeGroupGrantList,
  sortBotGrants,
} from '../../shared/botPermissions';
import type { BotGrant, BotSetBlockedResult, BotSetGroupPermissionsResult, BotSetPermissionsResult } from '../../shared/botPermissions';
import type { BotPlatform } from '../../shared/types';
import { isBotUserPaired } from './rights';
import { telegramAdminMirror } from './normalize';

function isPlatform(value: unknown): value is BotPlatform {
  return value === 'telegram' || value === 'line';
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
  if (platform === 'line') {
    config.line.permissions = permissions;
    saveConfig({ line: config.line });
    return;
  }
  config.telegram.permissions = permissions;
  config.telegram.adminUserIds = telegramAdminMirror(
    permissions,
    config.telegram.pairing.pairedUsers.map((user) => user.userId),
  );
  saveConfig({ telegram: config.telegram });
}

function currentPermissions(platform: BotPlatform): Record<string, BotGrant[]> {
  return { ...(platform === 'telegram' ? config.telegram.permissions : config.line.permissions) };
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
  const target = platform === 'telegram' ? config.telegram : config.line;
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
  saveConfig(platform === 'telegram' ? { telegram: config.telegram } : { line: config.line });
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
  const target = platform === 'telegram' ? config.telegram : config.line;
  const rest = target.blockedUsers.filter((id) => id !== userId);
  target.blockedUsers = normalizeBlockedUsers(body.blocked ? [...rest, userId] : rest);
  saveConfig(platform === 'telegram' ? { telegram: config.telegram } : { line: config.line });
  return { ok: true, blocked: body.blocked };
}

/**
 * Unpairing takes the account's grants with it, so pairing the same id again later starts from
 * nothing. Does not save: the unpair handler saves once with the pairing change.
 */
export function dropBotPermissions(platform: BotPlatform, userId: string): void {
  const id = String(userId ?? '').trim();
  if (!id) return;
  if (platform === 'telegram') {
    const { [id]: _dropped, ...rest } = config.telegram.permissions;
    config.telegram.permissions = rest;
    config.telegram.adminUserIds = config.telegram.adminUserIds.filter((adminId) => String(adminId) !== id);
    return;
  }
  const { [id]: _dropped, ...rest } = config.line.permissions;
  config.line.permissions = rest;
}

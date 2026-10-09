import { BOT_PERMISSIONS_VERSION, LEGACY_PAIRED_GRANTS, normalizeGrantList, sortBotGrants } from '../../shared/botPermissions';
import type { BotGrant } from '../../shared/botPermissions';
import type { BotPlatform } from '../../shared/types';

/*
 * Imported by configNormalizers, so this module must never import config (directly or through
 * the botPermissions façade) — that would close a cycle through config.ts.
 */

export interface BotPermissionsSource {
  platform: BotPlatform;
  /** `permissions` as read from config.json — anything at all. */
  raw: unknown;
  /** `permissionsVersion` as read from config.json. */
  rawVersion: unknown;
  /** The ids paired right now, as strings. */
  pairedIds: readonly string[];
  /** Telegram's old admin list; read only when migrating. */
  legacyAdminIds?: readonly string[];
}

export interface NormalizedBotPermissions {
  permissions: Record<string, BotGrant[]>;
  permissionsVersion: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A config written before per-account grants: every paired account could run /agent (with the
 * local tools) and reach the web, so each keeps exactly that, plus admin where it was an admin.
 * Accounts paired from here on start with nothing.
 */
function migrateLegacy(source: BotPermissionsSource): Record<string, BotGrant[]> {
  const admins = new Set(source.legacyAdminIds ?? []);
  const permissions: Record<string, BotGrant[]> = {};
  for (const id of source.pairedIds) {
    const grants: BotGrant[] = [...LEGACY_PAIRED_GRANTS];
    if (source.platform === 'telegram' && admins.has(id)) grants.push('admin');
    permissions[id] = sortBotGrants(grants);
  }
  return permissions;
}

/**
 * Valid tokens only, paired accounts only, no empty entries. A map of the wrong shape is dropped
 * whole (fail closed) rather than read as granting anything.
 */
export function normalizeBotPermissions(source: BotPermissionsSource): NormalizedBotPermissions {
  if (!hasCurrentPermissionsVersion(source.rawVersion)) {
    return { permissions: migrateLegacy(source), permissionsVersion: BOT_PERMISSIONS_VERSION };
  }
  if (!isPlainObject(source.raw)) {
    if (source.raw !== undefined) {
      console.warn(`[config] ${source.platform}.permissions is not an object; every account is left without grants`);
    }
    return { permissions: {}, permissionsVersion: BOT_PERMISSIONS_VERSION };
  }
  const paired = new Set(source.pairedIds);
  const permissions: Record<string, BotGrant[]> = {};
  let malformed = false;
  for (const [rawId, rawGrants] of Object.entries(source.raw)) {
    const id = rawId.trim();
    if (!paired.has(id)) continue;
    if (!Array.isArray(rawGrants)) {
      malformed = true;
      continue;
    }
    const grants = normalizeGrantList(rawGrants, source.platform);
    if (grants.length > 0) permissions[id] = grants;
  }
  if (malformed) {
    console.warn(`[config] ${source.platform}.permissions had an entry that is not a list; that account is left without grants`);
  }
  return { permissions, permissionsVersion: BOT_PERMISSIONS_VERSION };
}

/** The Telegram admin list as the mirror stores it: paired accounts holding `admin`, numeric. */
export function telegramAdminMirror(
  permissions: Record<string, readonly BotGrant[]>,
  pairedIds: readonly number[],
): number[] {
  return pairedIds.filter((id) => permissions[String(id)]?.includes('admin') === true);
}

/** Whether a stored `permissionsVersion` is current — anything else triggers the migration. */
export function hasCurrentPermissionsVersion(rawVersion: unknown): boolean {
  const version = Number(rawVersion);
  return Number.isFinite(version) && version >= BOT_PERMISSIONS_VERSION;
}

/**
 * Restoring a legacy backup (no `permissionsVersion`) must not rerun the migration, which would
 * re-grant every paired account; the grants in force now are carried in and later pruned to the
 * restored pairing. Versioned backups, or ones without this platform's settings, pass through
 * unchanged.
 */
export function carryCurrentGrantsIntoLegacyBackup(
  raw: unknown,
  current: Readonly<Record<string, readonly BotGrant[]>>,
): { value: unknown; carried: boolean } {
  if (!isPlainObject(raw) || hasCurrentPermissionsVersion(raw.permissionsVersion)) return { value: raw, carried: false };
  const permissions: Record<string, BotGrant[]> = {};
  for (const [id, grants] of Object.entries(current)) permissions[id] = [...grants];
  return { value: { ...raw, permissions, permissionsVersion: BOT_PERMISSIONS_VERSION }, carried: true };
}

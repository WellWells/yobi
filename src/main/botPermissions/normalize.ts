import {
  BOT_PERMISSIONS_VERSION,
  DOWNLOAD_GRANT_VERSION,
  LEGACY_PAIRED_GRANTS,
  normalizeGrantList,
  sortBotGrants,
} from '../../shared/botPermissions';
import type { BotGrant } from '../../shared/botPermissions';
import type { BotPlatform } from '../../shared/types';

/*
 * Imported by configNormalizers, so this module must never import config (directly or through
 * the botPermissions façade) — that would close a cycle through config.ts.
 */

interface BotPermissionsSource {
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

interface NormalizedBotPermissions {
  permissions: Record<string, BotGrant[]>;
  permissionsVersion: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A config written before per-account grants: every paired account could run /agent (with the
 * local tools) and reach the web, so each keeps exactly that, plus admin where it was an admin.
 * Accounts paired from here on start with the platform's `defaultGrants` (none unless set).
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

/** A stored `permissionsVersion` as a number; missing or unreadable is 0, before per-account grants. */
function permissionsVersionOf(rawVersion: unknown): number {
  const version = Number(rawVersion);
  return Number.isFinite(version) && version > 0 ? version : 0;
}

/**
 * Before the downloader was a grant, every paired account could paste a link and get it; the
 * accounts paired when the map is upgraded keep that. Ones whose entry was malformed stay empty.
 */
function addDownloadGrant(
  permissions: Record<string, BotGrant[]>,
  pairedIds: readonly string[],
  malformedIds: ReadonlySet<string>,
): void {
  for (const id of pairedIds) {
    if (malformedIds.has(id)) continue;
    permissions[id] = sortBotGrants([...new Set<BotGrant>([...(permissions[id] ?? []), 'download'])]);
  }
}

/**
 * Valid tokens only, paired accounts only, no empty entries. A map of the wrong shape is dropped
 * whole (fail closed) rather than read as granting anything.
 */
export function normalizeBotPermissions(source: BotPermissionsSource): NormalizedBotPermissions {
  const version = permissionsVersionOf(source.rawVersion);
  if (version === 0) {
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
  const malformedIds = new Set<string>();
  for (const [rawId, rawGrants] of Object.entries(source.raw)) {
    const id = rawId.trim();
    if (!paired.has(id)) continue;
    if (!Array.isArray(rawGrants)) {
      malformedIds.add(id);
      continue;
    }
    const grants = normalizeGrantList(rawGrants, source.platform);
    if (grants.length > 0) permissions[id] = grants;
  }
  if (malformedIds.size > 0) {
    console.warn(`[config] ${source.platform}.permissions had an entry that is not a list; that account is left without grants`);
  }
  if (version < DOWNLOAD_GRANT_VERSION) addDownloadGrant(permissions, source.pairedIds, malformedIds);
  return { permissions, permissionsVersion: BOT_PERMISSIONS_VERSION };
}

/** The Telegram admin list as the mirror stores it: paired accounts holding `admin`, numeric. */
export function telegramAdminMirror(
  permissions: Record<string, readonly BotGrant[]>,
  pairedIds: readonly number[],
): number[] {
  return pairedIds.filter((id) => permissions[String(id)]?.includes('admin') === true);
}

/**
 * A backup written before `download` was a grant: its other grants stand, but the downloader is
 * whatever each account has now — upgrading it on read would hand the downloader back to everyone
 * paired in it. An entry of the wrong shape stays as it is and fails closed when normalized.
 */
function carryCurrentDownload(
  raw: Record<string, unknown>,
  current: Readonly<Record<string, readonly BotGrant[]>>,
): Record<string, unknown> {
  if (!isPlainObject(raw.permissions)) return { ...raw, permissionsVersion: BOT_PERMISSIONS_VERSION };
  const permissions: Record<string, unknown> = {};
  for (const [rawId, grants] of Object.entries(raw.permissions)) {
    permissions[rawId.trim()] = Array.isArray(grants) ? grants.filter((grant) => grant !== 'download') : grants;
  }
  for (const [id, grants] of Object.entries(current)) {
    const kept = permissions[id];
    if (!grants.includes('download') || (kept !== undefined && !Array.isArray(kept))) continue;
    permissions[id] = [...(Array.isArray(kept) ? kept : []), 'download'];
  }
  return { ...raw, permissions, permissionsVersion: BOT_PERMISSIONS_VERSION };
}

/**
 * Restoring an old backup must not rerun a migration, which would re-grant every paired account.
 * Without a `permissionsVersion` the grants in force now are carried in whole (`carried`, so the
 * admin mirror is rebuilt from them); from before the downloader grant only `download` is. Both
 * are later pruned to the restored pairing. Current backups, or ones without this platform's
 * settings, pass through unchanged.
 */
export function carryCurrentGrantsIntoLegacyBackup(
  raw: unknown,
  current: Readonly<Record<string, readonly BotGrant[]>>,
): { value: unknown; carried: boolean } {
  if (!isPlainObject(raw)) return { value: raw, carried: false };
  const version = permissionsVersionOf(raw.permissionsVersion);
  if (version >= BOT_PERMISSIONS_VERSION) return { value: raw, carried: false };
  if (version > 0) return { value: carryCurrentDownload(raw, current), carried: false };
  const permissions: Record<string, BotGrant[]> = {};
  for (const [id, grants] of Object.entries(current)) permissions[id] = [...grants];
  return { value: { ...raw, permissions, permissionsVersion: BOT_PERMISSIONS_VERSION }, carried: true };
}

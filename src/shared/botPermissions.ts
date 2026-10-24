/**
 * What a paired Telegram / LINE account may use beyond talking to the bot.
 *
 * Pairing only lets someone chat with the bot and use the AI model commands. Everything else is
 * a grant the desktop owner adds per account, stored as a short token list in config.json
 * (`telegram.permissions` / `line.permissions`, keyed by the account id as a string). An account
 * starts from the platform's `defaultGrants`, copied in when it pairs with a code. The owner's
 * own account ("me", `botSelf` in the memory file) is not a token: it implies agent, web, the
 * downloader, and local and every connector in a private chat, but never shell or admin — those
 * two are always granted by name, the owner's account included — nor the video preview, which is
 * a choice rather than a right (`ownerImpliesGrant`).
 *
 * Pure on purpose: main decides with `resolveBotRights`, and the settings page derives what it
 * shows from the same functions, so the two cannot disagree.
 */
import { BOT_CAPABILITIES, GROUP_CAPABILITIES, connectorCapability } from './botCapabilities';
import type { BotCapability, BotCapabilityKey, BotGroupCapability } from './botCapabilities';
import { PUBLIC_DATA_CONNECTOR_IDS } from './builtinConnectors';
import type { BotBuiltinCommandKey, BotPlatform } from './types';

/**
 * Schema version of the permissions map. A map without one is migrated by giving paired accounts
 * LEGACY_PAIRED_GRANTS; a map older than DOWNLOAD_GRANT_VERSION gets `download` added for every
 * account paired at the time, since every paired account could use the downloader before.
 */
export const BOT_PERMISSIONS_VERSION = 2;

/** The version that added the `download` grant. */
export const DOWNLOAD_GRANT_VERSION = 2;

export const CONNECTOR_GRANT_PREFIX = 'connector:';
export const ALL_CONNECTORS_GRANT = 'connector:*';

/** The fixed, non-connector tokens. */
export const BOT_CAPABILITY_GRANTS = ['agent', 'web', 'download', 'preview', 'local', 'shell', 'admin'] as const;
export type BotCapabilityGrant = typeof BOT_CAPABILITY_GRANTS[number];
export type BotConnectorGrant = `connector:${string}`;
export type BotGrant = BotCapabilityGrant | BotConnectorGrant;

/**
 * Grants "me" does not imply. Running commands on this computer from a phone is a different risk
 * from reading it: whoever holds the chat account holds the computer. So it is asked for by name,
 * like admin, even on the owner's own account.
 */
export const EXPLICIT_GRANTS: readonly BotGrant[] = ['shell', 'admin'] as const;

export function isExplicitGrant(grant: BotGrant): boolean {
  return EXPLICIT_GRANTS.includes(grant);
}

/** What every account paired before per-account grants existed could already do. */
export const LEGACY_PAIRED_GRANTS: readonly BotGrant[] = ['agent', 'web', 'download', 'local'] as const;

/** Server ids are UUIDs or `builtin-*`; anything else in a token is a hand edit, not a connector. */
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type BotConnectorRights = 'all' | 'none' | readonly string[];

export interface BotRights {
  /** May talk to the bot at all (the chat kit). Every paired account; in a group, its grants. */
  chat: boolean;
  agent: boolean;
  web: boolean;
  /** A pasted post or video link runs the downloader's built-in flow, and its buttons work. */
  download: boolean;
  /**
   * A pasted video link first brings a low-quality copy of a short video (Telegram). Of use only
   * with `download` (an account's own or its group's), which `ytdlAccessFor` checks.
   */
  preview: boolean;
  local: boolean;
  /** Run commands on this computer, each one approved in the chat first. Private chats only. */
  shell: boolean;
  admin: boolean;
  connectors: BotConnectorRights;
}

export interface BotRightsInput {
  platform: BotPlatform;
  /** Marked as "me" and still paired. */
  isOwner: boolean;
  /** A one-to-one chat with the account itself (chat id equals user id). */
  isPrivate: boolean;
  grants: readonly string[];
}

export const NO_BOT_RIGHTS: BotRights = Object.freeze({
  chat: false,
  agent: false,
  web: false,
  download: false,
  preview: false,
  local: false,
  shell: false,
  admin: false,
  connectors: 'none',
}) as BotRights;

export function connectorGrant(serverId: string): BotConnectorGrant {
  return `${CONNECTOR_GRANT_PREFIX}${serverId}`;
}

export function isBotGrant(value: unknown): value is BotGrant {
  if (typeof value !== 'string') return false;
  if ((BOT_CAPABILITY_GRANTS as readonly string[]).includes(value)) return true;
  if (value === ALL_CONNECTORS_GRANT) return true;
  if (!value.startsWith(CONNECTOR_GRANT_PREFIX)) return false;
  return CONNECTOR_ID_PATTERN.test(value.slice(CONNECTOR_GRANT_PREFIX.length));
}

/** Admin is three Telegram commands; LINE has none of them, so it is never offered there. */
export function isGrantAvailableOn(grant: BotGrant, platform: BotPlatform): boolean {
  return grant !== 'admin' || platform === 'telegram';
}

function grantRank(grant: BotGrant): number {
  switch (grant) {
    case 'agent': return 0;
    case 'web': return 1;
    case 'download': return 2;
    case 'preview': return 3;
    case 'local': return 4;
    case 'shell': return 5;
    case ALL_CONNECTORS_GRANT: return 6;
    case 'admin': return 8;
    default: return 7;
  }
}

/** Display order: agent, web, download, preview, local, shell, all connectors, single connectors (by id), admin. */
export function sortBotGrants(grants: readonly BotGrant[]): BotGrant[] {
  return [...grants].sort((a, b) => grantRank(a) - grantRank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Valid tokens only, once each, in display order. Unknown tokens and ones the platform does not
 * offer are dropped, so a hand edit can only ever narrow what an account may do.
 */
export function normalizeGrantList(raw: unknown, platform: BotPlatform): BotGrant[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<BotGrant>();
  for (const value of raw) {
    const token = typeof value === 'string' ? value.trim() : value;
    if (!isBotGrant(token) || !isGrantAvailableOn(token, platform)) continue;
    seen.add(token);
  }
  return sortBotGrants([...seen]);
}

/**
 * Whether a grant may be one the owner hands every new pairing: anything but the grants always
 * given by name. A pairing code is passed around; shell or admin for whoever redeems it would be
 * the computer or the bot's settings for whoever gets hold of the code.
 */
export function isDefaultableGrant(grant: BotGrant): boolean {
  return !isExplicitGrant(grant);
}

/** The stored defaults for new pairings, kept to tokens the platform offers and may default. */
export function normalizeDefaultGrantList(raw: unknown, platform: BotPlatform): BotGrant[] {
  return normalizeGrantList(raw, platform).filter(isDefaultableGrant);
}

/** The single connectors named in a grant list (not `connector:*`). */
export function connectorGrantIds(grants: readonly string[]): string[] {
  const ids: string[] = [];
  for (const grant of grants) {
    if (grant === ALL_CONNECTORS_GRANT || !isBotGrant(grant) || !grant.startsWith(CONNECTOR_GRANT_PREFIX)) continue;
    const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Whether a grant list covers one capability. `connector:<id>` is also covered by
 * `connector:*`, which includes connectors added later.
 */
export function grantAllows(grants: readonly string[], capability: BotGrant): boolean {
  if (grants.includes(capability)) return true;
  return capability.startsWith(CONNECTOR_GRANT_PREFIX) && grants.includes(ALL_CONNECTORS_GRANT);
}

// Every account grant has its row in the capability table; a grant added without one fails here.
const GRANT_ROWS: Readonly<Record<BotCapabilityGrant, BotCapability>> = BOT_CAPABILITIES;

/**
 * Whether the "me" mark already gives a grant (the table's `owner`): every connector does; shell,
 * admin and the video preview do not, so the owner's own account holds those by name.
 */
export function ownerImpliesGrant(grant: BotGrant): boolean {
  return (BOT_CAPABILITY_GRANTS as readonly string[]).includes(grant) ? GRANT_ROWS[grant as BotCapabilityGrant].owner : true;
}

/**
 * One paired account's rights in one chat, from the capability table (`botCapabilities.ts`): a
 * capability counts when the owner mark implies it, every paired account has it, or the account
 * holds its grant — and only where it reaches (a private chat, or a group for what goes there).
 * Shell also needs agent; admin is Telegram only. The preview is the grant alone: the downloader
 * it needs may be a group's, so it is checked where a preview is made (`ytdlAccessFor`). Unpaired
 * people never come here.
 */
export function resolveBotRights(input: BotRightsInput): BotRights {
  const grants = input.grants.filter(isBotGrant);
  const isGrant = (key: BotCapabilityKey): key is BotCapabilityGrant => (BOT_CAPABILITY_GRANTS as readonly string[]).includes(key);
  const has = (key: BotCapabilityKey): boolean => {
    const row = isGrant(key) ? GRANT_ROWS[key] : BOT_CAPABILITIES[key];
    const given = (input.isOwner && row.owner) || row.paired || (isGrant(key) && grants.includes(key));
    return given && (input.isPrivate || row.inGroups);
  };
  const allConnectors = input.isOwner || grants.includes(ALL_CONNECTORS_GRANT);
  const named = connectorGrantIds(grants);
  let connectors: BotConnectorRights = 'none';
  if (input.isPrivate) {
    if (allConnectors) connectors = 'all';
    else if (named.length > 0) connectors = named;
  } else {
    const ids = PUBLIC_DATA_CONNECTOR_IDS.filter((id) => connectorCapability(id).inGroups && (allConnectors || named.includes(id)));
    if (ids.length > 0) connectors = ids;
  }
  return {
    chat: has('chat'),
    agent: has('agent'),
    web: has('web'),
    download: has('download'),
    preview: has('preview'),
    local: has('local'),
    shell: has('shell') && has('agent'),
    admin: input.platform === 'telegram' && has('admin'),
    connectors,
  };
}

/**
 * What a group grants everyone in it, paired or not: talking to the bot, the web, the downloader,
 * and public-data connectors — the table's `groupGrantable`. Stored per chat id.
 */
export type BotGroupGrant = BotGroupCapability | BotConnectorGrant;

export function isBotGroupGrant(value: unknown): value is BotGroupGrant {
  if (typeof value !== 'string') return false;
  if ((GROUP_CAPABILITIES as readonly string[]).includes(value)) return true;
  if (!value.startsWith(CONNECTOR_GRANT_PREFIX) || value === ALL_CONNECTORS_GRANT) return false;
  const id = value.slice(CONNECTOR_GRANT_PREFIX.length);
  return CONNECTOR_ID_PATTERN.test(id) && connectorCapability(id).groupGrantable;
}

/** Valid group grants only, once each: capabilities in table order, then connectors. */
export function normalizeGroupGrantList(raw: unknown): BotGroupGrant[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<BotGroupGrant>();
  for (const value of raw) {
    const token = typeof value === 'string' ? value.trim() : value;
    if (isBotGroupGrant(token)) seen.add(token);
  }
  const capabilities = GROUP_CAPABILITIES.filter((key) => seen.has(key));
  const connectors = [...seen].filter((grant) => grant.startsWith(CONNECTOR_GRANT_PREFIX)).sort();
  return [...capabilities, ...connectors];
}

/** What allowing a group writes, for the owner to edit from there: the table's `groupPreselected`. */
export const PRESELECTED_GROUP_GRANTS: readonly BotGroupGrant[] = Object.freeze([
  ...GROUP_CAPABILITIES.filter((key) => BOT_CAPABILITIES[key].groupPreselected),
  ...PUBLIC_DATA_CONNECTOR_IDS.filter((id) => connectorCapability(id).groupPreselected).map(connectorGrant),
]);

/** The stored map, kept to valid chat ids and valid grants. Wrong shape = no group allowed yet. */
export function normalizeGroupPermissions(raw: unknown): Record<string, BotGroupGrant[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, BotGroupGrant[]> = {};
  for (const [chatId, grants] of Object.entries(raw as Record<string, unknown>)) {
    const id = chatId.trim();
    if (!isBotChatId(id) || !Array.isArray(grants)) continue;
    out[id] = normalizeGroupGrantList(grants);
  }
  return out;
}

const MAX_BLOCKED_USERS = 5_000;

/** The ids the owner blocked: valid ids, once each, oldest first. */
export function normalizeBlockedUsers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const value of raw) {
    const id = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (id && CONNECTOR_ID_PATTERN.test(id)) out.add(id);
  }
  return [...out].slice(-MAX_BLOCKED_USERS);
}

/**
 * One group's grants, or null while the group waits for the owner's approval (no entry for it).
 * A pending group gets nothing from the bot, for anyone in it; an empty list is an allowed group
 * that grants everyone nothing, where paired members still use their own rights.
 */
export function groupGrantsOf(map: Readonly<Record<string, readonly string[]>> | undefined, chatId: string): BotGroupGrant[] | null {
  const stored = map?.[String(chatId).trim()];
  return stored === undefined ? null : normalizeGroupGrantList(stored);
}

/** Whether a group still waits for the owner to allow it in settings. */
export function isGroupPending(map: Readonly<Record<string, readonly string[]>> | undefined, chatId: string): boolean {
  return groupGrantsOf(map, chatId) === null;
}

/** The rights a group's grants give everyone in it. */
export function resolveGroupRights(grants: readonly string[]): BotRights {
  const list = normalizeGroupGrantList(grants);
  const ids = connectorGrantIds(list);
  return {
    ...NO_BOT_RIGHTS,
    chat: list.includes('chat'),
    web: list.includes('web'),
    download: list.includes('download'),
    connectors: ids.length > 0 ? ids : 'none',
  };
}

function unionConnectors(a: BotConnectorRights, b: BotConnectorRights): BotConnectorRights {
  if (a === 'all' || b === 'all') return 'all';
  if (a === 'none') return b === 'none' ? 'none' : [...b];
  if (b === 'none') return [...a];
  return [...new Set([...a, ...b])];
}

/** Everything either allows — a group member keeps their own account's rights there too. */
export function unionBotRights(a: BotRights, b: BotRights): BotRights {
  return {
    chat: a.chat || b.chat,
    agent: a.agent || b.agent,
    web: a.web || b.web,
    download: a.download || b.download,
    preview: a.preview || b.preview,
    local: a.local || b.local,
    shell: a.shell || b.shell,
    admin: a.admin || b.admin,
    connectors: unionConnectors(a.connectors, b.connectors),
  };
}

/**
 * The grant a built-in bot command needs: `/search` needs web. The agent grant gates no command —
 * it decides how much an account's ordinary messages may use (the full bot kit, or the chat kit).
 */
export function builtinCommandGrant(_key: BotBuiltinCommandKey): 'web' {
  return 'web';
}

/** Whether resolved rights let an account type one built-in command. */
export function rightsAllowBuiltin(rights: BotRights, key: BotBuiltinCommandKey): boolean {
  return rights[builtinCommandGrant(key)];
}

function intersectConnectors(a: BotConnectorRights, b: BotConnectorRights): BotConnectorRights {
  if (a === 'none' || b === 'none') return 'none';
  if (a === 'all') return b === 'all' ? 'all' : [...b];
  if (b === 'all') return [...a];
  const both = a.filter((id) => b.includes(id));
  return both.length > 0 ? both : 'none';
}

/** Only what both allow — a resumed run can lose rights it started with, never gain new ones. */
export function intersectBotRights(a: BotRights, b: BotRights): BotRights {
  return {
    chat: a.chat && b.chat,
    agent: a.agent && b.agent,
    web: a.web && b.web,
    download: a.download && b.download,
    preview: a.preview && b.preview,
    local: a.local && b.local,
    shell: a.shell && b.shell,
    admin: a.admin && b.admin,
    connectors: intersectConnectors(a.connectors, b.connectors),
  };
}

/** The request the settings page sends to replace one account's grants. */
export interface BotSetPermissionsRequest {
  platform: BotPlatform;
  userId: string;
  grants: BotGrant[];
}

export type BotSetPermissionsFailure = 'invalidRequest' | 'notPaired' | 'invalidGrant' | 'adminUnavailable';

/** Replaces what a platform's accounts are given the moment they pair. */
export interface BotSetDefaultGrantsRequest {
  platform: BotPlatform;
  grants: BotGrant[];
}

/** `explicitGrant`: shell or admin, which are never a default. */
export type BotSetDefaultGrantsFailure = 'invalidRequest' | 'invalidGrant' | 'explicitGrant';

export type BotSetDefaultGrantsResult =
  | { ok: true; grants: BotGrant[] }
  | { ok: false; reason: BotSetDefaultGrantsFailure };

/** Allows a group with these grants, or (`grants: null`) puts it back to waiting for approval. */
export interface BotSetGroupPermissionsRequest {
  platform: BotPlatform;
  chatId: string;
  grants: BotGroupGrant[] | null;
}

export type BotSetGroupPermissionsResult =
  | { ok: true; grants: BotGroupGrant[]; pending: boolean }
  | { ok: false; reason: 'invalidRequest' | 'invalidGrant' };

/** Blocks or unblocks one unpaired person. */
export interface BotSetBlockedRequest {
  platform: BotPlatform;
  userId: string;
  blocked: boolean;
}

export type BotSetBlockedResult =
  | { ok: true; blocked: boolean }
  | { ok: false; reason: 'invalidRequest' | 'paired' };

/** Pairs, without a code, someone who asked to use the bot in a private chat. */
export interface BotApprovePairingRequest {
  platform: BotPlatform;
  userId: string;
}

/**
 * `newlyPaired: false` = already paired (another manager was quicker). `noRequest`: they never
 * asked, or the request is gone; `unavailable`: the platform cannot pair anyone right now.
 */
export type BotApprovePairingResult =
  | { ok: true; newlyPaired: boolean }
  | { ok: false; reason: 'invalidRequest' | 'noRequest' | 'blocked' | 'unavailable' };

/** A chat id as Telegram (`-100…`) or LINE (`C…`, `R…`) writes it. */
export function isBotChatId(value: string): boolean {
  return CONNECTOR_ID_PATTERN.test(value.replace(/^-/u, ''));
}

export type BotSetPermissionsResult =
  | { ok: true; grants: BotGrant[] }
  | { ok: false; reason: BotSetPermissionsFailure };

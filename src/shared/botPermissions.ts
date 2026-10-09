/**
 * What a paired Telegram / LINE account may use beyond talking to the bot.
 *
 * Pairing only lets someone chat with the bot and use the AI model commands. Everything else is
 * a grant the desktop owner adds per account, stored as a short token list in config.json
 * (`telegram.permissions` / `line.permissions`, keyed by the account id as a string). The owner's
 * own account ("me", `botSelf` in the memory file) is not a token: it implies agent, web, local
 * and every connector in a private chat, but never shell or admin — those two are always granted
 * by name, the owner's account included.
 *
 * Pure on purpose: main decides with `resolveBotRights`, and the settings page derives what it
 * shows from the same functions, so the two cannot disagree.
 */
import type { BotBuiltinCommandKey, BotPlatform } from './types';

/** Schema version of the permissions map; an older map is migrated by giving paired accounts LEGACY_PAIRED_GRANTS. */
export const BOT_PERMISSIONS_VERSION = 1;

export const CONNECTOR_GRANT_PREFIX = 'connector:';
export const ALL_CONNECTORS_GRANT = 'connector:*';

/** The fixed, non-connector tokens. */
export const BOT_CAPABILITY_GRANTS = ['agent', 'web', 'local', 'shell', 'admin'] as const;
export type BotCapabilityGrant = typeof BOT_CAPABILITY_GRANTS[number];
export type BotConnectorGrant = `connector:${string}`;
export type BotGrant = BotCapabilityGrant | BotConnectorGrant;

/** Every token that is not tied to one connector, in display order. */
export const BOT_GRANTS: readonly BotGrant[] = ['agent', 'web', 'local', 'shell', ALL_CONNECTORS_GRANT, 'admin'] as const;

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
export const LEGACY_PAIRED_GRANTS: readonly BotGrant[] = ['agent', 'web', 'local'] as const;

/** Server ids are UUIDs or `builtin-*`; anything else in a token is a hand edit, not a connector. */
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type BotConnectorRights = 'all' | 'none' | readonly string[];

export interface BotRights {
  agent: boolean;
  web: boolean;
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
  agent: false,
  web: false,
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
    case 'local': return 2;
    case 'shell': return 3;
    case ALL_CONNECTORS_GRANT: return 4;
    case 'admin': return 6;
    default: return 5;
  }
}

/** Display order: agent, web, local, shell, all connectors, single connectors (by id), admin. */
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

/**
 * The one rule both main and the settings page apply:
 * - the owner gets agent, web, local and every connector (never shell or admin);
 * - local files, shell and connectors only ever reach a private chat, the owner's included;
 * - shell rides on the agent kit, so it needs agent as well (the owner has it);
 * - admin is Telegram only.
 */
export function resolveBotRights(input: BotRightsInput): BotRights {
  const grants = input.grants.filter(isBotGrant);
  const has = (grant: BotGrant): boolean => input.isOwner || grantAllows(grants, grant);
  let connectors: BotConnectorRights = 'none';
  if (input.isPrivate) {
    if (input.isOwner || grants.includes(ALL_CONNECTORS_GRANT)) connectors = 'all';
    else {
      const ids = connectorGrantIds(grants);
      if (ids.length > 0) connectors = ids;
    }
  }
  return {
    agent: has('agent'),
    web: has('web'),
    local: input.isPrivate && has('local'),
    shell: input.isPrivate && has('agent') && grants.includes('shell'),
    admin: input.platform === 'telegram' && grants.includes('admin'),
    connectors,
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

/** Whether connector rights reach one server. */
export function connectorRightsAllow(connectors: BotConnectorRights, serverId: string): boolean {
  if (connectors === 'all') return true;
  if (connectors === 'none') return false;
  return connectors.includes(serverId);
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
    agent: a.agent && b.agent,
    web: a.web && b.web,
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

export type BotSetPermissionsResult =
  | { ok: true; grants: BotGrant[] }
  | { ok: false; reason: BotSetPermissionsFailure };

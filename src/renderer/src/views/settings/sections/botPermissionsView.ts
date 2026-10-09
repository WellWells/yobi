/**
 * What the settings page shows about per-account bot grants, derived from the same pure module
 * main decides with (`shared/botPermissions.ts`), so a chip, a menu item and a "who can use"
 * caption can never disagree with what the bot actually allows.
 *
 * Pure: no React, no IPC. The chips component, the paired lists, the built-in command rows,
 * the connector cards and the memory page all read it.
 */
import {
  ALL_CONNECTORS_GRANT,
  CONNECTOR_GRANT_PREFIX,
  builtinCommandGrant,
  connectorGrant,
  grantAllows,
  isExplicitGrant,
  isGrantAvailableOn,
  normalizeGrantList,
  sortBotGrants,
} from '../../../../../shared/botPermissions';
import type { BotGrant } from '../../../../../shared/botPermissions';
import { BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_X_SERVER_ID } from '../../../../../shared/builtinConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../../../../shared/types';
import type {
  BotBuiltinCommandKey,
  BotPlatform,
  LineSettingsSnapshot,
  TelegramSettingsSnapshot,
} from '../../../../../shared/types';
import type { UserMemoryBotSelf } from '../../../../../shared/userMemory';
import { lineAccountLabel, telegramAccountLabel } from '../../../utils/botAccountLabel';

type Translate = (key: string) => string;

/** A connector an account can be granted, named the way the connector page names it. */
export interface BotConnectorOption {
  id: string;
  name: string;
}

/** Built-in connectors carry Yobi's own translated titles; their stored names are English ids. */
const BUILTIN_CONNECTOR_TITLES: Record<string, string> = {
  [BUILTIN_LINE_SERVER_ID]: 'settings.mcp.line.title',
  [BUILTIN_THUNDERBIRD_SERVER_ID]: 'settings.mcp.thunderbird.title',
  [BUILTIN_X_SERVER_ID]: 'settings.mcp.x.title',
};
const BUILTIN_ORDER = [BUILTIN_LINE_SERVER_ID, BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_X_SERVER_ID];

/**
 * The connectors that exist right now: the built-ins that are switched on (in the connector
 * page's order), then every added server by its own name.
 */
export function botConnectorOptions(
  servers: readonly { id: string; name: string }[],
  t: Translate,
): BotConnectorOption[] {
  const builtins = BUILTIN_ORDER
    .filter((id) => servers.some((server) => server.id === id))
    .map((id) => ({ id, name: t(BUILTIN_CONNECTOR_TITLES[id]) }));
  const external = servers
    .filter((server) => !(server.id in BUILTIN_CONNECTOR_TITLES))
    .map((server) => ({ id: server.id, name: server.name || server.id }));
  return [...builtins, ...external];
}

export type GrantGroupKey = 'commands' | 'agent' | 'connectors' | 'manage';

/** A boundary main enforces on a grant, shown as a tag instead of a parenthetical. */
export type GrantLimit = 'dmOnly' | 'readOnly';

export const GRANT_LIMIT_KEYS: Record<GrantLimit, string> = {
  dmOnly: 'settings.bot.perm.limit.dmOnly',
  readOnly: 'settings.bot.perm.limit.readOnly',
};

export interface GrantItem {
  grant: BotGrant;
  label: string;
  /** Empty when the menu row says nothing its group's tags do not already say. */
  description: string;
  limits: GrantLimit[];
}

export interface GrantMenuGroup {
  key: GrantGroupKey;
  label: string;
  /** The limits every item in the group shares, tagged once on the group label. */
  limits: GrantLimit[];
  items: GrantItem[];
}

function connectorIdOf(grant: BotGrant): string | null {
  if (grant === ALL_CONNECTORS_GRANT || !grant.startsWith(CONNECTOR_GRANT_PREFIX)) return null;
  return grant.slice(CONNECTOR_GRANT_PREFIX.length);
}

/** The chip text of one grant. A connector that was removed since keeps a chip, so it can be taken off. */
export function grantLabel(grant: BotGrant, connectors: readonly BotConnectorOption[], t: Translate): string {
  switch (grant) {
    case 'agent': return t('settings.bot.perm.grant.agent');
    case 'web': return t('settings.bot.perm.grant.web');
    case 'local': return t('settings.bot.perm.grant.local');
    case 'shell': return t('settings.bot.perm.grant.shell');
    case 'admin': return t('settings.bot.perm.grant.admin');
    case ALL_CONNECTORS_GRANT: return t('settings.bot.perm.grant.allConnectors');
    default: {
      const id = connectorIdOf(grant);
      const known = connectors.find((option) => option.id === id);
      return known ? known.name : t('settings.bot.perm.grant.missingConnector');
    }
  }
}

/** The one-line explanation under a menu item and in a chip's tooltip. */
export function grantDescription(grant: BotGrant, t: Translate): string {
  switch (grant) {
    case 'agent': return t('settings.bot.perm.grant.agent.desc');
    case 'web': return t('settings.bot.perm.grant.web.desc');
    case 'local': return t('settings.bot.perm.grant.local.desc');
    case 'shell': return t('settings.bot.perm.grant.shell.desc');
    case 'admin': return t('settings.bot.perm.grant.admin.desc');
    case ALL_CONNECTORS_GRANT: return t('settings.bot.perm.grant.allConnectors.desc');
    default: return t('settings.bot.perm.grant.connector.desc');
  }
}

/** Local tools, shell and connectors only reach private chats; bots never write to a connector. */
export function grantLimits(grant: BotGrant): GrantLimit[] {
  if (grant === 'local' || grant === 'shell') return ['dmOnly'];
  if (grant.startsWith(CONNECTOR_GRANT_PREFIX)) return ['dmOnly', 'readOnly'];
  return [];
}

export interface GrantViewInput {
  platform: BotPlatform;
  isOwner: boolean;
  connectors: readonly BotConnectorOption[];
  t: Translate;
}

function item(grant: BotGrant, input: GrantViewInput): GrantItem {
  return {
    grant,
    label: grantLabel(grant, input.connectors, input.t),
    description: grantDescription(grant, input.t),
    limits: grantLimits(grant),
  };
}

/** A single connector's sentence is the same on every row; in the menu its name is enough. */
function menuItem(grant: BotGrant, input: GrantViewInput): GrantItem {
  const entry = item(grant, input);
  return connectorIdOf(grant) === null ? entry : { ...entry, description: '' };
}

function sharedLimits(items: readonly GrantItem[]): GrantLimit[] {
  const [first, ...rest] = items;
  return (first?.limits ?? []).filter((limit) => rest.every((entry) => entry.limits.includes(limit)));
}

/**
 * The removable chips of one account. The owner already has everything except shell and admin, so
 * only those show as chips for them; the row says "everything" in words instead.
 */
export function grantChips(grants: readonly BotGrant[], input: GrantViewInput): GrantItem[] {
  return normalizeGrantList(grants, input.platform)
    .filter((grant) => !input.isOwner || isExplicitGrant(grant))
    .map((grant) => item(grant, input));
}

/**
 * What the "+ Permission" menu offers: only grants the account does not have yet, grouped.
 * Single connectors are hidden once all connectors are granted (they would change nothing),
 * admin is Telegram only, and the owner is only offered shell and admin.
 */
export function grantMenuGroups(grants: readonly BotGrant[], input: GrantViewInput): GrantMenuGroup[] {
  const has = new Set<BotGrant>(grants);
  const offer = (grant: BotGrant): boolean => !has.has(grant) && isGrantAvailableOn(grant, input.platform);
  const groups: GrantMenuGroup[] = [];
  const push = (key: GrantGroupKey, labelKey: string, candidates: BotGrant[]): void => {
    const items = candidates.filter(offer).map((grant) => menuItem(grant, input));
    if (items.length > 0) groups.push({ key, label: input.t(labelKey), limits: sharedLimits(items), items });
  };
  if (!input.isOwner) {
    push('commands', 'settings.bot.perm.group.commands', ['web']);
    // Agent is not a command: it widens what an account's ordinary messages may use.
    push('agent', 'settings.bot.perm.group.agent', ['agent', 'local', 'shell']);
    const singles = has.has(ALL_CONNECTORS_GRANT)
      ? []
      : input.connectors.map((option) => connectorGrant(option.id));
    push('connectors', 'settings.bot.perm.group.connectors', [ALL_CONNECTORS_GRANT, ...singles]);
  } else {
    push('agent', 'settings.bot.perm.group.agent', ['shell']);
  }
  push('manage', 'settings.bot.perm.group.manage', ['admin']);
  return groups;
}

/**
 * Adds one grant. All connectors replaces the single ones it already covers; shell brings agent
 * with it, because it only exists on the agent kit — a shell chip that did nothing would lie.
 */
export function addGrant(grants: readonly BotGrant[], grant: BotGrant): BotGrant[] {
  const kept = grant === ALL_CONNECTORS_GRANT
    ? grants.filter((existing) => connectorIdOf(existing) === null)
    : grants;
  const added: BotGrant[] = grant === 'shell' ? ['agent', 'shell'] : [grant];
  return sortBotGrants([...new Set<BotGrant>([...kept, ...added])]);
}

/** Removes one grant; taking agent away takes shell with it, for the same reason. */
export function removeGrant(grants: readonly BotGrant[], grant: BotGrant): BotGrant[] {
  return grants.filter((existing) => existing !== grant && !(grant === 'agent' && existing === 'shell'));
}

function sameGrants(a: readonly BotGrant[], b: readonly BotGrant[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = sortBotGrants(a);
  const sortedB = sortBotGrants(b);
  return sortedA.every((grant, index) => grant === sortedB[index]);
}

/**
 * Optimistic edits the saved snapshot has caught up with are dropped; the rest stay until their
 * save answers. Returns the same object when nothing settled, so React can skip a render.
 */
export function pruneSettledGrants(
  pending: Readonly<Record<string, BotGrant[]>>,
  saved: Readonly<Record<string, BotGrant[]>> | undefined,
): Record<string, BotGrant[]> {
  const settled = Object.keys(pending).filter((userId) => sameGrants(pending[userId], saved?.[userId] ?? []));
  if (settled.length === 0) return pending as Record<string, BotGrant[]>;
  const next = { ...pending };
  for (const userId of settled) delete next[userId];
  return next;
}

/** One paired account as every read-only "who can use" view sees it. */
export interface BotRosterAccount {
  platform: BotPlatform;
  userId: string;
  label: string;
  isOwner: boolean;
  grants: BotGrant[];
}

export interface BotRoster {
  accounts: BotRosterAccount[];
  enabled: Record<BotPlatform, boolean>;
}

export interface BotRosterInput {
  telegram: TelegramSettingsSnapshot | null | undefined;
  line: LineSettingsSnapshot | null | undefined;
  botSelf: UserMemoryBotSelf | null | undefined;
  t: Translate;
}

/** Every paired account on both platforms with its saved grants and its owner mark. */
export function buildBotRoster({ telegram, line, botSelf, t }: BotRosterInput): BotRoster {
  const accounts: BotRosterAccount[] = [];
  for (const user of telegram?.pairing.pairedUsers ?? []) {
    const userId = String(user.userId);
    accounts.push({
      platform: 'telegram',
      userId,
      label: telegramAccountLabel(user, t),
      isOwner: botSelf?.telegram.includes(userId) ?? false,
      grants: normalizeGrantList(telegram?.permissions?.[userId], 'telegram'),
    });
  }
  for (const user of line?.pairing.pairedUsers ?? []) {
    accounts.push({
      platform: 'line',
      userId: user.userId,
      label: lineAccountLabel(user, t),
      isOwner: botSelf?.line.includes(user.userId) ?? false,
      grants: normalizeGrantList(line?.permissions?.[user.userId], 'line'),
    });
  }
  return { accounts, enabled: { telegram: telegram?.enabled ?? false, line: line?.enabled ?? false } };
}

export interface WhoCanUse {
  /** At least one owner account is on a running bot. */
  owner: boolean;
  /** The other accounts holding the grant, deduplicated by label. */
  labels: string[];
}

/**
 * Who on a switched-on bot can use one capability in a private chat: the owner (who has every
 * grant but admin) and the accounts granted it. `connector:<id>` counts `connector:*` holders.
 */
export function whoCanUse(roster: BotRoster, grant: BotGrant): WhoCanUse {
  let owner = false;
  const labels: string[] = [];
  for (const account of roster.accounts) {
    if (!roster.enabled[account.platform] || !isGrantAvailableOn(grant, account.platform)) continue;
    if (account.isOwner && !isExplicitGrant(grant)) {
      owner = true;
      continue;
    }
    if (grantAllows(account.grants, grant) && !labels.includes(account.label)) labels.push(account.label);
  }
  return { owner, labels };
}

export function whoCanUseBuiltin(roster: BotRoster, key: BotBuiltinCommandKey): WhoCanUse {
  return whoCanUse(roster, builtinCommandGrant(key));
}

/** Names listed before the rest is summarised as "and N more". */
export const WHO_MAX_NAMES = 3;

export type WhoCaptionKind = 'command' | 'connector';

const CAPTION_KEYS: Record<WhoCaptionKind, { list: string; ownerOnly: string; nobody: string }> = {
  command: {
    list: 'settings.bot.perm.who.command',
    ownerOnly: 'settings.bot.perm.who.command.ownerOnly',
    nobody: 'settings.bot.perm.who.command.nobody',
  },
  connector: {
    list: 'settings.bot.perm.who.connector',
    ownerOnly: 'settings.bot.perm.who.connector.ownerOnly',
    nobody: 'settings.bot.perm.who.connector.nobody',
  },
};

/** The caption text: "Owner, Ann, Bob and 2 more", or the owner-only / nobody sentence. */
export function whoCanUseText(who: WhoCanUse, kind: WhoCaptionKind, t: Translate): string {
  const keys = CAPTION_KEYS[kind];
  const names = [...(who.owner ? [t('settings.bot.perm.who.owner')] : []), ...who.labels];
  if (names.length === 0) return t(keys.nobody);
  if (who.labels.length === 0) return t(keys.ownerOnly);
  const shown = names.slice(0, WHO_MAX_NAMES).join(t('settings.bot.perm.who.separator'));
  const rest = names.length - WHO_MAX_NAMES;
  const list = rest > 0
    ? t('settings.bot.perm.who.more').replace('{{names}}', shown).replace('{{count}}', String(rest))
    : shown;
  return t(keys.list).replace('{{names}}', list);
}

/** The owner accounts, for the memory page's read-only line: "Ann (Telegram)". */
export function ownerAccountLabels(roster: BotRoster, t: Translate): string[] {
  return roster.accounts
    .filter((account) => account.isOwner)
    .map((account) => t('settings.bot.perm.ownerAccount')
      .replace('{{name}}', account.label)
      .replace('{{platform}}', account.platform === 'telegram' ? 'Telegram' : 'LINE'));
}

/** Whether either bot is switched on; connector captions only appear then. */
export function anyBotEnabled(roster: BotRoster): boolean {
  return roster.enabled.telegram || roster.enabled.line;
}

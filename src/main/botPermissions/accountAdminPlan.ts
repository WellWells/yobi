/**
 * The platform-neutral half of managing accounts from a chat card (`/users`, a pairing request's
 * card): which grants a card toggles and in which order (a button names its grant by index here,
 * never by name), who may press what (`accountAuthority`, `mayToggleGrant`), the button payload,
 * and what a press does against the account as it is now (`applyAccountPress`). Telegram and LINE
 * draw their own cards and answer in their own way; the decisions are made once, here.
 */
import {
  ALL_CONNECTORS_GRANT,
  CONNECTOR_GRANT_PREFIX,
  connectorGrant,
  isDefaultableGrant,
  sortBotGrants,
} from '../../shared/botPermissions';
import type { BotApprovePairingResult, BotGrant } from '../../shared/botPermissions';
import { BUILTIN_CONNECTORS, BUILTIN_PTT_SERVER_ID, PUBLIC_DATA_CONNECTOR_IDS } from '../../shared/builtinConnectors';
import { clipLine } from '../../shared/textBudget';

/** Built-in connectors added after the preview grant (2026-10-23), in the order they came. */
const LATER_CONNECTORS: readonly string[] = [BUILTIN_PTT_SERVER_ID];

/**
 * Every grant a card may toggle, in a fixed order: a toggle names its grant by index here. Shell
 * and admin are never in it (`isDefaultableGrant`): shell is changed on the computer only, admin
 * has a button of its own that only the owner sees (Telegram). Added servers are left to settings.
 * A grant added later goes last, so a card sent before it still names the same grant by each
 * index; the card shows them in display order (`visibleGrantToggles`).
 */
export const ACCOUNT_GRANT_CANDIDATES: readonly BotGrant[] = ([
  'agent', 'web', 'download', 'local', ALL_CONNECTORS_GRANT,
  ...BUILTIN_CONNECTORS.filter((connector) => !LATER_CONNECTORS.includes(connector.id)).map((connector) => connectorGrant(connector.id)),
  'preview',
  ...LATER_CONNECTORS.map(connectorGrant),
] as BotGrant[]).filter(isDefaultableGrant);

/** Where each candidate shows on a card: the display order of every grant list. */
const DISPLAY_ORDER: readonly BotGrant[] = sortBotGrants(ACCOUNT_GRANT_CANDIDATES);

/** What a manager who is not the owner may hand out: nothing that reads this computer or private data. */
const NON_OWNER_GRANTS: ReadonlySet<BotGrant> = new Set<BotGrant>([
  'agent', 'web', 'download', 'preview',
  ...PUBLIC_DATA_CONNECTOR_IDS.map((id) => connectorGrant(id)),
]);

/** How many of each kind a list shows; the rest are left to the settings page. */
export const LISTED_PAIRED_MAX = 60;
export const LISTED_REQUESTS_MAX = 20;

const MAX_NAME_CHARS = 40;

/** One account as a card shows it. `requested`: asked in a private chat and waits; `none`: nothing on file. */
export interface ManagedAccount {
  id: string;
  /** The name they gave the platform; can be anything, so the id comes with it. */
  name: string;
  username?: string;
  state: 'requested' | 'paired' | 'blocked' | 'none';
  /** Marked as "me" (paired only). */
  owner: boolean;
  /** The memory file could not be read, so whether this is the owner's account is unknown. */
  ownerUnknown?: boolean;
  /** Holds the admin grant (paired only; Telegram only). */
  admin: boolean;
  grants: readonly BotGrant[];
  /** An allowed group where they used the bot, and how often they used it at all. */
  usedIn?: { group: string; count: number };
}

export type AccountAdminAction =
  | { op: 'list' }
  | { op: 'view' | 'approve' | 'block' | 'unblock' | 'admin' | 'unpairAsk' | 'unpair'; userId: string }
  | { op: 'toggle'; userId: string; index: number };

const OPS = {
  v: 'view', a: 'approve', b: 'block', u: 'unblock', m: 'admin', x: 'unpairAsk', y: 'unpair', t: 'toggle',
} as const;

/** A button's payload after the platform's prefix: `<op>:<id>[:<index>]`, or `l` for the list. */
export function accountActionPayload(action: AccountAdminAction): string {
  if (action.op === 'list') return 'l';
  const code = (Object.keys(OPS) as Array<keyof typeof OPS>).find((key) => OPS[key] === action.op);
  const base = `${code}:${action.userId}`;
  return action.op === 'toggle' ? `${base}:${action.index}` : base;
}

/**
 * Reads a payload back; null for anything this module did not write. `userIdPattern` is the
 * platform's id shape; `adminGrant: false` (LINE) refuses the admin toggle outright.
 */
export function parseAccountActionPayload(
  payload: string,
  options: { userIdPattern: RegExp; adminGrant: boolean },
): AccountAdminAction | null {
  const [code, userId, index, ...rest] = payload.split(':');
  if (rest.length > 0) return null;
  if (code === 'l') return userId === undefined ? { op: 'list' } : null;
  if (!userId || !options.userIdPattern.test(userId)) return null;
  if (code === 't') {
    if (!index || !/^\d{1,2}$/.test(index)) return null;
    return { op: 'toggle', userId, index: Number(index) };
  }
  // Own keys only: `in` would also accept `constructor`, `toString`, `__proto__`… from the prototype.
  if (index !== undefined || !Object.hasOwn(OPS, code)) return null;
  const op = OPS[code as keyof typeof OPS] as Exclude<AccountAdminAction['op'], 'list' | 'toggle'>;
  return op === 'admin' && !options.adminGrant ? null : { op, userId };
}

/** Who is pressing: their id and whether they are the owner ("me"). */
export interface AccountActor {
  id: string;
  owner: boolean;
}

/**
 * What an actor may do to one account. Any manager answers a request (allow, block, unblock) and
 * edits or unpairs an account that is neither the owner's nor an admin's; only the owner touches
 * an admin's account or the admin grant. Nobody edits the owner's account or their own from here,
 * and while the memory file is unreadable (the owner unknown) nobody but a known owner edits any.
 */
export function accountAuthority(actor: AccountActor, target: ManagedAccount): {
  answer: boolean;
  edit: boolean;
  toggleAdmin: boolean;
  /** Why a paired account is read-only, as an i18n key; empty when it is not. */
  readOnly: string;
} {
  if (target.state !== 'paired') return { answer: true, edit: false, toggleAdmin: false, readOnly: '' };
  let readOnly = '';
  if (target.owner) readOnly = 'telegram.users.card.ownerReadOnly';
  else if (target.ownerUnknown && !actor.owner) readOnly = 'telegram.users.card.ownerUnknown';
  else if (target.id === actor.id) readOnly = 'telegram.users.card.selfReadOnly';
  else if (target.admin && !actor.owner) readOnly = 'telegram.users.card.adminReadOnly';
  const edit = !readOnly;
  return { answer: false, edit, toggleAdmin: edit && actor.owner, readOnly };
}

/**
 * Whether this actor may switch this grant on anyone: the owner any candidate; another manager
 * only agent, web, download, the preview and the public-data connectors — never reading this computer or a
 * private connector (an admin could otherwise hand those to a friend).
 */
export function mayToggleGrant(actor: AccountActor, grant: BotGrant): boolean {
  if (!ACCOUNT_GRANT_CANDIDATES.includes(grant)) return false;
  return actor.owner || NON_OWNER_GRANTS.has(grant);
}

/** The built-in connector a grant names, or '' (not a connector grant, or all of them). */
export function grantConnectorId(grant: BotGrant): string {
  return grant.startsWith(CONNECTOR_GRANT_PREFIX) && grant !== ALL_CONNECTORS_GRANT
    ? grant.slice(CONNECTOR_GRANT_PREFIX.length)
    : '';
}

/**
 * The toggles a card shows the actor, with their index: what they may toggle, and a switched-off
 * connector only while the account has it (to take it away).
 */
export function visibleGrantToggles(
  actor: AccountActor,
  grants: readonly BotGrant[],
  isConnectorOn: (serverId: string) => boolean,
): Array<{ grant: BotGrant; index: number; on: boolean }> {
  const has = new Set(grants);
  return ACCOUNT_GRANT_CANDIDATES.flatMap((grant, index) => {
    if (!mayToggleGrant(actor, grant)) return [];
    const connector = grantConnectorId(grant);
    if (connector && !has.has(grant) && !isConnectorOn(connector)) return [];
    return [{ grant, index, on: has.has(grant) }];
  }).sort((a, b) => DISPLAY_ORDER.indexOf(a.grant) - DISPLAY_ORDER.indexOf(b.grant));
}

/**
 * A grant list with one grant switched. Shell is never touched from a card. The preview does
 * nothing without the downloader: switching it on brings the downloader, switching the
 * downloader off takes the preview with it.
 */
export function toggledGrants(grants: readonly BotGrant[], grant: BotGrant): BotGrant[] {
  if (grants.includes(grant)) {
    return sortBotGrants(grants.filter((g) => g !== grant && !(grant === 'download' && g === 'preview')));
  }
  const added: BotGrant[] = grant === 'preview' ? ['download', 'preview'] : [grant];
  return sortBotGrants([...new Set<BotGrant>([...grants, ...added])]);
}

export function accountName(account: Pick<ManagedAccount, 'id' | 'name' | 'username'>): string {
  const name = account.name.trim() || (account.username ? `@${account.username}` : `ID ${account.id}`);
  return clipLine(name, MAX_NAME_CHARS);
}

/**
 * What a list shows: paired accounts first (capped), then waiting requests (capped lower), and
 * how many of each were left out — so a flood of requests cannot hide the paired accounts.
 */
export function accountListPlan(
  accounts: readonly ManagedAccount[],
  limits: { paired: number; requests: number } = { paired: LISTED_PAIRED_MAX, requests: LISTED_REQUESTS_MAX },
): { shown: ManagedAccount[]; morePaired: number; moreRequests: number } {
  const paired = accounts.filter((a) => a.state === 'paired');
  const requests = accounts.filter((a) => a.state === 'requested');
  return {
    shown: [...paired.slice(0, limits.paired), ...requests.slice(0, limits.requests)],
    morePaired: Math.max(0, paired.length - limits.paired),
    moreRequests: Math.max(0, requests.length - limits.requests),
  };
}

/** The writes a press may make — each the settings page's own — and what it checks them against. */
export interface AccountWrites {
  approve: (userId: string) => Promise<BotApprovePairingResult>;
  setBlocked: (userId: string, blocked: boolean) => Promise<boolean>;
  /** `setBotPermissions`; false = not saved. */
  setGrants: (userId: string, grants: BotGrant[]) => boolean;
  unpair: (userId: string) => Promise<boolean>;
  /** Whether a built-in connector is switched on; an off one is never granted from a card. */
  isConnectorOn: (serverId: string) => boolean;
}

/** What to show after a press: the account's card, the unpair confirmation, or the list. */
export interface AccountPressOutcome {
  /** An i18n key saying what happened. */
  toast?: string;
  /** Telegram shows it as an alert; LINE shows every outcome the same way. */
  alert?: boolean;
  view: 'card' | 'confirm' | 'list';
}

const APPROVE_REFUSALS: Readonly<Record<string, string>> = {
  blocked: 'telegram.users.toast.blocked',
  noRequest: 'telegram.users.toast.noRequest',
};

const refuse = (toast: string): AccountPressOutcome => ({ toast, alert: true, view: 'card' });

/** Why switching this grant on this account is refused, as an i18n key; '' = it may be switched. */
function grantRefusal(actor: AccountActor, target: ManagedAccount, grant: BotGrant, writes: AccountWrites): string {
  if (!mayToggleGrant(actor, grant)) return 'telegram.users.toast.notAllowed';
  const has = target.grants.includes(grant);
  // The card says shell is changed on the computer only, and settings takes shell away with agent.
  if (grant === 'agent' && has && target.grants.includes('shell')) return 'telegram.users.toast.shellNeedsAgent';
  const connector = grantConnectorId(grant);
  if (connector && !has && !writes.isConnectorOn(connector)) return 'telegram.users.toast.connectorOff';
  return '';
}

/**
 * What a press does, against the account as it is now — another manager or the settings page
 * may have answered the request or changed the account since the card was drawn, so a stale or
 * forged button writes nothing. `log` gets one line per write made.
 */
export async function applyAccountPress(
  action: Exclude<AccountAdminAction, { op: 'list' }>,
  target: ManagedAccount,
  actor: AccountActor,
  writes: AccountWrites,
  log: (message: string) => void,
): Promise<AccountPressOutcome> {
  const rights = accountAuthority(actor, target);
  const by = `by ${actor.id}`;
  switch (action.op) {
    case 'view':
      return { view: 'card' };
    case 'approve': {
      if (target.state === 'paired') return { toast: 'telegram.users.toast.alreadyPaired', view: 'card' };
      const result = await writes.approve(target.id);
      if (!result.ok) return refuse(APPROVE_REFUSALS[result.reason] ?? 'telegram.users.toast.failed');
      log(`pairing request of ${target.id} approved ${by}`);
      return { toast: result.newlyPaired ? 'telegram.users.toast.approved' : 'telegram.users.toast.alreadyPaired', view: 'card' };
    }
    case 'block':
    case 'unblock': {
      if (target.state === 'paired') return refuse('telegram.users.toast.pairedNotBlocked');
      const blocked = action.op === 'block';
      if ((target.state === 'blocked') === blocked) return { view: 'card' };
      if (!(await writes.setBlocked(target.id, blocked))) return refuse('telegram.users.toast.failed');
      log(`user ${target.id} ${blocked ? 'blocked' : 'unblocked'} ${by}`);
      return { toast: blocked ? 'telegram.users.toast.blockedDone' : 'telegram.users.toast.unblocked', view: 'card' };
    }
    case 'toggle':
    case 'admin': {
      if (target.state !== 'paired') return refuse('telegram.users.toast.notPaired');
      if (!(action.op === 'admin' ? rights.toggleAdmin : rights.edit)) return refuse('telegram.users.toast.notAllowed');
      const grant: BotGrant | undefined = action.op === 'toggle' ? ACCOUNT_GRANT_CANDIDATES[action.index] : 'admin';
      if (!grant) return { view: 'card' };
      const refusal = action.op === 'toggle' ? grantRefusal(actor, target, grant, writes) : '';
      if (refusal) return refuse(refusal);
      if (!writes.setGrants(target.id, toggledGrants(target.grants, grant))) return refuse('telegram.users.toast.failed');
      log(`grant ${grant} of ${target.id} switched ${by}`);
      return { toast: 'telegram.users.toast.saved', view: 'card' };
    }
    case 'unpairAsk':
      if (target.state !== 'paired') return refuse('telegram.users.toast.notPaired');
      return rights.edit ? { view: 'confirm' } : refuse('telegram.users.toast.notAllowed');
    case 'unpair': {
      if (target.state !== 'paired') return { toast: 'telegram.users.toast.notPaired', view: 'list' };
      if (!rights.edit) return refuse('telegram.users.toast.notAllowed');
      if (!(await writes.unpair(target.id))) return refuse('telegram.users.toast.failed');
      log(`user ${target.id} unpaired ${by}`);
      return { toast: 'telegram.users.toast.unpaired', view: 'list' };
    }
  }
}

/** The pressing manager as an actor: the owner mark comes from their own account as it is now. */
export async function accountActorOf(
  actorId: string,
  getAccount: (userId: string) => Promise<ManagedAccount | null>,
): Promise<AccountActor> {
  const self = await getAccount(actorId);
  return { id: actorId, owner: self?.state === 'paired' && self.owner };
}

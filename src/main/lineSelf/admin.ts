/**
 * Managing the LINE PC bot from LINE itself: `Yobi /users` and `Yobi /groups` as numbered menus —
 * a personal account cannot send buttons or cards, so every choice is a line (`/users t:<id>:<n>`)
 * that a typed number picks (`numberedMenu`, `dispatchButtonLine`). A pairing request is posted the
 * same way into the owner's one-person group, with "allow" and "block" as its numbers.
 *
 * Where: the owner in their one-person group (the runtime gives it the owner's id as its chat id),
 * an admin's `/users` in their own 1:1 chat with the owner (its chat id is their id) — nowhere others read
 * the roster's names, ids and grants. Every line is checked again when it comes in, numbered or
 * typed: who sent it, where, and the account or group as it is now (`applyAccountPress`,
 * `planGroupChange`), so a stale or forged number writes nothing it should not. LINE PC's groups
 * never wait for approval, so `/groups` only toggles what a group grants everyone in it — and it is
 * the owner's alone: it lists every chat Yobi was used in, and every answer in a group goes from
 * the owner's own account, so only they choose which groups it answers.
 */
import { t } from '../i18n';
import { CONNECTOR_GRANT_PREFIX } from '../../shared/botPermissions';
import type { BotGroupGrant } from '../../shared/botPermissions';
import { BUILTIN_CONNECTOR_TITLES } from '../../shared/builtinConnectors';
import { clipLine } from '../../shared/textBudget';
import { accountGrantLabel, accountListItemKey, accountListMoreLines } from '../botPermissions/accountAdminLabels';
import {
  accountActionPayload,
  accountActorOf,
  accountAuthority,
  accountListPlan,
  accountName,
  applyAccountPress,
  parseAccountActionPayload,
  visibleGrantToggles,
} from '../botPermissions/accountAdminPlan';
import type { AccountActor, AccountAdminAction, AccountWrites, ManagedAccount } from '../botPermissions/accountAdminPlan';
import { GROUP_GRANT_CANDIDATES, planGroupChange } from '../botPermissions/groupAdminPlan';
import type { ManagedGroup } from '../botPermissions/groupAdminPlan';
import { parseBotCommand } from '../botChat/commands';
import type { BotChatEvent } from '../botChat/types';
import { CHECKED, UNCHECKED } from '../line/flexParts';
import { isLineDirectChat } from './chats';

/** What the menus read and write: the settings page's own writes. */
export interface LineSelfAdminSource extends AccountWrites {
  /** Paired accounts, then waiting requests. */
  listAccounts: () => Promise<ManagedAccount[]>;
  /** One account as it is now; null = an id the bot knows nothing of. */
  getAccount: (userId: string) => Promise<ManagedAccount | null>;
  /** The groups Yobi was used in (the settings page's list). */
  listGroups: () => Promise<ManagedGroup[]>;
  /** What a group grants everyone in it (`setBotGroupPermissions`); false = not saved. */
  setGroupGrants: (chatId: string, grants: BotGroupGrant[]) => boolean;
}

/** A menu: its words, then one numbered choice per line it stands for. */
export interface LineSelfAdminMessage {
  text: string;
  buttons: Array<{ label: string; line: string }>;
}

export interface LineSelfAdminDeps {
  /** Absent = the setup gave none: nobody manages from LINE. Read each time. */
  source: () => LineSelfAdminSource | undefined;
  ownMid: () => string;
  /** An admin (the owner or the admin grant, paired) where they count as one (`botFlowAdminAllowed`). */
  isFlowAdmin: (chatId: string, userId: string) => Promise<boolean>;
  getStrings: () => Record<string, string>;
  /** A menu, answering (quoting) the line that asked. */
  send: (event: BotChatEvent, message: LineSelfAdminMessage) => Promise<void>;
  reply: (event: BotChatEvent, text: string) => Promise<void>;
  onLog: (message: string) => void;
}

export interface LineSelfAdmin {
  users: (event: BotChatEvent) => Promise<void>;
  groups: (event: BotChatEvent) => Promise<void>;
  /**
   * The message a new pairing request posts into the owner's one-person group: "allow" and "block"
   * as its numbers, or — `numbered` false, when another menu there is still open — no numbers and
   * a line saying to send `Yobi /users`.
   */
  requestNotice: (user: { userId: string; displayName?: string }, group?: { title: string }, numbered?: boolean) => LineSelfAdminMessage;
}

/** LINE PC's people are `u` and 32 hex digits; its groups `c` and 32. */
/**
 * The management commands no admin but the owner may use (`/help` lists them to the owner only):
 * `/groups` lists every chat Yobi was used in and decides where the owner's own account answers.
 */
export const LINE_SELF_OWNER_ONLY_COMMANDS: ReadonlySet<string> = new Set(['groups']);

const USER_ID = /^u[0-9a-f]{32}$/u;
const GROUP_PAYLOAD = /^(?:v:(c[0-9a-f]{32})|t:(c[0-9a-f]{32}):(\d{1,2}))$/u;

/** How many of each kind one message lists; the rest are left to the settings page. */
const LISTED = { paired: 20, requests: 10 } as const;
const LISTED_GROUPS = 30;
/** A group's name on one line; a person's is `accountName`'s (one line, long enough for "ID u…"). */
const MAX_NAME_CHARS = 30;

type Choices = LineSelfAdminMessage['buttons'];

const usersLine = (action: AccountAdminAction): string => `/users ${accountActionPayload(action)}`;
const joined = (...lines: Array<string | undefined>): string => lines.filter(Boolean).join('\n');
const groupName = (group: ManagedGroup): string => clipLine(group.title?.trim() || group.id, MAX_NAME_CHARS);

function groupGrantLabel(grant: BotGroupGrant, s: Record<string, string>): string {
  if (!grant.startsWith(CONNECTOR_GRANT_PREFIX)) return t(s, `telegram.groups.grant.${grant}`);
  const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
  const key = BUILTIN_CONNECTOR_TITLES[id];
  return key ? t(s, key) : id;
}

function accountList(accounts: readonly ManagedAccount[], s: Record<string, string>, notice?: string): LineSelfAdminMessage {
  if (accounts.length === 0) return { text: joined(notice, t(s, 'telegram.users.list.none')), buttons: [] };
  const plan = accountListPlan(accounts, LISTED);
  return {
    text: joined(notice, t(s, 'bot.lineSelf.admin.usersTitle'), ...accountListMoreLines(plan, s)),
    buttons: plan.shown.map((account) => ({
      label: t(s, accountListItemKey(account), { name: accountName(account) }),
      line: usersLine({ op: 'view', userId: account.id }),
    })),
  };
}

function pairedLines(account: ManagedAccount, actor: AccountActor, isConnectorOn: (id: string) => boolean, s: Record<string, string>): { lines: string[]; choices: Choices } {
  const rights = accountAuthority(actor, account);
  const lines: string[] = [];
  const choices: Choices = [];
  if (account.owner) lines.push(t(s, 'telegram.users.card.ownerMark'));
  else if (account.admin) lines.push(t(s, 'telegram.users.card.adminMark'));
  if (account.grants.includes('shell')) lines.push(t(s, 'telegram.users.card.shellReadOnly'));
  if (rights.readOnly) return { lines: [...lines, t(s, rights.readOnly)], choices };
  lines.push(t(s, 'bot.lineSelf.admin.toggleHint'));
  for (const toggle of visibleGrantToggles(actor, account.grants, isConnectorOn)) {
    choices.push({
      label: `${toggle.on ? CHECKED : UNCHECKED} ${accountGrantLabel(toggle.grant, s)}`,
      line: usersLine({ op: 'toggle', userId: account.id, index: toggle.index }),
    });
  }
  if (rights.toggleAdmin) {
    choices.push({ label: `${account.admin ? CHECKED : UNCHECKED} ${t(s, 'telegram.users.grant.admin')}`, line: usersLine({ op: 'admin', userId: account.id }) });
  }
  choices.push({ label: t(s, 'telegram.users.btn.unpair'), line: usersLine({ op: 'unpairAsk', userId: account.id }) });
  return { lines, choices };
}

function accountCard(account: ManagedAccount, actor: AccountActor, isConnectorOn: (id: string) => boolean, s: Record<string, string>, notice?: string): LineSelfAdminMessage {
  const lines = [notice, t(s, `telegram.users.card.${account.state}`, { name: accountName(account) }), `ID ${account.id}`];
  let choices: Choices = [];
  const choice = (key: string, action: AccountAdminAction): Choices[number] => ({ label: t(s, key), line: usersLine(action) });
  if (account.state === 'requested') {
    if (account.usedIn) lines.push(t(s, 'telegram.users.card.usedInGroup', { group: account.usedIn.group, count: String(account.usedIn.count) }));
    lines.push(t(s, 'line.users.card.checkIdentity'));
    choices = [choice('telegram.users.btn.approve', { op: 'approve', userId: account.id }), choice('telegram.users.btn.block', { op: 'block', userId: account.id })];
  } else if (account.state === 'blocked') {
    choices = [choice('telegram.users.btn.unblock', { op: 'unblock', userId: account.id })];
  } else if (account.state === 'paired') {
    const paired = pairedLines(account, actor, isConnectorOn, s);
    lines.push(...paired.lines);
    choices = paired.choices;
  }
  return { text: joined(...lines), buttons: [...choices, choice('telegram.users.btn.back', { op: 'list' })] };
}

function unpairConfirm(account: ManagedAccount, s: Record<string, string>): LineSelfAdminMessage {
  return {
    text: t(s, 'telegram.users.confirm.unpair', { name: accountName(account) }),
    buttons: [
      { label: t(s, 'telegram.users.btn.unpairConfirm'), line: usersLine({ op: 'unpair', userId: account.id }) },
      { label: t(s, 'telegram.users.btn.cancel'), line: usersLine({ op: 'view', userId: account.id }) },
    ],
  };
}

function groupList(groups: readonly ManagedGroup[], s: Record<string, string>, notice?: string): LineSelfAdminMessage {
  if (groups.length === 0) return { text: joined(notice, t(s, 'bot.lineSelf.admin.noGroups')), buttons: [] };
  const more = groups.length > LISTED_GROUPS ? t(s, 'line.groups.list.more', { count: String(groups.length - LISTED_GROUPS) }) : undefined;
  return {
    text: joined(notice, t(s, 'bot.lineSelf.admin.groupsTitle'), more),
    buttons: groups.slice(0, LISTED_GROUPS).map((group) => ({ label: groupName(group), line: `/groups v:${group.id}` })),
  };
}

function groupCard(group: ManagedGroup, isConnectorOn: (id: string) => boolean, s: Record<string, string>, notice?: string): LineSelfAdminMessage {
  const has = new Set(group.grants);
  const buttons: Choices = GROUP_GRANT_CANDIDATES.flatMap((grant, index) => {
    const connector = grant.startsWith(CONNECTOR_GRANT_PREFIX) ? grant.slice(CONNECTOR_GRANT_PREFIX.length) : '';
    if (connector && !has.has(grant) && !isConnectorOn(connector)) return [];
    return [{ label: `${has.has(grant) ? CHECKED : UNCHECKED} ${groupGrantLabel(grant, s)}`, line: `/groups t:${group.id}:${index}` }];
  });
  buttons.push({ label: t(s, 'telegram.groups.btn.back'), line: '/groups l' });
  return { text: joined(notice, t(s, 'bot.lineSelf.admin.groupCard', { name: groupName(group) }), t(s, 'bot.lineSelf.admin.groupHint')), buttons };
}

export function createLineSelfAdmin(deps: LineSelfAdminDeps): LineSelfAdmin {
  const { onLog } = deps;

  /** The source, when this person may manage from this chat; otherwise says why and gives none. */
  async function managing(event: BotChatEvent, command: 'users' | 'groups'): Promise<LineSelfAdminSource | null> {
    const s = deps.getStrings();
    const source = deps.source();
    const own = deps.ownMid();
    const admin = Boolean(source && own) && (await deps.isFlowAdmin(event.userId, event.userId).catch(() => false));
    if (!source || !admin) {
      onLog(`[lineSelf] /${command} refused for ${event.userId} — not an admin`);
      await deps.reply(event, t(s, 'bot.lineSelf.admin.notAllowed'));
      return null;
    }
    const owner = event.userId === own;
    if (LINE_SELF_OWNER_ONLY_COMMANDS.has(command) && !owner) {
      onLog(`[lineSelf] /groups refused for ${event.userId} — the owner's alone`);
      await deps.reply(event, t(s, 'bot.lineSelf.admin.groupsOwnerOnly'));
      return null;
    }
    const ownChat = event.chatKind === 'user' && event.chatId === event.userId && (owner || isLineDirectChat(event.chatId));
    if (!ownChat) {
      onLog(`[lineSelf] /${command} refused for ${event.userId} in ${event.chatId} — others read that chat`);
      await deps.reply(event, t(s, owner ? 'bot.lineSelf.admin.ownGroupOnly' : 'bot.lineSelf.admin.adminChatOnly'));
      return null;
    }
    return source;
  }

  async function users(event: BotChatEvent): Promise<void> {
    const source = await managing(event, 'users');
    if (!source) return;
    const s = deps.getStrings();
    const argument = parseBotCommand(event.text)?.argument ?? '';
    const action = argument ? parseAccountActionPayload(argument, { userIdPattern: USER_ID, adminGrant: true }) : { op: 'list' as const };
    if (!action) onLog(`[lineSelf] /users from ${event.userId} with a choice no menu sends — the list instead`);
    if (!action || action.op === 'list') {
      await deps.send(event, accountList(await source.listAccounts(), s));
      return;
    }
    const target = await source.getAccount(action.userId);
    if (!target) {
      await deps.send(event, accountList(await source.listAccounts(), s, t(s, 'telegram.users.toast.gone')));
      return;
    }
    const actor = await accountActorOf(event.userId, source.getAccount);
    const outcome = await applyAccountPress(action, target, actor, source, (message) => onLog(`[lineSelf] ${message} from LINE`));
    const notice = outcome.toast ? t(s, outcome.toast) : undefined;
    if (outcome.view === 'list') {
      await deps.send(event, accountList(await source.listAccounts(), s, notice));
      return;
    }
    const fresh = (await source.getAccount(target.id)) ?? target;
    await deps.send(event, outcome.view === 'confirm' ? unpairConfirm(fresh, s) : accountCard(fresh, actor, source.isConnectorOn, s, notice));
  }

  async function groups(event: BotChatEvent): Promise<void> {
    const source = await managing(event, 'groups');
    if (!source) return;
    const s = deps.getStrings();
    const argument = parseBotCommand(event.text)?.argument ?? '';
    const listed = await source.listGroups();
    const match = GROUP_PAYLOAD.exec(argument);
    if (!match) {
      if (argument && argument !== 'l') onLog(`[lineSelf] /groups from ${event.userId} with a choice no menu sends — the list instead`);
      await deps.send(event, groupList(listed, s));
      return;
    }
    const chatId = match[1] ?? match[2] ?? '';
    const group = listed.find((entry) => entry.id === chatId);
    if (!group) {
      await deps.send(event, groupList(listed, s, t(s, 'telegram.groups.toast.gone')));
      return;
    }
    let notice: string | undefined;
    if (match[3] !== undefined) {
      // LINE PC's groups never wait for approval: a toggle is the only change.
      const change = planGroupChange({ op: 'toggle', chatId, index: Number(match[3]) }, { ...group, pending: false });
      if (change.grants) {
        const saved = source.setGroupGrants(chatId, change.grants);
        if (saved) onLog(`[lineSelf] group ${chatId} now grants ${change.grants.length} thing(s), changed by ${event.userId} from LINE`);
        notice = t(s, saved ? change.done ?? 'telegram.groups.toast.saved' : 'telegram.groups.toast.failed');
      }
    }
    const fresh = (await source.listGroups()).find((entry) => entry.id === chatId) ?? group;
    await deps.send(event, groupCard(fresh, source.isConnectorOn, s, notice));
  }

  function requestNotice(user: { userId: string; displayName?: string }, group?: { title: string }, numbered = true): LineSelfAdminMessage {
    const s = deps.getStrings();
    const who = accountName({ id: user.userId, name: user.displayName ?? '' });
    const heading = group
      ? t(s, 'bot.lineSelf.admin.requestInGroup', { name: who, group: clipLine(group.title, MAX_NAME_CHARS) })
      : t(s, 'bot.lineSelf.admin.request', { name: who });
    const text = joined(heading, `ID ${user.userId}`, t(s, 'line.users.card.checkIdentity'));
    if (!numbered) return { text: joined(text, t(s, 'bot.lineSelf.admin.requestUseUsers')), buttons: [] };
    return {
      text,
      buttons: [
        { label: t(s, 'telegram.users.btn.approve'), line: usersLine({ op: 'approve', userId: user.userId }) },
        { label: t(s, 'telegram.users.btn.block'), line: usersLine({ op: 'block', userId: user.userId }) },
      ],
    };
  }

  return { users, groups, requestNotice };
}

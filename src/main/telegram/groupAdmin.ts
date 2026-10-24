/**
 * Managing the bot's groups from Telegram itself: `/groups` in an admin's private chat lists the
 * groups the bot is in, and each one opens a card with "Allow" (pending) or its grants as toggles
 * plus "Revoke" (allowed) — the same writes the settings page makes. When the bot is added to a
 * group, every admin gets that group's card in their private chat, so a phone is enough to allow it.
 *
 * An admin here is the owner ("me") or a Telegram admin-grant holder, still paired, in their own
 * private chat (`isFlowAdmin`). Every press is checked again: callback data comes back from the
 * client as it likes, so it only ever names a group and a grant, never a right.
 */
import { t } from '../i18n';
import { telegramCallbackData } from './callbackRouter';
import { BUILTIN_CONNECTOR_TITLES } from '../../shared/builtinConnectors';
import { CONNECTOR_GRANT_PREFIX } from '../../shared/botPermissions';
import { clipLine } from '../../shared/textBudget';
import type { BotGroupGrant } from '../../shared/botPermissions';
import { GROUP_GRANT_CANDIDATES, planGroupChange } from '../botPermissions/groupAdminPlan';
import type { GroupCardAction, ManagedGroup } from '../botPermissions/groupAdminPlan';
import type { TelegramCommandOptions, TelegramContext } from './commandHandlers';

export type { ManagedGroup } from '../botPermissions/groupAdminPlan';

/** Prefix of a group-management button's `callback_data`; flow and export buttons use their own. */
export const GROUP_ADMIN_CB_PREFIX = 'gm';

/** Telegram allows 100 buttons per keyboard; a longer list is cut (the settings page has them all). */
const MAX_LISTED_GROUPS = 60;
const MAX_TITLE_CHARS = 40;

const CHECKED = '☑';
const UNCHECKED = '☐';

/** What the runtime gives the group cards; absent = the command and buttons do nothing. */
export interface GroupAdminDeps {
  /** The groups the bot is in (the settings page's list). */
  listGroups: () => Promise<ManagedGroup[]>;
  /** Allows a group with these grants, or (`null`) puts it back to pending. False = not saved. */
  setGrants: (chatId: string, grants: BotGroupGrant[] | null) => boolean;
  /** Whether a built-in connector is switched on; an off one is offered only to take it away. */
  isConnectorOn: (serverId: string) => boolean;
  /** `getMe`'s `can_read_all_group_messages`; undefined while the bot is not running. */
  readsAllGroupMessages: () => boolean | undefined;
}

/** What the app gives the runtime; the runtime adds what only it knows (the bot's privacy mode). */
export type GroupAdminSource = Omit<GroupAdminDeps, 'readsAllGroupMessages'> & {
  /** The private chats that get a joined group's card: the owner and admin-grant holders, paired. */
  getManagerIds: () => Promise<number[]>;
};

type GroupAdminOptions = Pick<
  TelegramCommandOptions,
  'getStrings' | 'isPairedUser' | 'isFlowAdmin' | 'allowGroupCommands' | 'onLog' | 'groupAdmin'
>;

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface GroupAdminView {
  text: string;
  keyboard: { inline_keyboard: InlineButton[][] };
}

export type GroupAdminAction = GroupCardAction;

const OPS = { v: 'view', a: 'allow', r: 'revoke', t: 'toggle' } as const;

export function groupAdminCallbackData(action: GroupAdminAction): string {
  if (action.op === 'list') return telegramCallbackData(GROUP_ADMIN_CB_PREFIX, 'l');
  const code = (Object.keys(OPS) as Array<keyof typeof OPS>).find((key) => OPS[key] === action.op);
  const base = `${code}:${action.chatId}`;
  return telegramCallbackData(GROUP_ADMIN_CB_PREFIX, action.op === 'toggle' ? `${base}:${action.index}` : base);
}

export function parseGroupAdminCallback(data: string | undefined): GroupAdminAction | null {
  if (!data?.startsWith(`${GROUP_ADMIN_CB_PREFIX}:`)) return null;
  const [, code, chatId, index, ...rest] = data.split(':');
  if (rest.length > 0) return null;
  if (code === 'l') return chatId === undefined ? { op: 'list' } : null;
  if (!chatId || !/^-?\d{1,20}$/.test(chatId)) return null;
  if (code === 't') {
    if (!index || !/^\d{1,2}$/.test(index)) return null;
    return { op: 'toggle', chatId, index: Number(index) };
  }
  // Own keys only: `in` would also accept `constructor`, `toString`, `__proto__`… from the prototype.
  if (index !== undefined || !Object.hasOwn(OPS, code)) return null;
  return { op: OPS[code as keyof typeof OPS] as 'view' | 'allow' | 'revoke', chatId };
}

function groupName(group: Pick<ManagedGroup, 'id' | 'title'>): string {
  const title = group.title?.trim() || group.id;
  return clipLine(title, MAX_TITLE_CHARS);
}

function grantLabel(grant: BotGroupGrant, strings: Record<string, string>): string {
  if (!grant.startsWith(CONNECTOR_GRANT_PREFIX)) return t(strings, `telegram.groups.grant.${grant}`);
  const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
  const key = BUILTIN_CONNECTOR_TITLES[id];
  return key ? t(strings, key) : id;
}

export function groupListView(groups: readonly ManagedGroup[], strings: Record<string, string>): GroupAdminView {
  if (groups.length === 0) return { text: t(strings, 'telegram.groups.list.none'), keyboard: { inline_keyboard: [] } };
  const rows = groups.slice(0, MAX_LISTED_GROUPS).map((group) => [{
    text: t(strings, group.pending ? 'telegram.groups.list.pendingItem' : 'telegram.groups.list.allowedItem', { name: groupName(group) }),
    callback_data: groupAdminCallbackData({ op: 'view', chatId: group.id }),
  }]);
  return { text: t(strings, 'telegram.groups.list.title'), keyboard: { inline_keyboard: rows } };
}

export interface GroupCardEnv {
  strings: Record<string, string>;
  isConnectorOn: (serverId: string) => boolean;
  readsAllGroupMessages: boolean | undefined;
  allowGroupCommands: boolean;
}

/**
 * One group's card. `joined` words the header as the news that the bot was just added (the card
 * an admin receives unasked); the buttons are the same.
 */
export function groupCardView(group: ManagedGroup, env: GroupCardEnv, options: { joined?: boolean } = {}): GroupAdminView {
  const { strings } = env;
  const name = groupName(group);
  const lines: string[] = [];
  if (group.pending) {
    lines.push(t(strings, options.joined ? 'telegram.groups.card.joined' : 'telegram.groups.card.pending', { name }));
    lines.push(t(strings, 'telegram.groups.card.pendingDesc'));
  } else {
    lines.push(t(strings, 'telegram.groups.card.allowed', { name }));
    lines.push(t(strings, group.grants.length > 0 ? 'telegram.groups.card.allowedDesc' : 'telegram.groups.card.nothing'));
  }
  if (!env.allowGroupCommands) lines.push(t(strings, 'telegram.groups.card.groupsOff'));
  if (env.readsAllGroupMessages === false) lines.push(t(strings, 'telegram.groups.card.privacyHint'));

  const rows: InlineButton[][] = [];
  if (group.pending) {
    rows.push([{ text: t(strings, 'telegram.groups.btn.allow'), callback_data: groupAdminCallbackData({ op: 'allow', chatId: group.id }) }]);
  } else {
    const has = new Set(group.grants);
    GROUP_GRANT_CANDIDATES.forEach((grant, index) => {
      const connector = grant.startsWith(CONNECTOR_GRANT_PREFIX) ? grant.slice(CONNECTOR_GRANT_PREFIX.length) : '';
      if (connector && !has.has(grant) && !env.isConnectorOn(connector)) return;
      rows.push([{
        text: `${has.has(grant) ? CHECKED : UNCHECKED} ${grantLabel(grant, strings)}`,
        callback_data: groupAdminCallbackData({ op: 'toggle', chatId: group.id, index }),
      }]);
    });
    rows.push([{ text: t(strings, 'telegram.groups.btn.revoke'), callback_data: groupAdminCallbackData({ op: 'revoke', chatId: group.id }) }]);
  }
  rows.push([{ text: t(strings, 'telegram.groups.btn.back'), callback_data: groupAdminCallbackData({ op: 'list' }) }]);
  return { text: lines.join('\n\n'), keyboard: { inline_keyboard: rows } };
}

function cardEnv(options: GroupAdminOptions, deps: GroupAdminDeps): GroupCardEnv {
  return {
    strings: options.getStrings(),
    isConnectorOn: deps.isConnectorOn,
    readsAllGroupMessages: deps.readsAllGroupMessages(),
    allowGroupCommands: options.allowGroupCommands(),
  };
}

/** Admin, paired, in their own private chat — checked on every command and every press. */
async function isGroupManager(ctx: TelegramContext, options: GroupAdminOptions): Promise<boolean> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || chat?.type !== 'private' || chat.id !== from.id || !options.isPairedUser(from.id)) return false;
  return (await options.isFlowAdmin?.(from.id, chat.id)) === true;
}

export async function handleGroupsCommand(ctx: TelegramContext, options: GroupAdminOptions): Promise<void> {
  const s = options.getStrings();
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(s, 'telegram.cmd.accessDenied'));
    return;
  }
  if (ctx.chat?.type !== 'private') {
    await ctx.reply(t(s, 'telegram.cmd.adminPrivateOnly'));
    return;
  }
  if (!(await isGroupManager(ctx, options))) {
    await ctx.reply(t(s, 'telegram.cmd.adminOnly'));
    return;
  }
  const deps = options.groupAdmin;
  if (!deps) return;
  const view = groupListView(await deps.listGroups(), s);
  await ctx.reply(view.text, { reply_markup: view.keyboard });
}

/** A card shown in place of the pressed one; Telegram refuses an edit that changes nothing. */
async function showInPlace(ctx: TelegramContext, view: GroupAdminView, options: GroupAdminOptions): Promise<void> {
  try {
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('message is not modified')) options.onLog(`[telegram] could not update a group card: ${message}`);
  }
}

/**
 * A press on a group-management button. Returns false when the press is not one of ours, so the
 * next handler sees it.
 */
export async function handleGroupAdminCallback(ctx: TelegramContext, options: GroupAdminOptions): Promise<boolean> {
  const action = parseGroupAdminCallback(ctx.callbackQuery?.data);
  if (!action) return false;
  const s = options.getStrings();
  const deps = options.groupAdmin;
  if (!deps || !(await isGroupManager(ctx, options))) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.cmd.adminOnly'), show_alert: true });
    return true;
  }
  const groups = await deps.listGroups();
  if (action.op === 'list') {
    await ctx.answerCallbackQuery();
    await showInPlace(ctx, groupListView(groups, s), options);
    return true;
  }
  const group = groups.find((entry) => entry.id === action.chatId);
  if (!group) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.groups.toast.gone'), show_alert: true });
    await showInPlace(ctx, groupListView(groups, s), options);
    return true;
  }

  const change = planGroupChange(action, group);
  if (change.refusal) {
    await ctx.answerCallbackQuery({ text: t(s, change.refusal) });
  } else if (change.grants !== undefined) {
    if (!deps.setGrants(group.id, change.grants)) {
      await ctx.answerCallbackQuery({ text: t(s, 'telegram.groups.toast.failed'), show_alert: true });
      return true;
    }
    options.onLog(`[telegram] group ${group.id} ${change.grants === null ? 'put back to pending' : `allowed (${change.grants.length} grant(s))`} from Telegram`);
    await ctx.answerCallbackQuery({ text: t(s, change.done ?? 'telegram.groups.toast.saved') });
  } else {
    await ctx.answerCallbackQuery();
  }
  const fresh = (await deps.listGroups()).find((entry) => entry.id === group.id) ?? group;
  await showInPlace(ctx, groupCardView(fresh, cardEnv(options, deps)), options);
  return true;
}

/**
 * Sends the card of a group the bot was just added to, to every admin's private chat. Returns
 * how many got it; one that cannot be reached (never started the bot, blocked it) is logged.
 */
export async function offerGroupApproval(
  send: (chatId: number, view: GroupAdminView) => Promise<unknown>,
  group: { id: string; title?: string },
  managerIds: readonly number[],
  env: GroupCardEnv,
  onLog: (message: string) => void,
): Promise<number> {
  const view = groupCardView({ ...group, pending: true, grants: [] }, env, { joined: true });
  let sent = 0;
  for (const managerId of managerIds) {
    try {
      await send(managerId, view);
      sent += 1;
    } catch (err: unknown) {
      onLog(`[telegram] could not tell admin ${managerId} about group ${group.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return sent;
}

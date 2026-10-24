/**
 * What `/users` and a pairing request's card show on Telegram: the button data and the text, pure.
 * Who may press what is decided in `botPermissions/accountAdminPlan.ts`, which the views and the
 * handler both read, so a card never offers a button the press would then refuse.
 */
import { t } from '../i18n';
import { telegramCallbackData } from './callbackRouter';
import { accountGrantLabel as grantLabel, accountListItemKey, accountListMoreLines } from '../botPermissions/accountAdminLabels';
import {
  accountActionPayload,
  accountAuthority,
  accountListPlan,
  accountName,
  parseAccountActionPayload,
  visibleGrantToggles,
} from '../botPermissions/accountAdminPlan';
import type { AccountActor, AccountAdminAction, ManagedAccount } from '../botPermissions/accountAdminPlan';
import type { GroupAdminView, InlineButton } from './groupAdmin';

export {
  ACCOUNT_GRANT_CANDIDATES,
  accountAuthority,
  accountName,
  mayToggleGrant,
  toggledGrants,
} from '../botPermissions/accountAdminPlan';
export type { AccountActor, AccountAdminAction, ManagedAccount } from '../botPermissions/accountAdminPlan';

/** Prefix of an account-management button's `callback_data`; groups use `gm`. */
export const ACCOUNT_ADMIN_CB_PREFIX = 'ua';

const CHECKED = '☑';
const UNCHECKED = '☐';

const TELEGRAM_USER_ID = /^\d{1,20}$/;

export function accountAdminCallbackData(action: AccountAdminAction): string {
  return telegramCallbackData(ACCOUNT_ADMIN_CB_PREFIX, accountActionPayload(action));
}

export function parseAccountAdminCallback(data: string | undefined): AccountAdminAction | null {
  if (!data?.startsWith(`${ACCOUNT_ADMIN_CB_PREFIX}:`)) return null;
  return parseAccountActionPayload(data.slice(ACCOUNT_ADMIN_CB_PREFIX.length + 1), { userIdPattern: TELEGRAM_USER_ID, adminGrant: true });
}

/** The line that identifies someone whatever they named themselves: @username and id. */
function identityLine(account: ManagedAccount, strings: Record<string, string>): string {
  return [account.username ? `@${account.username}` : t(strings, 'telegram.users.card.noUsername'), `ID ${account.id}`].join(' · ');
}

const backRow = (strings: Record<string, string>): InlineButton[] => [{
  text: t(strings, 'telegram.users.btn.back'),
  callback_data: accountAdminCallbackData({ op: 'list' }),
}];

export function accountListView(accounts: readonly ManagedAccount[], strings: Record<string, string>): GroupAdminView {
  if (accounts.length === 0) return { text: t(strings, 'telegram.users.list.none'), keyboard: { inline_keyboard: [] } };
  const plan = accountListPlan(accounts);
  const rows = plan.shown.map((account) => [{
    text: t(strings, accountListItemKey(account), { name: accountName(account) }),
    callback_data: accountAdminCallbackData({ op: 'view', userId: account.id }),
  }]);
  const text = [t(strings, 'telegram.users.list.title'), ...accountListMoreLines(plan, strings)].join('\n\n');
  return { text, keyboard: { inline_keyboard: rows } };
}

export interface AccountCardEnv {
  strings: Record<string, string>;
  actor: AccountActor;
  /** Whether a built-in connector is switched on; an off one is offered only to take it away. */
  isConnectorOn: (serverId: string) => boolean;
}

/**
 * One account's card. A request: who it is, where they were seen, "Allow" / "Block". Blocked:
 * "Unblock". Paired: the grants the actor may toggle (and admin for the owner), "Unpair" — or,
 * when the actor may not edit it, why. `heading` replaces the first line (a request just sent, a
 * pairing made with the actor's invite).
 */
export function accountCardView(account: ManagedAccount, env: AccountCardEnv, options: { heading?: string } = {}): GroupAdminView {
  const { strings } = env;
  const name = accountName(account);
  const rights = accountAuthority(env.actor, account);
  const lines: string[] = [];
  const rows: InlineButton[][] = [];
  const button = (text: string, action: AccountAdminAction): InlineButton => ({ text, callback_data: accountAdminCallbackData(action) });

  if (account.state !== 'paired') {
    lines.push(options.heading ?? t(strings, `telegram.users.card.${account.state}`, { name }));
    lines.push(identityLine(account, strings));
    if (account.state === 'requested') {
      lines.push(account.usedIn
        ? t(strings, 'telegram.users.card.usedInGroup', { group: account.usedIn.group, count: String(account.usedIn.count) })
        : t(strings, 'telegram.users.card.notInGroups'));
      lines.push(t(strings, 'telegram.users.card.checkIdentity'));
      rows.push([
        button(t(strings, 'telegram.users.btn.approve'), { op: 'approve', userId: account.id }),
        button(t(strings, 'telegram.users.btn.block'), { op: 'block', userId: account.id }),
      ]);
    } else if (account.state === 'blocked') {
      rows.push([button(t(strings, 'telegram.users.btn.unblock'), { op: 'unblock', userId: account.id })]);
    }
    rows.push(backRow(strings));
    return { text: lines.join('\n\n'), keyboard: { inline_keyboard: rows } };
  }

  lines.push(options.heading ?? t(strings, 'telegram.users.card.paired', { name }));
  lines.push(identityLine(account, strings));
  if (account.owner) lines.push(t(strings, 'telegram.users.card.ownerMark'));
  else if (account.admin) lines.push(t(strings, 'telegram.users.card.adminMark'));
  if (account.grants.includes('shell')) lines.push(t(strings, 'telegram.users.card.shellReadOnly'));
  if (rights.readOnly) {
    lines.push(t(strings, rights.readOnly));
    rows.push(backRow(strings));
    return { text: lines.join('\n\n'), keyboard: { inline_keyboard: rows } };
  }
  lines.push(t(strings, 'telegram.users.card.toggleHint'));
  for (const toggle of visibleGrantToggles(env.actor, account.grants, env.isConnectorOn)) {
    rows.push([button(`${toggle.on ? CHECKED : UNCHECKED} ${grantLabel(toggle.grant, strings)}`, { op: 'toggle', userId: account.id, index: toggle.index })]);
  }
  if (rights.toggleAdmin) {
    rows.push([button(`${account.admin ? CHECKED : UNCHECKED} ${t(strings, 'telegram.users.grant.admin')}`, { op: 'admin', userId: account.id })]);
  }
  rows.push([button(t(strings, 'telegram.users.btn.unpair'), { op: 'unpairAsk', userId: account.id })]);
  rows.push(backRow(strings));
  return { text: lines.join('\n\n'), keyboard: { inline_keyboard: rows } };
}

/** The second step of "Unpair": nothing is removed until "Unpair" is pressed here. */
export function unpairConfirmView(account: ManagedAccount, strings: Record<string, string>): GroupAdminView {
  return {
    text: t(strings, 'telegram.users.confirm.unpair', { name: accountName(account) }),
    keyboard: {
      inline_keyboard: [[
        { text: t(strings, 'telegram.users.btn.unpairConfirm'), callback_data: accountAdminCallbackData({ op: 'unpair', userId: account.id }) },
        { text: t(strings, 'telegram.users.btn.cancel'), callback_data: accountAdminCallbackData({ op: 'view', userId: account.id }) },
      ]],
    },
  };
}

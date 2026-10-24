/**
 * The owner's account cards on LINE as Flex messages, and the postback data of their buttons: the
 * list (paired accounts, then waiting requests, one button each), one account's card (a request:
 * "Allow" / "Block"; paired: ☑/☐ toggles and "Unpair") and the unpair confirmation. A button's
 * data names an account and a grant index, never a right; the decisions are the shared ones in
 * `botPermissions/accountAdminPlan.ts`. LINE cannot edit a tapped card, so what a tap did is the
 * first line of the card sent back.
 */
import type { messagingApi } from '@line/bot-sdk';
import { t } from '../i18n';
import { accountGrantLabel, accountListItemKey, accountListMoreLines } from '../botPermissions/accountAdminLabels';
import {
  accountActionPayload,
  accountAuthority,
  accountListPlan,
  accountName,
  parseAccountActionPayload,
  visibleGrantToggles,
} from '../botPermissions/accountAdminPlan';
import type { AccountActor, AccountAdminAction, ManagedAccount } from '../botPermissions/accountAdminPlan';
import { linePostbackData } from './postbackRouter';
import { CHECKED, UNCHECKED, clip, flexBubble, flexButton, flexText } from './flexParts';

/** Prefix of an account-management button's postback data; groups use `gm`. */
export const LINE_ACCOUNT_ADMIN_PREFIX = 'ua';

/** LINE ids are `U` + 32 hex characters; anything else id-shaped is refused by the writes anyway. */
const LINE_USER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** How many of each kind one bubble lists; the rest are left to the settings page. */
const LISTED = { paired: 30, requests: 20 } as const;
const MAX_NAME_CHARS = 30;

const MUTED = '#888888';

export function lineAccountActionData(action: AccountAdminAction): string {
  return linePostbackData(LINE_ACCOUNT_ADMIN_PREFIX, accountActionPayload(action));
}

/** The payload after `ua:`; null for anything this module did not write (LINE has no admin toggle). */
export function parseLineAccountAction(payload: string): AccountAdminAction | null {
  return parseAccountActionPayload(payload, { userIdPattern: LINE_USER_ID, adminGrant: false });
}

export interface LineAccountCardEnv {
  strings: Record<string, string>;
  actor: AccountActor;
  /** Whether a built-in connector is switched on; an off one is offered only to take it away. */
  isConnectorOn: (serverId: string) => boolean;
}

const name = (account: ManagedAccount): string => clip(accountName(account), MAX_NAME_CHARS);
const noticeLines = (notice?: string): messagingApi.FlexText[] => (notice ? [flexText(notice, { weight: 'bold' })] : []);
const backButton = (strings: Record<string, string>): messagingApi.FlexButton => (
  flexButton(t(strings, 'telegram.users.btn.back'), lineAccountActionData({ op: 'list' }), 'link')
);

/** The accounts, one button each; null when there are none (answered as plain text). */
export function lineAccountListMessage(
  accounts: readonly ManagedAccount[],
  strings: Record<string, string>,
  notice?: string,
): messagingApi.FlexMessage | null {
  if (accounts.length === 0) return null;
  const plan = accountListPlan(accounts, LISTED);
  const title = t(strings, 'telegram.users.list.title');
  const lines = [
    ...noticeLines(notice),
    flexText(title, { size: 'md' }),
    ...accountListMoreLines(plan, strings).map((line) => flexText(line, { color: MUTED })),
  ];
  const buttons = plan.shown.map((account) => flexButton(
    t(strings, accountListItemKey(account), { name: name(account) }),
    lineAccountActionData({ op: 'view', userId: account.id }),
    'secondary',
  ));
  return flexBubble(lines, buttons, title);
}

/**
 * One account's card. `heading` replaces the first line (a request just made, a pairing made with
 * the owner's invite); `notice` is what the last tap did, shown on top.
 */
export function lineAccountCardMessage(
  account: ManagedAccount,
  env: LineAccountCardEnv,
  options: { heading?: string; notice?: string } = {},
): messagingApi.FlexMessage {
  const { strings } = env;
  const rights = accountAuthority(env.actor, account);
  const heading = options.heading ?? t(strings, `telegram.users.card.${account.state}`, { name: name(account) });
  const lines = [...noticeLines(options.notice), flexText(heading, { size: 'md', weight: 'bold' }), flexText(`ID ${account.id}`, { color: MUTED })];
  const buttons: messagingApi.FlexButton[] = [];
  const action = (op: 'approve' | 'block' | 'unblock' | 'unpairAsk'): string => lineAccountActionData({ op, userId: account.id });

  if (account.state === 'requested') {
    lines.push(flexText(account.usedIn
      ? t(strings, 'telegram.users.card.usedInGroup', { group: account.usedIn.group, count: String(account.usedIn.count) })
      : t(strings, 'telegram.users.card.notInGroups')));
    lines.push(flexText(t(strings, 'line.users.card.checkIdentity'), { color: MUTED }));
    buttons.push(flexButton(t(strings, 'telegram.users.btn.approve'), action('approve'), 'primary'));
    buttons.push(flexButton(t(strings, 'telegram.users.btn.block'), action('block'), 'secondary'));
  } else if (account.state === 'blocked') {
    buttons.push(flexButton(t(strings, 'telegram.users.btn.unblock'), action('unblock'), 'secondary'));
  } else if (account.state === 'paired') {
    if (account.owner) lines.push(flexText(t(strings, 'telegram.users.card.ownerMark')));
    if (account.grants.includes('shell')) lines.push(flexText(t(strings, 'telegram.users.card.shellReadOnly')));
    if (rights.readOnly) {
      lines.push(flexText(t(strings, rights.readOnly), { color: MUTED }));
    } else {
      lines.push(flexText(t(strings, 'telegram.users.card.toggleHint'), { color: MUTED }));
      for (const toggle of visibleGrantToggles(env.actor, account.grants, env.isConnectorOn)) {
        buttons.push(flexButton(
          `${toggle.on ? CHECKED : UNCHECKED} ${accountGrantLabel(toggle.grant, strings)}`,
          lineAccountActionData({ op: 'toggle', userId: account.id, index: toggle.index }),
          'secondary',
        ));
      }
      buttons.push(flexButton(t(strings, 'telegram.users.btn.unpair'), action('unpairAsk'), 'secondary'));
    }
  }
  buttons.push(backButton(strings));
  return flexBubble(lines, buttons, heading);
}

/** The second step of "Unpair": nothing is removed until "Unpair" is tapped here. */
export function lineUnpairConfirmMessage(account: ManagedAccount, strings: Record<string, string>): messagingApi.FlexMessage {
  const question = t(strings, 'telegram.users.confirm.unpair', { name: name(account) });
  return flexBubble([flexText(question)], [
    flexButton(t(strings, 'telegram.users.btn.unpairConfirm'), lineAccountActionData({ op: 'unpair', userId: account.id }), 'primary'),
    flexButton(t(strings, 'telegram.users.btn.cancel'), lineAccountActionData({ op: 'view', userId: account.id }), 'link'),
  ], question);
}

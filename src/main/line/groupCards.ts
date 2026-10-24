/**
 * The owner's group cards as LINE Flex messages, and the postback data of their buttons: the list
 * (one bubble, a button per group) and one group's card ("Allow" while pending; ☑/☐ toggles and
 * "Revoke" once allowed). A button's data names a group and a grant index, never a right.
 */
import type { messagingApi } from '@line/bot-sdk';
import { t } from '../i18n';
import { BUILTIN_CONNECTOR_TITLES } from '../../shared/builtinConnectors';
import { CONNECTOR_GRANT_PREFIX, isBotChatId } from '../../shared/botPermissions';
import type { BotGroupGrant } from '../../shared/botPermissions';
import { GROUP_GRANT_CANDIDATES } from '../botPermissions/groupAdminPlan';
import type { GroupCardAction, ManagedGroup } from '../botPermissions/groupAdminPlan';
import { linePostbackData } from './postbackRouter';
import { CHECKED, UNCHECKED, clip, flexBubble as bubble, flexButton as button, flexText as text } from './flexParts';

/** Prefix of a group-management button's postback data. */
export const LINE_GROUP_ADMIN_PREFIX = 'gm';

/** One button per group in one bubble; a bubble holds 30 KB, far more than this many buttons. */
const MAX_LISTED_GROUPS = 30;
const MAX_NAME_CHARS = 30;

const OPS = { v: 'view', a: 'allow', r: 'revoke', t: 'toggle' } as const;

export function lineGroupActionData(action: GroupCardAction): string {
  if (action.op === 'list') return linePostbackData(LINE_GROUP_ADMIN_PREFIX, 'l');
  const code = (Object.keys(OPS) as Array<keyof typeof OPS>).find((key) => OPS[key] === action.op);
  const base = `${code}:${action.chatId}`;
  return linePostbackData(LINE_GROUP_ADMIN_PREFIX, action.op === 'toggle' ? `${base}:${action.index}` : base);
}

/** The payload after `gm:`; null for anything this module did not write. */
export function parseLineGroupAction(payload: string): GroupCardAction | null {
  const [code, chatId, index, ...rest] = payload.split(':');
  if (rest.length > 0) return null;
  if (code === 'l') return chatId === undefined ? { op: 'list' } : null;
  if (!chatId || chatId.startsWith('-') || !isBotChatId(chatId)) return null;
  if (code === 't') {
    if (!index || !/^\d{1,2}$/.test(index)) return null;
    return { op: 'toggle', chatId, index: Number(index) };
  }
  // Own keys only: `in` would also accept `constructor`, `toString`, `__proto__`… from the prototype.
  if (index !== undefined || !Object.hasOwn(OPS, code)) return null;
  return { op: OPS[code as keyof typeof OPS] as 'view' | 'allow' | 'revoke', chatId };
}

function groupName(group: Pick<ManagedGroup, 'id' | 'title'>): string {
  return clip(group.title?.trim() || group.id, MAX_NAME_CHARS);
}

function grantLabel(grant: BotGroupGrant, strings: Record<string, string>): string {
  if (!grant.startsWith(CONNECTOR_GRANT_PREFIX)) return t(strings, `telegram.groups.grant.${grant}`);
  const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
  const key = BUILTIN_CONNECTOR_TITLES[id];
  return key ? t(strings, key) : id;
}

/** The list of groups, one button each; null when the bot is in none (answered as plain text). */
export function lineGroupListMessage(
  groups: readonly ManagedGroup[],
  strings: Record<string, string>,
  notice?: string,
): messagingApi.FlexMessage | null {
  if (groups.length === 0) return null;
  const title = t(strings, 'telegram.groups.list.title');
  const lines = [...(notice ? [text(notice, { weight: 'bold' })] : []), text(title, { size: 'md' })];
  if (groups.length > MAX_LISTED_GROUPS) {
    lines.push(text(t(strings, 'line.groups.list.more', { count: String(groups.length - MAX_LISTED_GROUPS) }), { color: '#888888' }));
  }
  const buttons = groups.slice(0, MAX_LISTED_GROUPS).map((group) => button(
    t(strings, group.pending ? 'telegram.groups.list.pendingItem' : 'telegram.groups.list.allowedItem', { name: groupName(group) }),
    lineGroupActionData({ op: 'view', chatId: group.id }),
    'secondary',
  ));
  return bubble(lines, buttons, title);
}

export interface LineGroupCardEnv {
  strings: Record<string, string>;
  isConnectorOn: (serverId: string) => boolean;
}

/**
 * One group's card. `joined` words the header as the news that the bot was just added (the card
 * the owner receives unasked); `notice` is what the last tap did, shown on top.
 */
export function lineGroupCardMessage(
  group: ManagedGroup,
  env: LineGroupCardEnv,
  options: { joined?: boolean; notice?: string } = {},
): messagingApi.FlexMessage {
  const { strings } = env;
  const name = groupName(group);
  const header = group.pending
    ? t(strings, options.joined ? 'telegram.groups.card.joined' : 'telegram.groups.card.pending', { name })
    : t(strings, 'telegram.groups.card.allowed', { name });
  const desc = group.pending
    ? t(strings, 'telegram.groups.card.pendingDesc')
    : t(strings, group.grants.length > 0 ? 'telegram.groups.card.allowedDesc' : 'telegram.groups.card.nothing');
  const lines = [
    ...(options.notice ? [text(options.notice, { weight: 'bold' })] : []),
    text(header, { size: 'md', weight: 'bold' }),
    text(desc, { color: '#888888' }),
  ];

  const buttons: messagingApi.FlexButton[] = [];
  if (group.pending) {
    buttons.push(button(t(strings, 'telegram.groups.btn.allow'), lineGroupActionData({ op: 'allow', chatId: group.id }), 'primary'));
  } else {
    const has = new Set(group.grants);
    GROUP_GRANT_CANDIDATES.forEach((grant, index) => {
      const connector = grant.startsWith(CONNECTOR_GRANT_PREFIX) ? grant.slice(CONNECTOR_GRANT_PREFIX.length) : '';
      if (connector && !has.has(grant) && !env.isConnectorOn(connector)) return;
      buttons.push(button(
        `${has.has(grant) ? CHECKED : UNCHECKED} ${grantLabel(grant, strings)}`,
        lineGroupActionData({ op: 'toggle', chatId: group.id, index }),
        'secondary',
      ));
    });
    buttons.push(button(t(strings, 'telegram.groups.btn.revoke'), lineGroupActionData({ op: 'revoke', chatId: group.id }), 'secondary'));
  }
  buttons.push(button(t(strings, 'telegram.groups.btn.back'), lineGroupActionData({ op: 'list' }), 'link'));
  return bubble(lines, buttons, `${header}\n${desc}`);
}

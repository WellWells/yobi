/**
 * Managing the bot's groups from LINE itself: `/groups` in the owner's private chat lists the
 * groups the bot is in, and each one opens a card with "Allow" (pending) or its grants as toggles
 * plus "Revoke" (allowed) — the same writes the settings page makes. When the bot joins a group
 * still waiting for approval, the owner gets that group's card in their private chat.
 *
 * LINE has no admin grant, so the manager is the owner ("me"), still paired, in their own private
 * chat. Every tap is checked again: postback data comes back from the client as it likes, so it
 * only ever names a group and a grant index, never a right. Answers go through the reply token
 * (free); only the join card is a push (the owner's monthly quota), once per group per run.
 */
import type { messagingApi } from '@line/bot-sdk';
import { t } from '../i18n';
import type { BotGroupGrant } from '../../shared/botPermissions';
import { planGroupChange } from '../botPermissions/groupAdminPlan';
import { LINE_JOIN_CARDS_DAILY, takeLineJoinCard } from '../botPermissions/groupApproval';
import type { ManagedGroup } from '../botPermissions/groupAdminPlan';
import type { LineClient } from './client';
import type { LinePostbackEvent, LineTextEvent } from './events';
import { replyByToken } from './postbackRouter';
import { isLineManager } from './manager';
import { lineGroupCardMessage, lineGroupListMessage, parseLineGroupAction } from './groupCards';
import type { LineGroupCardEnv } from './groupCards';

export {
  LINE_GROUP_ADMIN_PREFIX,
  lineGroupActionData,
  lineGroupCardMessage,
  lineGroupListMessage,
  parseLineGroupAction,
} from './groupCards';
export type { LineGroupCardEnv } from './groupCards';

export interface LineGroupAdminSource {
  /** The groups the bot is in (the settings page's list). */
  listGroups: () => Promise<ManagedGroup[]>;
  /** Allows a group with these grants, or (`null`) puts it back to pending. False = not saved. */
  setGrants: (chatId: string, grants: BotGroupGrant[] | null) => boolean;
  /** Whether a built-in connector is switched on; an off one is offered only to take it away. */
  isConnectorOn: (serverId: string) => boolean;
  /** The private chats that get a joined group's card: the owner, paired. */
  getManagerIds: () => Promise<string[]>;
}

export interface LineGroupAdminDeps {
  source: LineGroupAdminSource;
  getClient: () => LineClient | null;
  getStrings: () => Record<string, string>;
  onLog: (message: string) => void;
  isPairedUser: (userId: string) => boolean;
  /** The owner in their own private chat (`botFlowAdminAllowed`); absent = nobody. */
  isFlowAdmin?: (chatId: string, userId: string) => Promise<boolean>;
}

export interface LineGroupAdmin {
  /** `/groups` typed in a paired account's private chat. */
  handleCommand: (event: LineTextEvent) => Promise<void>;
  /** A tap on one of this module's buttons; `payload` is the data after `gm:`. */
  handlePostback: (event: LinePostbackEvent, payload: string) => Promise<void>;
  /** Pushes a just-joined pending group's card to the owner; returns how many got it. */
  offerJoinedGroup: (group: { chatId: string; title?: string }) => Promise<number>;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createLineGroupAdmin(deps: LineGroupAdminDeps): LineGroupAdmin {
  const { source, onLog } = deps;
  const env = (): LineGroupCardEnv => ({ strings: deps.getStrings(), isConnectorOn: source.isConnectorOn });

  const isManager = (event: { userId: string; chatId: string; chatKind: string }): Promise<boolean> => isLineManager(event, deps);

  function reply(replyToken: string | undefined, message: string | messagingApi.FlexMessage): Promise<boolean> {
    return replyByToken(deps.getClient(), replyToken, message, onLog);
  }

  async function replyList(replyToken: string | undefined, groups: readonly ManagedGroup[], notice?: string): Promise<void> {
    const s = deps.getStrings();
    await reply(replyToken, lineGroupListMessage(groups, s, notice) ?? t(s, 'telegram.groups.list.none'));
  }

  async function handleCommand(event: LineTextEvent): Promise<void> {
    if (!(await isManager(event))) {
      onLog(`[line] /groups refused for ${event.userId} — not the owner in a private chat`);
      await reply(event.replyToken, t(deps.getStrings(), 'line.groups.ownerOnly'));
      return;
    }
    await replyList(event.replyToken, await source.listGroups());
  }

  async function handlePostback(event: LinePostbackEvent, payload: string): Promise<void> {
    // A card is only ever sent to the owner's private chat; a tap anywhere else is not one of ours.
    if (event.chatKind !== 'user') {
      onLog(`[line] group-management tap in ${event.chatKind} ${event.chatId} — ignored`);
      return;
    }
    const action = parseLineGroupAction(payload);
    if (!action) {
      onLog(`[line] group-management tap from ${event.userId} with malformed data — ignored`);
      return;
    }
    const s = deps.getStrings();
    if (!(await isManager(event))) {
      onLog(`[line] group-management tap refused for ${event.userId} — not the owner`);
      await reply(event.replyToken, t(s, 'line.groups.ownerOnly'));
      return;
    }
    const groups = await source.listGroups();
    if (action.op === 'list') {
      await replyList(event.replyToken, groups);
      return;
    }
    const group = groups.find((entry) => entry.id === action.chatId);
    if (!group) {
      await replyList(event.replyToken, groups, t(s, 'telegram.groups.toast.gone'));
      return;
    }
    const change = planGroupChange(action, group);
    let notice = change.refusal ? t(s, change.refusal) : undefined;
    if (change.grants !== undefined) {
      if (!source.setGrants(group.id, change.grants)) {
        notice = t(s, 'telegram.groups.toast.failed');
      } else {
        onLog(`[line] group ${group.id} ${change.grants === null ? 'put back to pending' : `allowed (${change.grants.length} grant(s))`} from LINE`);
        notice = t(s, change.done ?? 'telegram.groups.toast.saved');
      }
    }
    // LINE cannot edit the tapped card, so the answer is the card redrawn, with what the tap did on top.
    const fresh = (await source.listGroups()).find((entry) => entry.id === group.id) ?? group;
    await reply(event.replyToken, lineGroupCardMessage(fresh, env(), notice ? { notice } : {}));
  }

  async function offerJoinedGroup(group: { chatId: string; title?: string }): Promise<number> {
    const client = deps.getClient();
    if (!client) return 0;
    const card = lineGroupCardMessage(
      { id: group.chatId, ...(group.title ? { title: group.title } : {}), pending: true, grants: [] },
      env(),
      { joined: true },
    );
    let managerIds: string[];
    try {
      managerIds = await source.getManagerIds();
    } catch (err: unknown) {
      onLog(`[line] could not read who gets group ${group.chatId}'s approval card: ${errorText(err)}`);
      return 0;
    }
    let sent = 0;
    for (const managerId of managerIds) {
      try {
        await client.pushFlex(managerId, card);
        sent += 1;
      } catch (err: unknown) {
        onLog(`[line] could not tell the owner ${managerId} about group ${group.chatId}: ${errorText(err)}`);
      }
    }
    if (sent > 0) onLog(`[line] group ${group.chatId}'s approval card pushed to ${sent} account(s)`);
    return sent;
  }

  return { handleCommand, handlePostback, offerJoinedGroup };
}

/**
 * The join hook: `notice` reports the join (the desktop notification) and says whether this was
 * the first notice of a pending group this run — only then is the card pushed, so a re-sent join
 * never costs the owner a second push — and only within the day's allowance across all groups
 * (`takeLineJoinCard`); past it the notification alone tells the owner.
 */
export function withJoinCard<G extends { chatId: string; title?: string }>(
  notice: ((group: G) => boolean | void) | undefined,
  admin: Pick<LineGroupAdmin, 'offerJoinedGroup'> | null,
  onLog: (message: string) => void = () => {},
): (group: G) => void {
  return (group) => {
    if (notice?.(group) !== true || !admin) return;
    if (!takeLineJoinCard()) {
      onLog(`[line] group ${group.chatId}'s approval card not pushed — today's ${LINE_JOIN_CARDS_DAILY} are used`);
      return;
    }
    void admin.offerJoinedGroup(group);
  };
}

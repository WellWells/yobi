/**
 * Managing who may use the bot from LINE itself, the port of Telegram's `/users`: an unpaired
 * person writing in private is a pairing request, and the managers get its card ("Allow" /
 * "Block"); `/users` in a manager's private chat lists the paired accounts and the waiting
 * requests, each a card with its grants as toggles, the admin toggle (the owner only) and
 * "Unpair" — the same writes as the settings page.
 *
 * The managers are the owner ("me") and the admin-grant holders, paired, in their own private
 * chat, checked on every command and every tap (`isLineManager`). Postback data comes back from
 * the client as it likes, so it only names an account and a grant index; what a tap may do is
 * worked out again from the account and the one tapping as they are now (`applyAccountPress`).
 *
 * LINE quota: every answer goes through the reply token (free). The only pushes are a new
 * request's card to the managers (at most `PAIRING_REQUEST_DAILY_CARDS.line` requests a day,
 * decided by `noteBotPairingRequest`, and at most `LINE_MANAGER_PUSHES_DAILY` pushes a day across
 * managers, owner first) and, when an invite is used, the new account's card to its issuer.
 */
import type { messagingApi } from '@line/bot-sdk';
import { t } from '../i18n';
import { BOT_PLATFORM_NAMES } from '../../shared/types';
import { accountActorOf, accountName, applyAccountPress } from '../botPermissions/accountAdminPlan';
import type { AccountWrites, ManagedAccount } from '../botPermissions/accountAdminPlan';
import type { LineClient } from './client';
import type { LinePostbackEvent, LineTextEvent } from './events';
import { replyByToken } from './postbackRouter';
import { LINE_MANAGER_PUSHES_DAILY, isLineManager, takeLineManagerPush } from './manager';
import type { LineManagerCheck } from './manager';
import { lineAccountCardMessage, lineAccountListMessage, lineUnpairConfirmMessage, parseLineAccountAction } from './accountCards';
import type { LineAccountCardEnv } from './accountCards';

/** What the owner's account cards read and write; the writes are the settings page's. */
export interface LineAccountAdminSource extends AccountWrites {
  /** Paired accounts, then waiting requests. */
  listAccounts: () => Promise<ManagedAccount[]>;
  /** One account as it is now; null = an id the bot knows nothing of. */
  getAccount: (userId: string) => Promise<ManagedAccount | null>;
  /** The private chats a new request's card goes to: the managers, paired, owner first. */
  getManagerIds: () => Promise<string[]>;
  /** Records a request; true = the owner should get its card now. */
  noteRequest: (profile: { userId: string; displayName?: string }) => Promise<boolean>;
}

export interface LineAccountAdminDeps extends LineManagerCheck {
  source: LineAccountAdminSource;
  getClient: () => LineClient | null;
  getStrings: () => Record<string, string>;
  /** Takes one push to a manager from today's allowance (`takeLineManagerPush` unless a test gives its own). */
  takePush?: () => boolean;
}

export interface LineAccountAdmin {
  /** `/users` typed in a paired account's private chat. */
  handleCommand: (event: LineTextEvent) => Promise<void>;
  /** A tap on one of this module's buttons; `payload` is the data after `ua:`. */
  handlePostback: (event: LinePostbackEvent, payload: string) => Promise<void>;
  /** An unpaired person wrote in their private chat: a request (the reply is free, the card a push). */
  handlePairingRequest: (event: LineTextEvent) => Promise<void>;
  /** Someone paired with a code the owner issued from LINE: the issuer gets their card (one push). */
  tellInviteIssuer: (issuerId: string, userId: string) => Promise<void>;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createLineAccountAdmin(deps: LineAccountAdminDeps): LineAccountAdmin {
  const { source, onLog } = deps;
  const takePush = deps.takePush ?? takeLineManagerPush;
  const isManager = (event: { userId: string; chatId: string; chatKind: string }): Promise<boolean> => isLineManager(event, deps);

  function reply(replyToken: string | undefined, message: string | messagingApi.FlexMessage): Promise<boolean> {
    return replyByToken(deps.getClient(), replyToken, message, onLog);
  }

  async function envFor(actorId: string): Promise<LineAccountCardEnv> {
    return { strings: deps.getStrings(), actor: await accountActorOf(actorId, source.getAccount), isConnectorOn: source.isConnectorOn };
  }

  async function replyList(replyToken: string | undefined, notice?: string): Promise<void> {
    const s = deps.getStrings();
    await reply(replyToken, lineAccountListMessage(await source.listAccounts(), s, notice) ?? (notice ? `${notice}\n\n${t(s, 'telegram.users.list.none')}` : t(s, 'telegram.users.list.none')));
  }

  async function handleCommand(event: LineTextEvent): Promise<void> {
    if (!(await isManager(event))) {
      onLog(`[line] /users refused for ${event.userId} — not an admin in a private chat`);
      await reply(event.replyToken, t(deps.getStrings(), 'line.users.ownerOnly'));
      return;
    }
    await replyList(event.replyToken);
  }

  async function handlePostback(event: LinePostbackEvent, payload: string): Promise<void> {
    // A card only ever goes to the owner's private chat; a tap anywhere else is not one of ours.
    if (event.chatKind !== 'user') {
      onLog(`[line] account-management tap in ${event.chatKind} ${event.chatId} — ignored`);
      return;
    }
    const action = parseLineAccountAction(payload);
    if (!action) {
      onLog(`[line] account-management tap from ${event.userId} with malformed data — ignored`);
      return;
    }
    const s = deps.getStrings();
    if (!(await isManager(event))) {
      onLog(`[line] account-management tap refused for ${event.userId} — not an admin`);
      await reply(event.replyToken, t(s, 'line.users.ownerOnly'));
      return;
    }
    if (action.op === 'list') {
      await replyList(event.replyToken);
      return;
    }
    const target = await source.getAccount(action.userId);
    if (!target) {
      await replyList(event.replyToken, t(s, 'telegram.users.toast.gone'));
      return;
    }
    const env = await envFor(event.userId);
    const outcome = await applyAccountPress(action, target, env.actor, source, (message) => onLog(`[line] ${message} from LINE`));
    const notice = outcome.toast ? t(s, outcome.toast) : undefined;
    if (outcome.view === 'list') {
      await replyList(event.replyToken, notice);
      return;
    }
    const fresh = (await source.getAccount(target.id)) ?? target;
    await reply(event.replyToken, outcome.view === 'confirm'
      ? lineUnpairConfirmMessage(fresh, s)
      : lineAccountCardMessage(fresh, env, notice ? { notice } : {}));
  }

  /**
   * Pushes one account's card to each of these managers, in order (owner first), while today's
   * push allowance lasts; returns how many got it.
   */
  async function pushCards(account: ManagedAccount, managerIds: readonly string[], heading?: string): Promise<number> {
    const client = deps.getClient();
    if (!client) return 0;
    let sent = 0;
    for (const managerId of managerIds) {
      if (!takePush()) {
        onLog(`[line] ${account.id}'s card not pushed to ${managerId} — today's ${LINE_MANAGER_PUSHES_DAILY} pushes to managers are used`);
        break;
      }
      try {
        await client.pushFlex(managerId, lineAccountCardMessage(account, await envFor(managerId), heading ? { heading } : {}));
        sent += 1;
      } catch (err: unknown) {
        onLog(`[line] could not tell the owner ${managerId} about ${account.id}: ${errorText(err)}`);
      }
    }
    return sent;
  }

  async function handlePairingRequest(event: LineTextEvent): Promise<void> {
    if (event.chatKind !== 'user' || event.chatId !== event.userId || deps.isPairedUser(event.userId)) return;
    const s = deps.getStrings();
    let managers: string[] = [];
    try {
      managers = (await source.getManagerIds()).filter((id) => id !== event.userId);
    } catch (err: unknown) {
      onLog(`[line] could not read the owner's accounts: ${errorText(err)}`);
    }
    const displayName = await deps.getClient()?.getDisplayName(event.userId).catch(() => undefined);
    // Recorded even with nobody to message: the settings page lists it and can allow it.
    const announce = await source.noteRequest({ userId: event.userId, ...(displayName ? { displayName } : {}) }).catch((err: unknown) => {
      onLog(`[line] could not record ${event.userId}'s request: ${errorText(err)}`);
      return false;
    });
    if (managers.length === 0) {
      await reply(event.replyToken, t(s, 'bot.chat.pair.tip', { platform: BOT_PLATFORM_NAMES.line }));
      return;
    }
    await reply(event.replyToken, t(s, 'telegram.users.request.sent'));
    if (!announce) return;
    const account: ManagedAccount = (await source.getAccount(event.userId)) ?? {
      id: event.userId, name: displayName ?? '', state: 'requested', owner: false, admin: false, grants: [],
    };
    const sent = await pushCards(account, managers);
    if (sent > 0) onLog(`[line] ${event.userId}'s pairing request pushed to ${sent} account(s)`);
  }

  async function tellInviteIssuer(issuerId: string, userId: string): Promise<void> {
    try {
      if (issuerId === userId || !(await isManager({ userId: issuerId, chatId: issuerId, chatKind: 'user' }))) return;
      const account = await source.getAccount(userId);
      if (account?.state !== 'paired') return;
      await pushCards(account, [issuerId], t(deps.getStrings(), 'telegram.invite.used', { name: accountName(account) }));
    } catch (err: unknown) {
      onLog(`[line] could not tell ${issuerId} that their invite was used: ${errorText(err)}`);
    }
  }

  return { handleCommand, handlePostback, handlePairingRequest, tellInviteIssuer };
}

/**
 * Managing who may use the bot from Telegram itself: `/users` in a manager's private chat lists the
 * pairing requests and the paired accounts; each opens a card — a request with "Allow" / "Block",
 * an account with its grants as toggles and "Unpair" — making the same writes as the settings page.
 * A new request's card goes to every manager unasked, so a phone is enough to let someone in.
 *
 * A manager is the owner ("me") or a Telegram admin-grant holder, still paired, in their own private
 * chat (`isFlowAdmin`), checked on every command and every press. Callback data comes back from the
 * client as it likes, so it only ever names an account and a grant index; what the press may do is
 * worked out again from the account as it is now (`accountAuthority`).
 */
import { t } from '../i18n';
import { accountActorOf, applyAccountPress } from '../botPermissions/accountAdminPlan';
import type { AccountWrites } from '../botPermissions/accountAdminPlan';
import { accountCardView, accountListView, parseAccountAdminCallback, unpairConfirmView } from './accountAdminViews';
import type { AccountCardEnv, ManagedAccount } from './accountAdminViews';
import type { GroupAdminView } from './groupAdmin';
import type { PairingUserProfile } from './dmPolicy';
import type { TelegramCommandOptions, TelegramContext } from './commandHandlers';

/**
 * What the runtime gives the account cards; absent = `/users` and the request cards do nothing.
 * The writes are the settings page's (`setBotPermissions`, its unpair, its block).
 */
export interface AccountAdminDeps extends AccountWrites {
  /** Paired accounts, then waiting requests. */
  listAccounts: () => Promise<ManagedAccount[]>;
  /** One account as it is now; null = an id the bot knows nothing of. */
  getAccount: (userId: string) => Promise<ManagedAccount | null>;
  /** The private chats a new request's card goes to: the owner and admin-grant holders, paired. */
  getManagerIds: () => Promise<number[]>;
  /** Records a request; true = new, so the managers should get its card. */
  noteRequest: (profile: PairingUserProfile) => Promise<boolean>;
}

export type AccountAdminOptions = Pick<
  TelegramCommandOptions,
  'getStrings' | 'isPairedUser' | 'isFlowAdmin' | 'onLog' | 'accountAdmin'
>;

/** A manager, paired, in their own private chat — checked on every command and every press. */
export async function isAccountManager(ctx: TelegramContext, options: Pick<TelegramCommandOptions, 'isPairedUser' | 'isFlowAdmin'>): Promise<boolean> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || chat?.type !== 'private' || chat.id !== from.id || !options.isPairedUser(from.id)) return false;
  return (await options.isFlowAdmin?.(from.id, chat.id)) === true;
}

/** `/groups`-style refusals shared by `/users` and `/invite`; true = go ahead. */
export async function managerCommandGate(ctx: TelegramContext, options: Pick<TelegramCommandOptions, 'getStrings' | 'isPairedUser' | 'isFlowAdmin'>): Promise<boolean> {
  const s = options.getStrings();
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(s, 'telegram.cmd.accessDenied'));
    return false;
  }
  if (ctx.chat?.type !== 'private') {
    await ctx.reply(t(s, 'telegram.cmd.adminPrivateOnly'));
    return false;
  }
  if (!(await isAccountManager(ctx, options))) {
    await ctx.reply(t(s, 'telegram.cmd.adminOnly'));
    return false;
  }
  return true;
}

export async function actorEnv(actorId: number, deps: AccountAdminDeps, strings: Record<string, string>): Promise<AccountCardEnv> {
  return { strings, actor: await accountActorOf(String(actorId), deps.getAccount), isConnectorOn: deps.isConnectorOn };
}

export async function handleUsersCommand(ctx: TelegramContext, options: AccountAdminOptions): Promise<void> {
  if (!(await managerCommandGate(ctx, options))) return;
  const deps = options.accountAdmin;
  if (!deps) return;
  const view = accountListView(await deps.listAccounts(), options.getStrings());
  await ctx.reply(view.text, { reply_markup: view.keyboard });
}

/** A card shown in place of the pressed one; Telegram refuses an edit that changes nothing. */
async function showInPlace(ctx: TelegramContext, view: GroupAdminView, options: AccountAdminOptions): Promise<void> {
  try {
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('message is not modified')) options.onLog(`[telegram] could not update an account card: ${message}`);
  }
}

/**
 * A press on an account-management button. Returns false when the press is not one of ours, so
 * the next handler sees it.
 */
export async function handleAccountAdminCallback(ctx: TelegramContext, options: AccountAdminOptions): Promise<boolean> {
  const action = parseAccountAdminCallback(ctx.callbackQuery?.data);
  if (!action) return false;
  const s = options.getStrings();
  const deps = options.accountAdmin;
  if (!deps || !ctx.from || !(await isAccountManager(ctx, options))) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.cmd.adminOnly'), show_alert: true });
    return true;
  }
  if (action.op === 'list') {
    await ctx.answerCallbackQuery();
    await showInPlace(ctx, accountListView(await deps.listAccounts(), s), options);
    return true;
  }
  const env = await actorEnv(ctx.from.id, deps, s);
  const target = await deps.getAccount(action.userId);
  if (!target) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.users.toast.gone'), show_alert: true });
    await showInPlace(ctx, accountListView(await deps.listAccounts(), s), options);
    return true;
  }
  const outcome = await applyAccountPress(action, target, env.actor, deps, (message) => options.onLog(`[telegram] ${message}`));
  await ctx.answerCallbackQuery(outcome.toast ? { text: t(s, outcome.toast), ...(outcome.alert ? { show_alert: true } : {}) } : undefined);
  if (outcome.view === 'list') {
    await showInPlace(ctx, accountListView(await deps.listAccounts(), s), options);
    return true;
  }
  const fresh = (await deps.getAccount(target.id)) ?? target;
  await showInPlace(ctx, outcome.view === 'confirm' ? unpairConfirmView(fresh, s) : accountCardView(fresh, env), options);
  return true;
}

/**
 * Sends a new request's card to every manager's private chat. Returns how many got it; one that
 * cannot be reached (never started the bot, blocked it) is logged.
 */
export async function offerPairingRequest(
  send: (chatId: number, view: GroupAdminView) => Promise<unknown>,
  account: ManagedAccount,
  managerIds: readonly number[],
  cardEnvFor: (managerId: number) => Promise<AccountCardEnv>,
  onLog: (message: string) => void,
): Promise<number> {
  let sent = 0;
  for (const managerId of managerIds) {
    try {
      await send(managerId, accountCardView(account, await cardEnvFor(managerId)));
      sent += 1;
    } catch (err: unknown) {
      onLog(`[telegram] could not tell manager ${managerId} about ${account.id}'s request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return sent;
}

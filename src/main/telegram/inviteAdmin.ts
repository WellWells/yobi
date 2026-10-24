/**
 * `/invite` in a manager's private chat: a pairing code from the same store as the settings page
 * (which lists it), as a `t.me/<bot>?start=<code>` link that `/start <code>` consumes, with when it
 * stops working and a "Revoke" button — plus the other codes still valid, each with its own. When
 * someone pairs with a code issued here, the manager who issued it gets that account's card.
 */
import { t } from '../i18n';
import { telegramCallbackData } from './callbackRouter';
import { PAIRING_CODE_TTL_MS } from '../pairingCodes';
import { inviteRevokePayload, localClock, otherInvites, parseInviteRevokePayload, revokeListedInvite } from '../botPermissions/invites';
import type { InviteStore, PendingInvite } from '../botPermissions/invites';
import { managerCommandGate, isAccountManager } from './accountAdmin';
import type { GroupAdminView, InlineButton } from './groupAdmin';
import type { TelegramCommandOptions, TelegramContext } from './commandHandlers';

export { localClock } from '../botPermissions/invites';
export type { PendingInvite } from '../botPermissions/invites';

/** Prefix of an invite button's `callback_data`. */
export const INVITE_CB_PREFIX = 'iv';

/** What the runtime gives `/invite`; absent = the command does nothing. */
export interface InviteDeps extends InviteStore {
  /** Who issued a code from Telegram, kept in memory until the code is used. */
  rememberIssuer: (code: string, managerId: number) => void;
}

type InviteOptions = Pick<TelegramCommandOptions, 'getStrings' | 'isPairedUser' | 'isFlowAdmin' | 'onLog' | 'invites' | 'getBotUsername'>;

export function inviteCallbackData(code: string): string {
  return telegramCallbackData(INVITE_CB_PREFIX, inviteRevokePayload(code));
}

export function parseInviteCallback(data: string | undefined): { code: string } | null {
  if (!data?.startsWith(`${INVITE_CB_PREFIX}:`)) return null;
  return parseInviteRevokePayload(data.slice(INVITE_CB_PREFIX.length + 1));
}

export function inviteLink(botUsername: string, code: string): string {
  return botUsername ? `https://t.me/${botUsername}?start=${code}` : '';
}

/**
 * The reply to `/invite` (`fresh` = the code just made) or, after a revoke, the codes left. Every
 * code still valid gets a "Revoke" button.
 */
export function inviteView(
  fresh: PendingInvite | null,
  codes: readonly PendingInvite[],
  botUsername: string,
  strings: Record<string, string>,
): GroupAdminView {
  const lines: string[] = [];
  const rows: InlineButton[][] = [];
  const hours = String(Math.round(PAIRING_CODE_TTL_MS / 3_600_000));
  if (fresh) {
    const link = inviteLink(botUsername, fresh.code);
    lines.push(t(strings, 'telegram.invite.created'));
    lines.push(link || t(strings, 'telegram.invite.startCommand', { code: fresh.code }));
    lines.push(t(strings, 'telegram.invite.code', { code: fresh.code }));
    lines.push(t(strings, 'telegram.invite.validUntil', { time: localClock(fresh.expiresAt), hours }));
    rows.push([{ text: t(strings, 'telegram.invite.btn.revoke', { code: fresh.code }), callback_data: inviteCallbackData(fresh.code) }]);
  }
  const others = otherInvites(fresh, codes);
  if (others.length > 0) {
    lines.push(t(strings, 'telegram.invite.others'));
    for (const entry of others) {
      lines.push(t(strings, 'telegram.invite.otherItem', { code: entry.code, time: localClock(entry.expiresAt) }));
      rows.push([{ text: t(strings, 'telegram.invite.btn.revoke', { code: entry.code }), callback_data: inviteCallbackData(entry.code) }]);
    }
  } else if (!fresh) {
    lines.push(t(strings, 'telegram.invite.none'));
  }
  return { text: lines.join('\n\n'), keyboard: { inline_keyboard: rows } };
}

export async function handleInviteCommand(ctx: TelegramContext, options: InviteOptions): Promise<void> {
  if (!(await managerCommandGate(ctx, options))) return;
  const deps = options.invites;
  if (!deps || !ctx.from) return;
  const s = options.getStrings();
  const fresh = deps.issue();
  if (!fresh) {
    await ctx.reply(t(s, 'telegram.invite.failed'));
    return;
  }
  deps.rememberIssuer(fresh.code, ctx.from.id);
  options.onLog(`[telegram] pairing code issued from Telegram by ${ctx.from.id} (expires at ${fresh.expiresAt})`);
  const view = inviteView(fresh, deps.list(), options.getBotUsername?.() ?? '', s);
  // No link preview: it would only show the bot's own card.
  await ctx.reply(view.text, { reply_markup: view.keyboard, link_preview_options: { is_disabled: true } });
}

/** A press on "Revoke"; false when the press is not one of ours. */
export async function handleInviteCallback(ctx: TelegramContext, options: InviteOptions): Promise<boolean> {
  const press = parseInviteCallback(ctx.callbackQuery?.data);
  if (!press) return false;
  const s = options.getStrings();
  const deps = options.invites;
  if (!deps || !(await isAccountManager(ctx, options))) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.cmd.adminOnly'), show_alert: true });
    return true;
  }
  const known = revokeListedInvite(deps, press.code);
  if (known) options.onLog(`[telegram] pairing code revoked from Telegram by ${ctx.from?.id}`);
  await ctx.answerCallbackQuery({ text: t(s, known ? 'telegram.invite.toast.revoked' : 'telegram.invite.toast.gone') });
  const view = inviteView(null, deps.list(), options.getBotUsername?.() ?? '', s);
  try {
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('message is not modified')) options.onLog(`[telegram] could not update an invite card: ${message}`);
  }
  return true;
}

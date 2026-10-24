/**
 * `/invite` in the owner's private chat on LINE: a pairing code from the same store as the
 * settings page (which lists it), as the `line.me/R/oaMessage` link that opens the bot's chat with
 * `/pair <code>` typed in, with when it stops working and a "Revoke" button — plus the other codes
 * still valid, each with its own. One reply (free): the link as plain text, so it can be copied
 * and forwarded, then the card. When the code is used, the issuer gets the new account's card.
 */
import type { messagingApi } from '@line/bot-sdk';
import { t } from '../i18n';
import { PAIRING_CODE_TTL_MS } from '../pairingCodes';
import { inviteRevokePayload, localClock, otherInvites, parseInviteRevokePayload, revokeListedInvite } from '../botPermissions/invites';
import type { InviteIssuers, InviteStore, PendingInvite } from '../botPermissions/invites';
import type { LineClient } from './client';
import { buildLinePairingLink } from './deepLink';
import type { LinePostbackEvent, LineTextEvent } from './events';
import { flexBubble, flexButton, flexText } from './flexParts';
import { isLineManager } from './manager';
import type { LineManagerCheck } from './manager';
import { linePostbackData, replyByToken } from './postbackRouter';

/** Prefix of an invite button's postback data. */
export const LINE_INVITE_PREFIX = 'iv';

export function lineInviteRevokeData(code: string): string {
  return linePostbackData(LINE_INVITE_PREFIX, inviteRevokePayload(code));
}

export interface LineInviteDeps extends LineManagerCheck {
  store: InviteStore;
  issuers: InviteIssuers<string>;
  getClient: () => LineClient | null;
  getStrings: () => Record<string, string>;
  /** The bot's basic ID (`@xxx`) for the link; '' = unknown, the card says what to type instead. */
  getBasicId: () => Promise<string>;
}

export interface LineInviteAdmin {
  handleCommand: (event: LineTextEvent) => Promise<void>;
  /** A tap on "Revoke"; `payload` is the data after `iv:`. */
  handlePostback: (event: LinePostbackEvent, payload: string) => Promise<void>;
}

/**
 * The codes card: `fresh` (the code just made) first with its expiry, then the others still
 * valid; every code gets a "Revoke" button. Null when there is nothing to show.
 */
export function lineInviteCardMessage(
  fresh: PendingInvite | null,
  codes: readonly PendingInvite[],
  strings: Record<string, string>,
  notice?: string,
): messagingApi.FlexMessage | null {
  const lines: messagingApi.FlexText[] = notice ? [flexText(notice, { weight: 'bold' })] : [];
  const buttons: messagingApi.FlexButton[] = [];
  const revoke = (code: string): messagingApi.FlexButton => flexButton(t(strings, 'telegram.invite.btn.revoke', { code }), lineInviteRevokeData(code), 'secondary');
  if (fresh) {
    lines.push(flexText(t(strings, 'telegram.invite.code', { code: fresh.code }), { size: 'md', weight: 'bold' }));
    lines.push(flexText(t(strings, 'telegram.invite.validUntil', {
      time: localClock(fresh.expiresAt),
      hours: String(Math.round(PAIRING_CODE_TTL_MS / 3_600_000)),
    })));
    buttons.push(revoke(fresh.code));
  }
  const others = otherInvites(fresh, codes);
  if (others.length > 0) {
    lines.push(flexText(t(strings, 'telegram.invite.others'), { weight: 'bold' }));
    for (const entry of others) {
      lines.push(flexText(t(strings, 'telegram.invite.otherItem', { code: entry.code, time: localClock(entry.expiresAt) })));
      buttons.push(revoke(entry.code));
    }
  }
  if (!fresh && others.length === 0) return null;
  return flexBubble(lines, buttons, lines.map((line) => line.text).join('\n'));
}

/** The text with the link (or what to type without one): sent as plain text so it can be forwarded. */
export function lineInviteLinkText(code: string, basicId: string, strings: Record<string, string>): string {
  const link = buildLinePairingLink(basicId, code);
  return link
    ? `${t(strings, 'line.invite.created')}\n${link}`
    : t(strings, 'line.invite.pairCommand', { code });
}

export function createLineInviteAdmin(deps: LineInviteDeps): LineInviteAdmin {
  const { store, onLog } = deps;

  async function handleCommand(event: LineTextEvent): Promise<void> {
    const s = deps.getStrings();
    if (!(await isLineManager(event, deps))) {
      onLog(`[line] /invite refused for ${event.userId} — not the owner in a private chat`);
      await replyByToken(deps.getClient(), event.replyToken, t(s, 'line.invite.ownerOnly'), onLog);
      return;
    }
    const fresh = store.issue();
    if (!fresh) {
      await replyByToken(deps.getClient(), event.replyToken, t(s, 'telegram.invite.failed'), onLog);
      return;
    }
    deps.issuers.remember(fresh.code, event.userId);
    onLog(`[line] pairing code issued from LINE by ${event.userId} (expires at ${fresh.expiresAt})`);
    const basicId = await deps.getBasicId().catch(() => '');
    const card = lineInviteCardMessage(fresh, store.list(), s);
    const client = deps.getClient();
    if (!client || !event.replyToken) {
      onLog('[line] invite reply skipped — no client or reply token');
      return;
    }
    try {
      await client.replyMessages(event.replyToken, [
        { type: 'text', text: lineInviteLinkText(fresh.code, basicId, s) },
        ...(card ? [card] : []),
      ]);
    } catch (err: unknown) {
      onLog(`[line] invite reply failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handlePostback(event: LinePostbackEvent, payload: string): Promise<void> {
    if (event.chatKind !== 'user') {
      onLog(`[line] invite tap in ${event.chatKind} ${event.chatId} — ignored`);
      return;
    }
    const press = parseInviteRevokePayload(payload);
    if (!press) {
      onLog(`[line] invite tap from ${event.userId} with malformed data — ignored`);
      return;
    }
    const s = deps.getStrings();
    if (!(await isLineManager(event, deps))) {
      onLog(`[line] invite tap refused for ${event.userId} — not the owner`);
      await replyByToken(deps.getClient(), event.replyToken, t(s, 'line.invite.ownerOnly'), onLog);
      return;
    }
    const known = revokeListedInvite(store, press.code);
    if (known) onLog(`[line] pairing code revoked from LINE by ${event.userId}`);
    const notice = t(s, known ? 'telegram.invite.toast.revoked' : 'telegram.invite.toast.gone');
    const card = lineInviteCardMessage(null, store.list(), s, notice);
    await replyByToken(deps.getClient(), event.replyToken, card ?? `${notice}\n\n${t(s, 'telegram.invite.none')}`, onLog);
  }

  return { handleCommand, handlePostback };
}

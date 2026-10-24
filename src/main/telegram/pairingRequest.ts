/**
 * Someone who is not paired writes to the bot in a private chat (anything but `/start <code>` and
 * `/init`, which pair as before): they are told the managers were asked, and — for a new request,
 * within the day's allowance (`noteBotPairingRequest`) — every manager gets the request's card.
 * With no manager at all there is nobody to ask, so they get the pairing tip as before.
 */
import { t } from '../i18n';
import { actorEnv, offerPairingRequest } from './accountAdmin';
import type { ManagedAccount } from './accountAdminViews';
import type { PairingUserProfile } from './dmPolicy';
import type { TelegramCommandOptions, TelegramContext } from './commandHandlers';

type PairingRequestOptions = Pick<TelegramCommandOptions, 'getStrings' | 'isPairedUser' | 'onLog' | 'onUse' | 'accountAdmin'>;

/** Whether this update is an unpaired person writing in their private chat with the bot. */
export function isUnpairedPrivate(ctx: TelegramContext, options: Pick<TelegramCommandOptions, 'isPairedUser'>): boolean {
  return Boolean(ctx.from && ctx.chat?.type === 'private' && ctx.chat.id === ctx.from.id && !options.isPairedUser(ctx.from.id));
}

function profileOf(from: NonNullable<TelegramContext['from']>): PairingUserProfile {
  return {
    userId: from.id,
    ...(from.username ? { username: from.username } : {}),
    ...(from.first_name ? { firstName: from.first_name } : {}),
    ...(from.last_name ? { lastName: from.last_name } : {}),
  };
}

function fallbackAccount(profile: PairingUserProfile): ManagedAccount {
  return {
    id: String(profile.userId),
    name: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    ...(profile.username ? { username: profile.username } : {}),
    state: 'requested',
    owner: false,
    admin: false,
    grants: [],
  };
}

export async function handlePairingRequest(ctx: TelegramContext, options: PairingRequestOptions): Promise<void> {
  const from = ctx.from;
  if (!from || !isUnpairedPrivate(ctx, options)) return;
  const s = options.getStrings();
  const profile = profileOf(from);
  options.onUse?.(profile, from.id);
  const deps = options.accountAdmin;
  if (!deps) {
    await ctx.reply(t(s, 'telegram.cmd.pairingTip'));
    return;
  }
  let managers: number[] = [];
  try {
    managers = (await deps.getManagerIds()).filter((id) => id !== from.id);
  } catch (err: unknown) {
    options.onLog(`[telegram] could not read the managers: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Recorded even with nobody to message: the settings page lists it and can allow it.
  const announce = await deps.noteRequest(profile).catch((err: unknown) => {
    options.onLog(`[telegram] could not record ${from.id}'s request: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  });
  if (managers.length === 0) {
    await ctx.reply(t(s, 'telegram.cmd.pairingTip'));
    return;
  }
  await ctx.reply(t(s, 'telegram.users.request.sent'));
  if (!announce) return;
  // Not awaited: updates are handled one at a time, and the managers' cards must not hold the next one.
  void (async () => {
    const account = (await deps.getAccount(String(from.id))) ?? fallbackAccount(profile);
    const sent = await offerPairingRequest(
      (chatId, view) => ctx.api.sendMessage(chatId, view.text, { reply_markup: view.keyboard }),
      account,
      managers,
      (managerId) => actorEnv(managerId, deps, options.getStrings()),
      options.onLog,
    );
    if (sent > 0) options.onLog(`[telegram] ${from.id}'s pairing request sent to ${sent} manager(s)`);
  })().catch((err: unknown) => {
    options.onLog(`[telegram] could not send ${from.id}'s pairing request: ${err instanceof Error ? err.message : String(err)}`);
  });
}

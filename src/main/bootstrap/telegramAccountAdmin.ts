/**
 * What the Telegram bot's account management (`/users`, request cards, `/invite`) reads and writes,
 * from the config, the contact directory and the memory file — through the same writes as the
 * settings page. Also registers Telegram's pairer with the platform-neutral pairing requests
 * (`registerBotPairer`), so the settings page's "Allow" pairs through the running bot too.
 */
import { IPC } from '../../shared/types';
import type { BotGrant } from '../../shared/botPermissions';
import {
  approveBotPairingRequest,
  noteBotPairingRequest,
  registerBotPairer,
  setBotPermissions,
  setBotUserBlockedAnsweringRequest,
} from '../botPermissions';
import { findManagedAccount, isBuiltinConnectorOn, listManagedAccounts } from '../botPermissions/managedAccounts';
import type { ManagedAccountSource } from '../botPermissions/managedAccounts';
import { findBotContact } from '../botDirectory';
import { config } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { getTelegramRuntimeSnapshot } from '../telegramBridge';
import {
  issueTelegramPairingCode,
  revokeTelegramPairingCode,
  unpairTelegramAccount,
  validTelegramPairingCodes,
} from '../telegramAccounts';
import type { AccountAdminDeps } from '../telegram/accountAdmin';
import type { InviteDeps } from '../telegram/inviteAdmin';
import type { TelegramRuntime } from '../telegram';

const TELEGRAM_ACCOUNTS: ManagedAccountSource = {
  platform: 'telegram',
  paired: () => config.telegram.pairing.pairedUsers.map((user) => ({
    id: String(user.userId),
    name: [user.firstName, user.lastName].filter(Boolean).join(' '),
    ...(user.username ? { username: user.username } : {}),
  })),
  isUserId: (id) => /^\d{1,20}$/.test(id),
};

/** The account cards' source; `getRuntime` is read at press time (the runtime is built after this). */
export function telegramAccountAdmin(
  getRuntime: () => TelegramRuntime | null,
  getManagerIds: () => Promise<number[]>,
): AccountAdminDeps {
  const refreshMenus = async (): Promise<void> => { await getRuntime()?.refreshBotCommands(); };
  return {
    listAccounts: () => listManagedAccounts(TELEGRAM_ACCOUNTS),
    getAccount: (userId) => findManagedAccount(TELEGRAM_ACCOUNTS, userId),
    approve: (userId) => approveBotPairingRequest({ platform: 'telegram', userId }),
    setBlocked: async (userId, blocked) => {
      const result = await setBotUserBlockedAnsweringRequest({ platform: 'telegram', userId, blocked });
      if (!result.ok) return false;
      sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
      return true;
    },
    // The settings page's write; it refetches on the broadcast, and the "/" menus follow the grants.
    setGrants: (userId, grants: BotGrant[]) => {
      const result = setBotPermissions({ platform: 'telegram', userId, grants });
      if (!result.ok) {
        sendLog(`[bot] permissions change from Telegram refused: ${result.reason}`);
        return false;
      }
      sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
      void refreshMenus().catch(() => undefined);
      return true;
    },
    unpair: (userId) => unpairTelegramAccount(Number(userId), refreshMenus),
    isConnectorOn: isBuiltinConnectorOn,
    getManagerIds,
    noteRequest: async (profile) => {
      const id = String(profile.userId);
      const before = (await findBotContact('telegram', 'user', id))?.pairingRequestedAt;
      const announce = await noteBotPairingRequest('telegram', {
        userId: id,
        ...(profile.username ? { username: profile.username } : {}),
        ...(profile.firstName ? { firstName: profile.firstName } : {}),
        ...(profile.lastName ? { lastName: profile.lastName } : {}),
      });
      // A new request shows on the settings page at once, cards or not.
      const after = (await findBotContact('telegram', 'user', id))?.pairingRequestedAt;
      if (after && after !== before) sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
      return announce;
    },
  };
}

/** `/invite`'s codes: the settings page's store. */
export function telegramInvites(): Omit<InviteDeps, 'rememberIssuer'> {
  return {
    issue: () => {
      try {
        return issueTelegramPairingCode();
      } catch (err: unknown) {
        sendLog(`[telegram] could not issue a pairing code from Telegram: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    list: () => validTelegramPairingCodes().map(({ code, expiresAt }) => ({ code, expiresAt })),
    revoke: (code) => {
      revokeTelegramPairingCode(code);
      return true;
    },
  };
}

/**
 * Telegram's pairer for `approveBotPairingRequest`: the running bot pairs the id (default grants,
 * directory, save, broadcast, menus) and tells the person.
 */
export function registerTelegramPairer(runtime: TelegramRuntime): void {
  registerBotPairer('telegram', (profile) => {
    const userId = Number(profile.userId);
    if (!/^\d{1,20}$/.test(profile.userId) || !Number.isSafeInteger(userId)) return 'failed';
    return runtime.pairWithoutCode({
      userId,
      ...(profile.username ? { username: profile.username } : {}),
      ...(profile.firstName ? { firstName: profile.firstName } : {}),
      ...(profile.lastName ? { lastName: profile.lastName } : {}),
    });
  });
}

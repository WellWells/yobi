/**
 * What the LINE bot's account management (`/users`, request cards, `/invite`) reads and writes,
 * through the same writes as the settings page, and LINE's pairer for the platform-neutral
 * pairing requests (`registerBotPairer`), so the settings page's "Allow" pairs through it too.
 */
import { IPC } from '../../shared/types';
import type { BotGrant } from '../../shared/botPermissions';
import {
  approveBotPairingRequest,
  noteBotPairingRequest,
  pairedMenuAccess,
  registerBotPairer,
  setBotPermissions,
  setBotUserBlockedAnsweringRequest,
} from '../botPermissions';
import { findManagedAccount, isBuiltinConnectorOn, listManagedAccounts } from '../botPermissions/managedAccounts';
import type { ManagedAccountSource } from '../botPermissions/managedAccounts';
import type { InviteStore } from '../botPermissions/invites';
import { clearBotPairingRequest, findBotContact } from '../botDirectory';
import { config } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { getLineRuntimeSnapshot } from '../lineBridge';
import { issueLineAccountCode, revokeLineAccountCode, unpairLineAccount, validLinePairingCodes } from '../lineAccounts';
import type { LineAccountAdminSource } from '../line/accountAdmin';
import type { LineRuntime } from '../line';

const LINE_ACCOUNTS: ManagedAccountSource = {
  platform: 'line',
  paired: () => config.line.pairing.pairedUsers.map((user) => ({ id: user.userId, name: user.displayName ?? '' })),
  isUserId: (id) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id),
};

/** The settings page refetches its LINE snapshot on this broadcast. */
function announce(): void {
  sendToRenderer(IPC.LINE_RUNTIME, getLineRuntimeSnapshot());
}

/** The owner's account cards' source. */
export function lineAccountAdmin(): LineAccountAdminSource {
  return {
    listAccounts: () => listManagedAccounts(LINE_ACCOUNTS),
    getAccount: (userId) => findManagedAccount(LINE_ACCOUNTS, userId),
    approve: async (userId) => {
      const result = await approveBotPairingRequest({ platform: 'line', userId });
      if (result.ok) announce();
      return result;
    },
    setBlocked: async (userId, blocked) => {
      const result = await setBotUserBlockedAnsweringRequest({ platform: 'line', userId, blocked });
      if (!result.ok) return false;
      announce();
      return true;
    },
    setGrants: (userId, grants: BotGrant[]) => {
      const result = setBotPermissions({ platform: 'line', userId, grants });
      if (!result.ok) {
        sendLog(`[bot] permissions change from LINE refused: ${result.reason}`);
        return false;
      }
      announce();
      return true;
    },
    unpair: async (userId) => unpairLineAccount(userId),
    isConnectorOn: isBuiltinConnectorOn,
    // LINE has no admin grant: the owner alone.
    getManagerIds: async () => (await pairedMenuAccess('line')).filter((entry) => entry.flowAdmin).map((entry) => entry.userId),
    noteRequest: async ({ userId, displayName }) => {
      const before = (await findBotContact('line', 'user', userId))?.pairingRequestedAt;
      // LINE's display name goes where the directory keeps a first name, as `recordBotUse` does.
      const announceCard = await noteBotPairingRequest('line', { userId, ...(displayName ? { firstName: displayName } : {}) });
      const after = (await findBotContact('line', 'user', userId))?.pairingRequestedAt;
      if (after && after !== before) announce();
      return announceCard;
    },
  };
}

/** `/invite`'s codes: the settings page's store. */
export function lineInvites(): InviteStore {
  return {
    issue: () => {
      try {
        return issueLineAccountCode();
      } catch (err: unknown) {
        sendLog(`[line] could not issue a pairing code from LINE: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    list: () => validLinePairingCodes().map(({ code, expiresAt }) => ({ code, expiresAt })),
    revoke: (code) => {
      revokeLineAccountCode(code);
      return true;
    },
  };
}

/** A code pairing answers the person's request too, and the settings page shows the new account. */
export function afterLineCodePairing(userId: string): void {
  void clearBotPairingRequest('line', userId).catch(() => undefined);
  announce();
}

/**
 * LINE's pairer for `approveBotPairingRequest`: the running bot pairs the id (default grants, the
 * saved pairing) and tells the person with their command list.
 */
export function registerLinePairer(runtime: Pick<LineRuntime, 'pairWithoutCode'>): void {
  registerBotPairer('line', async (profile) => {
    const outcome = await runtime.pairWithoutCode({
      userId: profile.userId,
      ...(profile.firstName ? { displayName: profile.firstName } : {}),
    });
    if (outcome === 'paired') announce();
    return outcome;
  });
}

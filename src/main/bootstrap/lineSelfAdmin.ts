/**
 * What LINE PC's `Yobi /users` and `Yobi /groups` read and write: the settings page's own writes
 * (approve, block, grants, unpair, group grants), each followed by the broadcast the settings page
 * refetches on — so a change made from LINE shows there at once.
 */
import type { BotGrant, BotGroupGrant } from '../../shared/botPermissions';
import {
  approveBotPairingRequest,
  setBotGroupPermissions,
  setBotPermissions,
  setBotUserBlockedAnsweringRequest,
} from '../botPermissions';
import { getBotAudience } from '../botPermissions/audience';
import { findManagedAccount, isBuiltinConnectorOn, listManagedAccounts } from '../botPermissions/managedAccounts';
import type { ManagedAccountSource } from '../botPermissions/managedAccounts';
import { config } from '../config';
import { sendLog } from '../helpers';
import { announceSocketBotRuntime, unpairSocketBotAccount } from '../socketBotBridge';
import type { LineSelfAdminSource } from '../lineSelf/admin';
import { isLineDirectChat } from '../lineSelf/chats';

const LINE_SELF_ACCOUNTS: ManagedAccountSource = {
  platform: 'lineSelf',
  paired: () => config.lineSelf.pairing.pairedUsers.map((user) => ({ id: user.userId, name: user.displayName ?? '' })),
  // A LINE person's id is `u` and 32 hex digits — the same shape as a 1:1 chat's id.
  isUserId: isLineDirectChat,
};

function announce(): void {
  announceSocketBotRuntime('lineSelf');
}

export function lineSelfAdminSource(): LineSelfAdminSource {
  return {
    listAccounts: () => listManagedAccounts(LINE_SELF_ACCOUNTS),
    getAccount: (userId) => findManagedAccount(LINE_SELF_ACCOUNTS, userId),
    approve: async (userId) => {
      const result = await approveBotPairingRequest({ platform: 'lineSelf', userId });
      if (result.ok) announce();
      return result;
    },
    setBlocked: async (userId, blocked) => {
      const result = await setBotUserBlockedAnsweringRequest({ platform: 'lineSelf', userId, blocked });
      if (!result.ok) return false;
      announce();
      return true;
    },
    setGrants: (userId, grants: BotGrant[]) => {
      const result = setBotPermissions({ platform: 'lineSelf', userId, grants });
      if (!result.ok) {
        sendLog(`[bot] permissions change from LINE PC refused: ${result.reason}`);
        return false;
      }
      announce();
      return true;
    },
    unpair: async (userId) => unpairSocketBotAccount('lineSelf', userId),
    isConnectorOn: isBuiltinConnectorOn,
    listGroups: async () => (await getBotAudience('lineSelf')).groups.map(({ id, title, pending, grants }) => ({
      id,
      ...(title ? { title } : {}),
      pending,
      grants,
    })),
    setGroupGrants: (chatId, grants: BotGroupGrant[]) => {
      const result = setBotGroupPermissions({ platform: 'lineSelf', chatId, grants });
      if (!result.ok) {
        sendLog(`[bot] group permissions change from LINE PC refused: ${result.reason}`);
        return false;
      }
      announce();
      return true;
    },
  };
}

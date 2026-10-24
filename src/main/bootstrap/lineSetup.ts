import { IPC } from '../../shared/types';
import {
  notifyBotGroupJoined,
  pairedMenuAccess,
  setBotGroupPermissions,
} from '../botPermissions';
import { getBotAudience } from '../botPermissions/audience';
import { isBuiltinConnectorOn } from '../botPermissions/managedAccounts';
import { afterLineCodePairing, lineAccountAdmin, lineInvites, registerLinePairer } from './lineAccountAdmin';
import { config } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { LineRuntime } from '../line';
import type { LineTextEvent } from '../line/events';
import {
  consumeLinePairingCode,
  getLineRuntimeSnapshot,
  isLinePairedUser,
  pairLineUserWithoutCode,
  setLineRuntimeSnapshot,
} from '../lineBridge';
import { botChatDeps } from './botChatDeps';
import type { FlowManager } from '../flow';

export function createLineRuntime(deps: {
  getFlowManager: () => FlowManager | null;
}): LineRuntime {
  const { getFlowManager } = deps;

  const runtime = new LineRuntime({
    ...botChatDeps<LineTextEvent>('line', getFlowManager),
    getEnabled: () => config.line.enabled,
    getChannelAccessToken: () => config.line.channelAccessToken,
    getChannelSecret: () => config.line.channelSecret,
    getPort: () => config.line.port,
    isPairedUser: (userId) => isLinePairedUser(userId),
    consumePairingCode: (code, user) => consumeLinePairingCode(code, user),
    pairWithoutCode: (user) => pairLineUserWithoutCode(user),
    onCodePaired: (_code, userId) => afterLineCodePairing(userId),
    accountAdmin: lineAccountAdmin(),
    invites: lineInvites(),
    onGroupJoined: (group) => {
      const first = notifyBotGroupJoined('line', { id: group.chatId, ...(group.title ? { title: group.title } : {}) });
      if (first) sendLog(`[line] added to ${group.chatKind} ${group.chatId} — waiting for approval`);
      return first;
    },
    groupAdmin: {
      listGroups: async () => (await getBotAudience('line')).groups.map(({ id, title, pending, grants }) => ({
        id,
        ...(title ? { title } : {}),
        pending,
        grants,
      })),
      // The same write as the settings page; the page refetches on the runtime broadcast.
      setGrants: (chatId, grants) => {
        const result = setBotGroupPermissions({ platform: 'line', chatId, grants });
        if (!result.ok) {
          sendLog(`[bot] group permissions change from LINE refused: ${result.reason}`);
          return false;
        }
        sendToRenderer(IPC.LINE_RUNTIME, getLineRuntimeSnapshot());
        return true;
      },
      isConnectorOn: isBuiltinConnectorOn,
      // LINE has no admin grant: the owner alone.
      getManagerIds: async () => (await pairedMenuAccess('line')).filter((entry) => entry.flowAdmin).map((entry) => entry.userId),
    },
    onRuntime: (snapshot) => {
      setLineRuntimeSnapshot(snapshot);
      sendToRenderer(IPC.LINE_RUNTIME, snapshot);
    },
  });
  // The settings page's "Allow" on a LINE pairing request pairs through this runtime.
  registerLinePairer(runtime);
  return runtime;
}

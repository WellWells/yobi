/**
 * Creates the socket platforms' runtimes (Discord, Slack) with the shared router wiring
 * (`botChatDeps`) and what the socket platforms have in common: pairing by code in the shared
 * bridge, pairing requests the settings page allows, the agent's question buttons, and the
 * notice when someone addresses the bot in a group still waiting for approval.
 */
import { IPC, SOCKET_BOT_PLATFORMS, SOCKET_BOT_SECRET_FIELDS } from '../../shared/types';
import type { SocketBotPlatform } from '../../shared/types';
import { notifyBotGroupJoined, noteBotPairingRequest, registerBotPairer } from '../botPermissions';
import { clearBotPairingRequest } from '../botDirectory';
import { config } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { botChatKey, markAgentAskShown, pendingAgentAskRunId } from '../botBuiltinCommands';
import type { BotChatEvent } from '../botChat/types';
import type { SocketBotRuntime, SocketBotRuntimeDeps } from '../botChat/socketRuntime';
import {
  announceSocketBotRuntime,
  consumeSocketBotPairingCode,
  isSocketBotPairedUser,
  pairSocketBotUserWithoutCode,
  setSocketBotRuntimeSnapshot,
  socketBotSecret,
} from '../socketBotBridge';
import { DiscordRuntime } from '../discord/runtime';
import type { DiscordTextEvent } from '../discord/events';
import { SlackRuntime } from '../slack/runtime';
import type { SlackTextEvent } from '../slack/events';
import { botChatDeps } from './botChatDeps';
import type { FlowManager } from '../flow';

export type SocketBotRuntimes = Readonly<Record<SocketBotPlatform, SocketBotRuntime<BotChatEvent>>>;

function socketDeps<E extends BotChatEvent>(platform: SocketBotPlatform, getFlowManager: () => FlowManager | null): SocketBotRuntimeDeps<E> {
  return {
    ...botChatDeps<E>(platform, getFlowManager),
    getEnabled: () => config[platform].enabled,
    getSecrets: () => Object.fromEntries(SOCKET_BOT_SECRET_FIELDS[platform].map((field) => [field, socketBotSecret(platform, field)])),
    isPairedUser: (userId) => isSocketBotPairedUser(platform, userId),
    consumePairingCode: (code, user) => consumeSocketBotPairingCode(platform, code, user),
    pairWithoutCode: (user) => pairSocketBotUserWithoutCode(platform, user),
    onCodePaired: (_code, userId) => {
      void clearBotPairingRequest(platform, userId).catch(() => undefined);
      announceSocketBotRuntime(platform);
    },
    notePairingRequest: async ({ userId, displayName }) => {
      await noteBotPairingRequest(platform, { userId, ...(displayName ? { firstName: displayName } : {}) });
      announceSocketBotRuntime(platform);
    },
    pendingAgentAskRunId: (chatId, userId) => pendingAgentAskRunId(botChatKey(platform, chatId, userId)),
    onAgentAskShown: (chatId, userId, shown) => markAgentAskShown(botChatKey(platform, chatId, userId), shown),
    onPendingGroupAddressed: (group) => {
      if (notifyBotGroupJoined(platform, { id: group.chatId, ...(group.title ? { title: group.title } : {}) })) {
        sendLog(`[${platform}] addressed in ${group.chatId}, which waits for approval`);
      }
    },
    onRuntime: (snapshot) => {
      setSocketBotRuntimeSnapshot(snapshot);
      sendToRenderer(IPC.SOCKET_BOT_RUNTIME, snapshot);
    },
  };
}

/** The settings page's "Allow" on a pairing request pairs through the running bot, which tells the person. */
function registerPairer(platform: SocketBotPlatform, runtime: SocketBotRuntime<BotChatEvent>): void {
  registerBotPairer(platform, async (profile) => {
    const outcome = await runtime.pairWithoutCode({
      userId: profile.userId,
      ...(profile.firstName ? { displayName: profile.firstName } : {}),
    });
    if (outcome === 'paired') announceSocketBotRuntime(platform);
    return outcome;
  });
}

export function createSocketBotRuntimes(deps: { getFlowManager: () => FlowManager | null }): SocketBotRuntimes {
  const runtimes: SocketBotRuntimes = {
    discord: new DiscordRuntime(socketDeps<DiscordTextEvent>('discord', deps.getFlowManager)) as unknown as SocketBotRuntime<BotChatEvent>,
    slack: new SlackRuntime(socketDeps<SlackTextEvent>('slack', deps.getFlowManager)) as unknown as SocketBotRuntime<BotChatEvent>,
  };
  for (const platform of SOCKET_BOT_PLATFORMS) registerPairer(platform, runtimes[platform]);
  return runtimes;
}

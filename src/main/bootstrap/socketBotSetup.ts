/**
 * Creates the socket platforms' runtimes (Discord, Slack, LINE PC) with the shared router wiring
 * (`botChatDeps`) and what the socket platforms have in common: pairing by code in the shared
 * bridge, pairing requests the settings page allows, the agent's question buttons, and the
 * notice when someone addresses the bot in a group still waiting for approval.
 */
import { IPC, SOCKET_BOT_PLATFORMS, SOCKET_BOT_SECRET_FIELDS } from '../../shared/types';
import type { SocketBotPlatform } from '../../shared/types';
import { notifyBotGroupJoined, noteBotPairingRequest, registerBotPairer } from '../botPermissions';
import { clearBotPairingRequest, listBotContacts } from '../botDirectory';
import { config, getHiddenSources } from '../config';
import { uploadFallbackUrl } from '../botChat/attachmentPlan';
import { sweepOrphanTempAttachments } from '../botChat/mediaTemp';
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
import { isLineDirectChat } from '../lineSelf/chats';
import { pairLineSelfOwner } from '../lineSelf/owner';
import { LineSelfRuntime, type LineSelfTextEvent } from '../lineSelf/runtime';
import { onLineReaderSwitched } from '../line/readerSwitch';
import { botChatDeps } from './botChatDeps';
import { lineSelfAdminSource } from './lineSelfAdmin';
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
    notePairingRequest: async ({ userId, displayName }, group) => {
      const told = await noteBotPairingRequest(platform, { userId, ...(displayName ? { firstName: displayName } : {}) }, new Date(), group);
      announceSocketBotRuntime(platform);
      return told;
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

/**
 * LINE PC: the user's own account, read through the LINE connector. Nothing to pair or bind: the
 * account pairs itself as the user's when the bot connects, "Yobi" works in any group and in any
 * 1:1 chat from either side, and anyone else's "Yobi" asks the owner to let them in. The LINE
 * modules load the native database driver, so they are imported when first used.
 */
function createLineSelfRuntime(getFlowManager: () => FlowManager | null): LineSelfRuntime {
  const shared = socketDeps<LineSelfTextEvent>('lineSelf', getFlowManager);
  // A request's photos are scratch copies deleted when its run ends; a run cut short leaves some.
  void sweepOrphanTempAttachments().then((removed) => {
    if (removed > 0) sendLog(`[lineSelf] swept ${removed} orphaned media temp file(s)`);
  });
  return new LineSelfRuntime({
    ...shared,
    // A 1:1 chat the user said "Yobi" in is no group for the settings page to list.
    onGroupSeen: (group) => {
      if (!isLineDirectChat(group.chatId)) shared.onGroupSeen?.(group);
    },
    readerEnabled: () => config.lineReaderEnabled,
    service: async () => (await import('../line/sharedService')).getSharedLineService(),
    scanTokens: async () => (await import('../line/tokenExtractor')).extractAccessTokens(),
    coreProblem: async () => (await import('../line/nativeLineCore')).nativeCoreProblem(),
    pictureFile: async (url) => (await import('../lineSelf/pictures')).appLinePictureFile(url, sendLog),
    photoFile: async (file) => (await import('../lineSelf/pictures')).appLinePhotoFile(file, sendLog),
    uploadFallbackUrl: () => uploadFallbackUrl(getHiddenSources()),
    appModelUrl: () => config.targetUrl,
    ensureOwner: async (owner) => {
      if (await pairLineSelfOwner(owner)) sendLog(`[lineSelf] paired ${owner.userId} as your own account`);
    },
    knownChats: async () => (await listBotContacts({ platform: 'lineSelf', kind: 'chat' }))
      .filter((contact) => contact.reachability !== 'removed')
      .map((contact) => contact.id),
    // Any group or friend LINE PC has: what the flow editor's recipient list offers.
    liveChat: async (chatId) => {
      if (!config.lineReaderEnabled || process.platform !== 'win32') return null;
      const [{ getSharedLineService }, { findLineSelfTarget }] = await Promise.all([
        import('../line/sharedService'),
        import('../lineSelf/targets'),
      ]);
      return findLineSelfTarget(getSharedLineService(), chatId);
    },
    admin: lineSelfAdminSource(),
  });
}

export function createSocketBotRuntimes(deps: { getFlowManager: () => FlowManager | null }): SocketBotRuntimes {
  const runtimes: SocketBotRuntimes = {
    discord: new DiscordRuntime(socketDeps<DiscordTextEvent>('discord', deps.getFlowManager)) as unknown as SocketBotRuntime<BotChatEvent>,
    slack: new SlackRuntime(socketDeps<SlackTextEvent>('slack', deps.getFlowManager)) as unknown as SocketBotRuntime<BotChatEvent>,
    lineSelf: createLineSelfRuntime(deps.getFlowManager) as unknown as SocketBotRuntime<BotChatEvent>,
  };
  for (const platform of SOCKET_BOT_PLATFORMS) registerPairer(platform, runtimes[platform]);
  onLineReaderSwitched(() => { void runtimes.lineSelf.reconnect(); });
  return runtimes;
}

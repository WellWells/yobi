import { Bot } from 'grammy';
import type {
  BotLlmDirectConfig,
  FlowExecutionResult,
  TelegramChannel,
  TelegramOutputChoice,
  TelegramPairingState,
  TelegramReplyMode,
  TelegramReplyTarget,
  TelegramRuntimeSnapshot,
  TelegramRuntimeStatus,
} from '../../shared/types';
import { Mutex } from '../flow/lanes';
import type { LinkSiteFilter } from '../../shared/linkRecognition';
import { createPairingBridge } from './dmPolicy';
import type { PairingBridge, PairingUserProfile } from './dmPolicy';
import { attachChannelDiscovery, forgetChannel } from './channels';
import { attachChannelDirectMessagesFilter } from './channelDirectMessages';
import { collectDirectoryCandidates, runDirectoryBackfill } from './directory';
import type { DirectorySources } from './directory';
import { attachPresenceTracking } from './presence';
import {
  forgetBotChat,
  markBotReachable,
  markBotUnreachable,
  recordBotContact,
  trackBotSend,
  type BotContactKind,
} from '../botDirectory';
import {
  attachTelegramHandlers,
  syncPrivateCommands,
  type CommandMenuOptions,
  type MenuAccountAccess,
  type TelegramContext,
  type TelegramTaskRequest,
} from './commands';
import type { MediaIntake } from './mediaIntake';
import type { TelegramBuiltinRequest } from './commandHandlers';
import { sharedGroupChatLog } from './groupChatArchive';
import { createBotRequestPace } from '../botRequestPace';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';
import type { BotBuiltinCommandKey, BotRunKind } from '../../shared/types';
import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import type { AgentAskShown, BotBuiltinRunResult, BotMessageSent } from '../botBuiltinCommands';
import { t } from '../i18n';
import { getErrorMessage } from './errors';
import { ExportTokenRegistry, TELEGRAM_EXPORT_CB_PREFIX } from './exporter';
import type { TelegramExportContext, TelegramExportFormat } from './exporter';
import { handleExportCallback } from './exportHandlers';
import * as messaging from './messaging';
import type { BotSendExtras, TelegramSendAs } from '../flow/types';
import { clearFlowButtons } from './flowButtons';
import { clearAskButtons, clearRetiredButtons, retireAskButtons } from './askButtons';
import { TelegramCallbackRouter } from './callbackRouter';
import { offerGroupApproval } from './groupAdmin';
import type { GroupAdminDeps, GroupAdminSource } from './groupAdmin';
import type { AccountAdminDeps } from './accountAdmin';
import type { InviteDeps } from './inviteAdmin';
import { InviteIssuers, tellInviteIssuer } from './inviteIssuers';
import type { TelegramMessagingContext, TelegramTaskSuccessPayload } from './messaging';
import { telegramFetchCompat } from './fetchCompat';
import { sendAnswerToTelegram } from '../chat/answerPictures';
import { queuedMessageProgress } from './progressMessage';
import type { StepProgress } from '../../shared/stepProgress';

export interface TelegramRuntimeDeps {
  getEnabled: () => boolean;
  getToken: () => string;
  getAllowGroupCommands: () => boolean;
  getLlmDirect: () => BotLlmDirectConfig;
  getDefaultReplyMode: () => TelegramReplyMode;
  getCompactReply: () => boolean;
  getPairing: () => TelegramPairingState;
  savePairing: (next: TelegramPairingState) => void;
  /** An id has just paired with a code: give it the default grants (saved with the pairing). */
  grantPairingDefaults?: (userId: number) => void;
  getChannels: () => TelegramChannel[];
  saveChannels: (next: TelegramChannel[]) => void;
  getDirectorySources: () => Promise<Omit<DirectorySources, 'channels' | 'pairedUserIds'>>;
  isAdminUser: (userId: number) => boolean;
  /** Whether an account may type a built-in command in a chat (its grants). */
  canUseBuiltin?: (key: BotBuiltinCommandKey, userId: number, chatId: number) => Promise<boolean>;
  /** Whether an account's pasted link may run the downloader in a chat (its download grant). */
  canUseDownloader?: (userId: number, chatId: number) => Promise<boolean>;
  /** Which sites' pasted links run their built-in (Settings › Recognize links). */
  linkSites?: () => LinkSiteFilter;
  /** Whether someone may talk to the bot in a chat (paired, or a group's grant). */
  canChat?: (userId: number, chatId: number) => Promise<boolean>;
  /** Whether an account may run a flow command limited to admins in a chat. */
  isFlowAdmin?: (userId: number, chatId: number) => Promise<boolean>;
  /** Blocked by the owner. */
  isBlocked?: (userId: number) => boolean;
  /** A group the owner has not allowed yet: the bot ignores everything in it. */
  isGroupPending?: (chatId: number) => boolean;
  /** The bot was just added to a group (not a channel). */
  onGroupJoined?: (group: { id: string; title?: string }) => void;
  /** `/groups`, and a joined group's card sent to the admins. Absent = groups are managed in settings only. */
  groupAdmin?: GroupAdminSource;
  /** `/users`, pairing requests and their cards. Absent = accounts are managed in settings only. */
  accountAdmin?: AccountAdminDeps;
  /** `/invite`: the settings page's pairing-code store. */
  invites?: Omit<InviteDeps, 'rememberIssuer'>;
  /** An unpaired person addressed the bot in a chat. */
  onUse?: (user: PairingUserProfile, chatId: number) => void;
  /** Per paired account, what its own private-chat "/" menu should add to the shared one. */
  getMenuAccess?: () => Promise<MenuAccountAccess[]>;
  onTaskRequest: (request: TelegramTaskRequest) => Promise<{ taskId: string }>;
  onStatusRequest: () => string;
  onRestartApp?: () => void;
  onUpdateOutputChoice: (choice: TelegramOutputChoice) => boolean;
  onExportRequest: (
    request: TelegramExportContext & { format: TelegramExportFormat },
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  onLog: (message: string) => void;
  onRuntime: (snapshot: TelegramRuntimeSnapshot) => void;
  getStrings: () => Record<string, string>;
  getProviderCommands: () => ResolvedProviderCommand[];
  getBuiltinCommands: () => ResolvedBuiltinCommand[];
  onBuiltinCommand: (
    key: BotRunKind,
    input: string,
    targetUrl: string,
    chatId: number,
    userId: number,
    onProgressText: (text: string) => void,
    chat?: Pick<TelegramBuiltinRequest, 'replyTo' | 'recentChat' | 'chatRecap'>,
  ) => Promise<BotBuiltinRunResult>;
  onAgentAnswer: (
    answer: string,
    chatId: number,
    userId: number,
    onProgressText: (text: string) => void,
  ) => Promise<BotBuiltinRunResult | null>;
  hasPendingAgentAsk: (chatId: number, userId: number, sent?: BotMessageSent) => boolean;
  pendingAgentAskRunId: (chatId: number, userId: number) => string | null;
  /** The question went out: its message, and whether its choices were numbered (buttons are not). */
  markAgentAskShown?: (chatId: number, userId: number, shown: AgentAskShown) => void;
  onDropAgentAsk: (chatId: number, userId: number) => void;
  onNewConversation: (chatId: number, userId: number) => Promise<boolean>;
  getFlowCommands?: () => Array<{
    flowId: string;
    command: string;
    description: string;
    inputVariable: string;
    access?: BotCommandAccessMode;
    allowedUserIds: string[];
  }>;
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: number,
    chatId: number,
    onProgress?: (progress: StepProgress) => void,
    messageId?: number,
    messageIsInput?: boolean,
  ) => Promise<{ taskId: string; result: Promise<FlowExecutionResult> }>;
  getEffectiveTargetUrl: () => string;
  getUploadFallbackUrl?: () => string;
  getByokContextBudgetChars: () => number;
}

export class TelegramRuntime {
  private bot: Bot<TelegramContext> | null = null;
  private status: TelegramRuntimeStatus = 'idle';
  private botUsername = '';
  /** What was said lately in each group: a request's context, and what `telegram_read` summarises. */
  private readonly groupChat = sharedGroupChatLog();
  /** How often each person may start work; kept across restarts of the bot, so a restart is no reset. */
  private readonly pace = createBotRequestPace();
  private readsAllGroupMessages: boolean | undefined;
  /** Groups whose approval card the admins already got this run. */
  private readonly offeredGroups = new Set<string>();
  /** Who issued each pairing code sent from Telegram (`/invite`). */
  private readonly inviteIssuers = new InviteIssuers();
  private readonly pairingBridge: PairingBridge;
  private errorMessage = '';
  private currentToken = '';
  private currentAllowGroupCommands = false;
  private pollerActive = false;
  private readonly lock = new Mutex();
  private mediaIntake: MediaIntake | null = null;
  private readonly registry = new ExportTokenRegistry();
  private readonly msgCtx: TelegramMessagingContext;

  constructor(private readonly deps: TelegramRuntimeDeps) {
    this.msgCtx = {
      getBot: () => this.bot,
      isPollerActive: () => this.pollerActive,
      getStrings: () => this.deps.getStrings(),
      getDefaultReplyMode: () => this.deps.getDefaultReplyMode(),
      getCompactReply: () => this.deps.getCompactReply(),
      registry: this.registry,
      onExportRequest: (request) => this.deps.onExportRequest(request),
      onLog: (message) => this.deps.onLog(message),
      onAgentAskShown: (target, shown) => this.deps.markAgentAskShown?.(target.chatId, target.userId, shown),
      pendingAgentAskRunId: (chatId, userId) => this.deps.pendingAgentAskRunId(chatId, userId),
    };
    this.pairingBridge = createPairingBridge(
      () => this.deps.getPairing(),
      (next) => this.deps.savePairing(next),
      (user) => {
        void recordBotContact({
          platform: 'telegram',
          kind: 'user',
          id: String(user.userId),
          ...(user.username ? { username: user.username } : {}),
          ...(user.firstName ? { firstName: user.firstName } : {}),
          ...(user.lastName ? { lastName: user.lastName } : {}),
          pairedAt: new Date().toISOString(),
        }).catch(() => undefined);
        // Its private "/" menu lists what its grants allow, the defaults it was just given too.
        void this.refreshBotCommands();
      },
      (userId) => this.deps.grantPairingDefaults?.(userId),
    );
    this.emitRuntime();
  }

  /**
   * A manager let this person in without a code (`/users`, a request card, the settings page):
   * paired with every effect a code pairing has, then told so in their private chat when the bot
   * is running. Idempotent: an id already paired changes nothing and is not messaged again.
   */
  pairWithoutCode(user: PairingUserProfile): 'paired' | 'alreadyPaired' | 'failed' {
    if (!Number.isSafeInteger(user.userId) || user.userId <= 0) return 'failed';
    if (!this.pairingBridge.pairWithoutCode(user)) return 'alreadyPaired';
    this.deps.onLog(`[telegram] ${user.userId} paired by a manager, without a code`);
    const bot = this.bot;
    if (bot && this.pollerActive) {
      void this.tracked(user.userId, () => bot.api.sendMessage(user.userId, t(this.deps.getStrings(), 'telegram.users.request.approvedDm')))
        .catch((err: unknown) => this.deps.onLog(`[telegram] could not tell ${user.userId} they were let in: ${getErrorMessage(err)}`));
    }
    return 'paired';
  }

  /** A code was used: when a manager issued it from Telegram, they get the new account's card. */
  private afterCodePairing(bot: Bot<TelegramContext>, code: string, userId: number): void {
    const issuerId = this.inviteIssuers.take(code);
    const deps = this.deps.accountAdmin;
    if (issuerId === undefined || !deps) return;
    void tellInviteIssuer({
      issuerId,
      userId,
      deps,
      isManager: async (managerId) => (await this.deps.isFlowAdmin?.(managerId, managerId)) === true,
      send: (chatId, view) => bot.api.sendMessage(chatId, view.text, { reply_markup: view.keyboard }),
      strings: this.deps.getStrings(),
      onLog: this.deps.onLog,
    });
  }

  getSnapshot(): TelegramRuntimeSnapshot {
    return {
      status: this.status,
      botUsername: this.botUsername || undefined,
      readsAllGroupMessages: this.readsAllGroupMessages,
      errorMessage: this.errorMessage || undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  async sendProactive(chatId: number, text: string, extras?: BotSendExtras): Promise<void> {
    await this.tracked(chatId, () => messaging.sendProactive(this.msgCtx, chatId, text, extras));
  }

  async sendProactiveFile(
    chatId: number,
    filePath: string,
    sendAs: TelegramSendAs,
    caption?: string,
    authorizedPaths?: string[],
    extras?: BotSendExtras,
  ): Promise<void> {
    await this.tracked(chatId, () => messaging.sendProactiveFile(
      this.msgCtx, chatId, filePath, sendAs, caption, authorizedPaths, extras,
    ));
  }

  async sendProactiveAlbum(chatId: number, filePaths: string[], caption?: string, authorizedPaths?: string[], replyTo?: number): Promise<void> {
    await this.tracked(chatId, () => messaging.sendProactiveAlbum(this.msgCtx, chatId, filePaths, caption, authorizedPaths, replyTo));
  }

  /**
   * Deletes one message: true when it went. Telegram lets a bot delete what others send only in a
   * private chat, or in a group where it may delete messages; anything else is refused, as is a
   * message over 48 hours old.
   */
  async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    const api = this.bot?.api;
    if (!api) return false;
    return api.deleteMessage(chatId, messageId).then(() => true, () => false);
  }

  async sendPictureReply(target: TelegramReplyTarget, files: readonly string[], caption: string): Promise<boolean> {
    return this.tracked(target.chatId, () => messaging.sendPictureReply(this.msgCtx, target, files, caption));
  }

  /**
   * A negative id is a group or channel, a positive one a user — the directory keeps them apart so
   * "blocked" is never reported against a channel, nor "kicked" against a person.
   */
  private async tracked<T>(chatId: number, send: () => Promise<T>): Promise<T> {
    const kind: BotContactKind = chatId < 0 ? 'chat' : 'user';
    return trackBotSend('telegram', kind, String(chatId), send);
  }

  async syncWithConfig(): Promise<void> {
    await this.lock.runExclusive(async () => {
      const enabled = this.deps.getEnabled();
      const token = this.deps.getToken().trim();
      const allowGroupCommands = this.deps.getAllowGroupCommands();
      const s = this.deps.getStrings();
      if (!enabled || !token) {
        await this.stopInternal();
        this.errorMessage = enabled && !token
          ? t(s, 'telegram.runtime.tokenRequired')
          : '';
        this.updateStatus('idle');
        return;
      }
      if (this.pollerActive && this.currentToken === token && this.currentAllowGroupCommands === allowGroupCommands) {
        if (this.bot) {
          try {
            await syncPrivateCommands(
              this.bot,
              allowGroupCommands,
              s,
              this.deps.getProviderCommands(),
              this.deps.getFlowCommands?.(),
              this.deps.getBuiltinCommands(),
              await this.menuOptions(),
            );
          } catch (err: unknown) {
            this.deps.onLog(`[telegram] failed to refresh localized commands: ${getErrorMessage(err)}`);
          }
        }
        return;
      }
      await this.startOrReplaceBot(token);
    });
  }

  async shutdown(): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.stopInternal();
      this.updateStatus('idle');
    });
  }

  private async menuOptions(): Promise<CommandMenuOptions> {
    let accounts: MenuAccountAccess[] = [];
    try {
      accounts = (await this.deps.getMenuAccess?.()) ?? [];
    } catch (err: unknown) {
      // Fails closed: without the grants every chat gets the shared menu only.
      this.deps.onLog(`[telegram] could not read per-account command access: ${getErrorMessage(err)}`);
    }
    return {
      pairedUserIds: this.deps.getPairing().pairedUsers.map((user) => user.userId),
      accounts,
      onLog: this.deps.onLog,
    };
  }

  async refreshBotCommands(): Promise<void> {
    await this.lock.runExclusive(async () => {
      const bot = this.bot;
      if (!bot || !this.pollerActive) return;
      try {
        await syncPrivateCommands(
          bot,
          this.deps.getAllowGroupCommands(),
          this.deps.getStrings(),
          this.deps.getProviderCommands(),
          this.deps.getFlowCommands?.(),
          this.deps.getBuiltinCommands(),
          await this.menuOptions(),
        );
      } catch (err: unknown) {
        this.deps.onLog(`[telegram] failed to refresh command menu: ${getErrorMessage(err)}`);
      }
    });
  }

  async sendTaskSuccess(
    target: TelegramReplyTarget,
    payload: TelegramTaskSuccessPayload,
  ): Promise<void> {
    await this.tracked(target.chatId, () => messaging.sendTaskSuccess(this.msgCtx, target, payload));
  }

  async sendTaskError(
    target: TelegramReplyTarget,
    payload: { providerLabel: string; message: string },
  ): Promise<void> {
    await this.tracked(target.chatId, () => messaging.sendTaskError(this.msgCtx, target, payload));
  }

  private async deliverBuiltinResult(
    target: TelegramReplyTarget,
    prompt: string,
    result: BotBuiltinRunResult,
  ): Promise<void> {
    const sendText = async (): Promise<void> => {
      const shown = await messaging.sendBuiltinReply(this.msgCtx, target, prompt, result);
      // A question the user never saw whole cannot be answered: no "1" may approve it.
      if (!shown) this.dropAgentAsk(target.chatId, target.userId);
    };
    // A picture reply sends no text: the buttons of the question the request dropped come off here.
    await messaging.clearStaleAskButtons(this.msgCtx, target);
    // A drawn picture is the reply itself, its words the caption (`sendAnswerToTelegram`).
    const files = result.ok && !result.question && !result.verbatim ? result.files ?? [] : [];
    await sendAnswerToTelegram(this, target, result.text, files, this.deps.getStrings(), sendText);
  }

  /** The question stops waiting, and its buttons come off with it (best effort, not awaited). */
  private dropAgentAsk(chatId: number, userId: number): void {
    this.deps.onDropAgentAsk(chatId, userId);
    void clearRetiredButtons(this.bot?.api, retireAskButtons(chatId, userId), this.deps.getStrings());
  }

  private async startOrReplaceBot(token: string): Promise<void> {
    this.errorMessage = '';
    this.updateStatus('starting');

    const { bot: candidate, intake } = this.createBot(token);
    let me: Awaited<ReturnType<typeof candidate.api.getMe>>;
    const s = this.deps.getStrings();
    try {
      me = await candidate.api.getMe();
    } catch (err: unknown) {
      this.errorMessage = t(s, 'telegram.runtime.tokenValidationFailed', {
        error: getErrorMessage(err),
      });
      this.updateStatus('error');
      throw err;
    }

    try {
      await syncPrivateCommands(
        candidate,
        this.deps.getAllowGroupCommands(),
        s,
        this.deps.getProviderCommands(),
        this.deps.getFlowCommands?.(),
        this.deps.getBuiltinCommands(),
        await this.menuOptions(),
      );
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] failed to sync command scope: ${getErrorMessage(err)}`);
    }

    await this.stopInternal();
    this.bot = candidate;
    this.mediaIntake = intake;
    this.currentToken = token;
    this.currentAllowGroupCommands = this.deps.getAllowGroupCommands();
    this.botUsername = me.username || '';
    this.readsAllGroupMessages = me.can_read_all_group_messages;
    this.pollerActive = true;
    this.registry.startPeriodicPrune();

    candidate.start().catch((err: unknown) => {
      if (this.bot !== candidate) return;
      if (err instanceof Error && (err.name === 'AbortError' || err.message === 'The operation was aborted.')) {
        this.deps.onLog('[telegram] bot polling stopped (aborted)');
        return;
      }
      this.pollerActive = false;
      this.errorMessage = t(s, 'telegram.runtime.pollingStopped', {
        error: getErrorMessage(err),
      });
      this.updateStatus('error');
      this.deps.onLog(`[telegram] bot.start failed: ${getErrorMessage(err)}`);
    });

    this.updateStatus('running');
    this.deps.onLog(`[telegram] bot running as @${this.botUsername || 'unknown'}`);
    void this.backfillDirectory(candidate, me.id);
  }

  /**
   * Fire-and-forget: my_chat_member only fires when the bot's own status changes, so a chat it was
   * already sitting in can never re-announce itself. Asking Telegram about the ids we still hold is
   * the only way back from a cleared config.
   */
  private async backfillDirectory(bot: Bot<TelegramContext>, botId: number): Promise<void> {
    try {
      const extra = await this.deps.getDirectorySources();
      if (this.bot !== bot) return;
      const candidates = collectDirectoryCandidates({
        ...extra,
        channels: this.deps.getChannels(),
        pairedUserIds: this.deps.getPairing().pairedUsers.map((user) => user.userId),
      });
      if (candidates.chatIds.length === 0 && candidates.userIds.length === 0) return;
      await runDirectoryBackfill(
        {
          getChat: (chatId) => bot.api.getChat(chatId),
          getChatMember: (chatId, userId) => bot.api.getChatMember(chatId, userId),
        },
        botId,
        candidates,
        {
          getChannels: () => this.deps.getChannels(),
          saveChannels: (next) => this.deps.saveChannels(next),
          getPairing: () => this.deps.getPairing(),
          savePairing: (next) => this.deps.savePairing(next),
          recordContact: (input) => { void recordBotContact(input).catch(() => undefined); },
          forgetChat: (chatId) => this.forgetChannelDirectMessages(chatId),
          onLog: (message) => this.deps.onLog(message),
        },
      );
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] directory backfill failed: ${getErrorMessage(err)}`);
    }
  }

  /**
   * A channel's direct-messages chat recorded before it could be told from a group leaves the
   * group list and the recipients: nobody can approve it, and a plain send to it fails.
   */
  private forgetChannelDirectMessages(chatId: number): void {
    const channels = this.deps.getChannels();
    if (channels.some((item) => item.chatId === chatId)) this.deps.saveChannels(forgetChannel(channels, chatId));
    void forgetBotChat('telegram', String(chatId)).catch(() => undefined);
  }

  private groupAdminDeps(source: GroupAdminSource): GroupAdminDeps {
    return {
      listGroups: source.listGroups,
      setGrants: source.setGrants,
      isConnectorOn: source.isConnectorOn,
      readsAllGroupMessages: () => this.readsAllGroupMessages,
    };
  }

  /**
   * The bot was just added to a group still waiting for approval: each admin gets its card in
   * their private chat, once per group per run (a re-sent join does not send it again).
   */
  private async offerGroupCard(bot: Bot<TelegramContext>, group: { id: string; title?: string }): Promise<void> {
    const source = this.deps.groupAdmin;
    if (!source || this.offeredGroups.has(group.id) || !this.deps.isGroupPending?.(Number(group.id))) return;
    this.offeredGroups.add(group.id);
    try {
      const sent = await offerGroupApproval(
        (chatId, view) => bot.api.sendMessage(chatId, view.text, { reply_markup: view.keyboard }),
        group,
        await source.getManagerIds(),
        {
          strings: this.deps.getStrings(),
          isConnectorOn: source.isConnectorOn,
          readsAllGroupMessages: this.readsAllGroupMessages,
          allowGroupCommands: this.deps.getAllowGroupCommands(),
        },
        this.deps.onLog,
      );
      if (sent > 0) this.deps.onLog(`[telegram] group ${group.id}'s approval card sent to ${sent} admin(s)`);
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] could not send group ${group.id}'s approval card: ${getErrorMessage(err)}`);
    }
  }

  private createBot(token: string): { bot: Bot<TelegramContext>; intake: MediaIntake } {
    const bot = new Bot<TelegramContext>(token, {
      client: {
        fetch: telegramFetchCompat,
        baseFetchConfig: {},
      },
    });
    const pairingBridge = this.pairingBridge;
    attachChannelDirectMessagesFilter(bot, {
      onFirstSeen: (chatId) => this.forgetChannelDirectMessages(chatId),
      onLog: this.deps.onLog,
    });
    attachPresenceTracking(bot, {
      onPresence: ({ contact, reachability, joinedGroup }) => {
        const group = { id: contact.id, ...(contact.title ? { title: contact.title } : {}) };
        if (joinedGroup) this.deps.onGroupJoined?.(group);
        void recordBotContact(contact)
          .then(() => (
            reachability === 'ok'
              ? markBotReachable('telegram', contact.kind, contact.id)
              : markBotUnreachable('telegram', contact.kind, contact.id, reachability)
          ))
          .catch((err: unknown) => {
            this.deps.onLog(`[telegram] could not record presence: ${getErrorMessage(err)}`);
          })
          // After the group is on the list, so "Allow" on the card finds it.
          .then(() => (joinedGroup ? this.offerGroupCard(bot, group) : undefined));
      },
      onLog: this.deps.onLog,
    });
    attachChannelDiscovery(bot, {
      isPairedUser: pairingBridge.isPairedUser,
      getChannels: () => this.deps.getChannels(),
      saveChannels: (next) => this.deps.saveChannels(next),
      onLog: this.deps.onLog,
    });
    // One router per bot; the handlers register their own kinds of button on it.
    const callbacks = new TelegramCallbackRouter(this.deps.onLog);
    callbacks.register(TELEGRAM_EXPORT_CB_PREFIX, (ctx) => handleExportCallback(ctx, this.registry, this.msgCtx));
    const intake = attachTelegramHandlers(bot, {
      groupChat: this.groupChat,
      pace: this.pace,
      isPairedUser: pairingBridge.isPairedUser,
      consumePairingCode: (code, user) => {
        const result = pairingBridge.consumePairingCode(code, user);
        if (result.ok) this.afterCodePairing(bot, code, user.userId);
        return result;
      },
      ...(this.deps.accountAdmin ? { accountAdmin: this.deps.accountAdmin } : {}),
      ...(this.deps.invites
        ? { invites: { ...this.deps.invites, rememberIssuer: (code: string, managerId: number) => this.inviteIssuers.remember(code, managerId) } }
        : {}),
      allowGroupCommands: () => this.deps.getAllowGroupCommands(),
      getBotToken: () => this.deps.getToken().trim(),
      getEffectiveTargetUrl: () => this.deps.getEffectiveTargetUrl(),
      getUploadFallbackUrl: () => this.deps.getUploadFallbackUrl?.() ?? '',
      getByokContextBudgetChars: () => this.deps.getByokContextBudgetChars(),
      isAdminUser: (userId) => this.deps.isAdminUser(userId),
      ...(this.deps.canUseBuiltin ? { canUseBuiltin: this.deps.canUseBuiltin } : {}),
      ...(this.deps.canUseDownloader ? { canUseDownloader: this.deps.canUseDownloader } : {}),
      ...(this.deps.linkSites ? { linkSites: this.deps.linkSites } : {}),
      ...(this.deps.canChat ? { canChat: this.deps.canChat } : {}),
      ...(this.deps.isFlowAdmin ? { isFlowAdmin: this.deps.isFlowAdmin } : {}),
      ...(this.deps.isBlocked ? { isBlocked: this.deps.isBlocked } : {}),
      ...(this.deps.isGroupPending ? { isGroupPending: this.deps.isGroupPending } : {}),
      ...(this.deps.groupAdmin ? { groupAdmin: this.groupAdminDeps(this.deps.groupAdmin) } : {}),
      onPendingGroupSeen: (group) => {
        const id = String(group.id);
        void recordBotContact({ platform: 'telegram', kind: 'chat', id, ...(group.title ? { title: group.title } : {}), chatType: group.type })
          .then(() => markBotReachable('telegram', 'chat', id))
          .catch(() => undefined);
      },
      ...(this.deps.onUse ? { onUse: this.deps.onUse } : {}),
      onTaskRequest: (request) => this.deps.onTaskRequest(request),
      onStatusRequest: () => this.deps.onStatusRequest(),
      onRestartApp: this.deps.onRestartApp,
      onUpdateOutputMode: (choice) => this.deps.onUpdateOutputChoice(choice),
      getLlmDirect: () => this.deps.getLlmDirect(),
      onLog: this.deps.onLog,
      getStrings: () => this.deps.getStrings(),
      getBotUsername: () => this.botUsername,
      getProviderCommands: this.deps.getProviderCommands,
      getBuiltinCommands: this.deps.getBuiltinCommands,
      onBuiltinCommand: async (request) => {
        const progress = queuedMessageProgress(this.msgCtx, request.replyTarget);
        let result: BotBuiltinRunResult;
        try {
          result = await this.deps.onBuiltinCommand(
            request.key,
            request.input,
            request.targetUrl,
            request.replyTarget.chatId,
            request.replyTarget.userId,
            progress.push,
            {
              ...(request.replyTo ? { replyTo: request.replyTo } : {}),
              ...(request.recentChat?.length ? { recentChat: request.recentChat } : {}),
              ...(request.chatRecap ? { chatRecap: request.chatRecap } : {}),
            },
          );
        } finally {
          // Not awaited: the answer deletes the acknowledgement, so an edit still in flight
          // can only fail quietly, and a hung edit must not hold the answer back.
          void progress.close();
        }
        await this.deliverBuiltinResult(request.replyTarget, request.input, result);
      },
      hasPendingAgentAsk: (chatId, userId, sent) => this.deps.hasPendingAgentAsk(chatId, userId, sent),
      pendingAgentAskRunId: (chatId, userId) => this.deps.pendingAgentAskRunId(chatId, userId),
      callbacks,
      onDropAgentAsk: (chatId, userId) => this.dropAgentAsk(chatId, userId),
      onNewConversation: (chatId, userId) => this.deps.onNewConversation(chatId, userId),
      onAgentAnswer: async (request) => {
        const progress = queuedMessageProgress(this.msgCtx, request.replyTarget);
        let result: BotBuiltinRunResult | null;
        try {
          result = await this.deps.onAgentAnswer(
            request.answer,
            request.replyTarget.chatId,
            request.replyTarget.userId,
            progress.push,
          );
        } finally {
          void progress.close();
        }
        if (!result) {
          await messaging.sendTaskError(this.msgCtx, request.replyTarget, {
            providerLabel: '',
            message: t(this.deps.getStrings(), 'bot.builtin.notResumable'),
          });
          return;
        }
        await this.deliverBuiltinResult(request.replyTarget, request.answer, result);
      },
      getFlowCommands: this.deps.getFlowCommands,
      onFlowCommand: this.deps.onFlowCommand,
    });

    // One update's handler failing leaves polling running (grammY moves on to the next update), so it
    // is logged, not reported as the bot being down.
    bot.catch((err) => {
      if (this.bot !== bot) return;
      this.deps.onLog(`[telegram] middleware error: ${getErrorMessage(err)}`);
    });
    return { bot, intake };
  }

  private async stopInternal(): Promise<void> {
    this.mediaIntake?.dispose();
    this.mediaIntake = null;
    void this.groupChat.flush();
    // A menu sent under the old token must not start a run on a bot that has been stopped or swapped.
    clearFlowButtons();
    clearAskButtons();
    if (!this.bot) {
      this.pollerActive = false;
      this.currentToken = '';
      this.currentAllowGroupCommands = false;
      this.registry.clear();
      return;
    }
    this.updateStatus('stopping');
    const current = this.bot;
    this.bot = null;
    this.pollerActive = false;
    this.currentToken = '';
    this.currentAllowGroupCommands = false;
    this.botUsername = '';
    this.readsAllGroupMessages = undefined;
    this.registry.clear();
    try {
      await Promise.race([
        Promise.resolve(current.stop()),
        delay(3_000),
      ]);
      this.deps.onLog('[telegram] bot stopped');
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] failed to stop bot: ${getErrorMessage(err)}`);
    }
  }

  private updateStatus(next: TelegramRuntimeStatus): void {
    this.status = next;
    this.emitRuntime();
  }

  private emitRuntime(): void {
    this.deps.onRuntime(this.getSnapshot());
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

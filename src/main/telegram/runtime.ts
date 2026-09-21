import { Bot } from 'grammy';
import type {
  BotLlmDirectConfig,
  FlowExecutionResult,
  TelegramChannel,
  TelegramKnownUser,
  TelegramOutputChoice,
  TelegramPairingState,
  TelegramReplyMode,
  TelegramReplyTarget,
  TelegramRuntimeSnapshot,
  TelegramRuntimeStatus,
} from '../../shared/types';
import { createPairingBridge } from './dmPolicy';
import { attachChannelDiscovery } from './channels';
import { collectDirectoryCandidates, runDirectoryBackfill } from './directory';
import type { DirectorySources } from './directory';
import { attachPresenceTracking } from './presence';
import {
  markBotReachable,
  markBotUnreachable,
  recordBotContact,
  trackBotSend,
  type BotContactKind,
} from '../botDirectory';
import {
  attachTelegramHandlers,
  syncPrivateCommands,
  type TelegramContext,
  type TelegramTaskRequest,
} from './commands';
import type { MediaIntake } from './mediaIntake';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';
import type { BotBuiltinCommandKey } from '../../shared/types';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { t } from '../i18n';
import { getErrorMessage } from './errors';
import { ExportTokenRegistry } from './exporter';
import type { TelegramExportContext, TelegramExportFormat } from './exporter';
import { handleExportCallback } from './exportHandlers';
import * as messaging from './messaging';
import type { TelegramMessagingContext, TelegramTaskSuccessPayload } from './messaging';
import { telegramFetchCompat } from './fetchCompat';

export interface TelegramRuntimeDeps {
  getEnabled: () => boolean;
  getToken: () => string;
  getAllowGroupCommands: () => boolean;
  getLlmDirect: () => BotLlmDirectConfig;
  getDefaultReplyMode: () => TelegramReplyMode;
  getCompactReply: () => boolean;
  getPairing: () => TelegramPairingState;
  savePairing: (next: TelegramPairingState) => void;
  getChannels: () => TelegramChannel[];
  saveChannels: (next: TelegramChannel[]) => void;
  getKnownUsers: () => TelegramKnownUser[];
  saveKnownUsers: (next: TelegramKnownUser[]) => void;
  getDirectorySources: () => Promise<Omit<DirectorySources, 'channels' | 'pairedUserIds'>>;
  isAdminUser: (userId: number) => boolean;
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
    key: BotBuiltinCommandKey,
    input: string,
    targetUrl: string,
    chatId: number,
    userId: number,
    onProgressText: (text: string) => void,
    plain?: boolean,
  ) => Promise<BotBuiltinRunResult>;
  onAgentAnswer: (
    answer: string,
    chatId: number,
    userId: number,
    onProgressText: (text: string) => void,
  ) => Promise<BotBuiltinRunResult | null>;
  hasPendingAgentAsk: (chatId: number, userId: number) => boolean;
  onDropAgentAsk: (chatId: number, userId: number) => void;
  onNewConversation: (chatId: number, userId: number) => Promise<boolean>;
  getFlowCommands?: () => Array<{
    flowId: string;
    command: string;
    description: string;
    inputVariable: string;
    allowedUserIds: string[];
  }>;
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: number,
    chatId: number,
  ) => Promise<{ taskId: string; result: Promise<FlowExecutionResult> }>;
  getEffectiveTargetUrl: () => string;
  getByokContextBudgetChars: () => number;
}

export class TelegramRuntime {
  private bot: Bot<TelegramContext> | null = null;
  private status: TelegramRuntimeStatus = 'idle';
  private botUsername = '';
  private errorMessage = '';
  private currentToken = '';
  private currentAllowGroupCommands = false;
  private pollerActive = false;
  private lock: Promise<void> = Promise.resolve();
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
    };
    this.emitRuntime();
  }

  getSnapshot(): TelegramRuntimeSnapshot {
    return {
      status: this.status,
      botUsername: this.botUsername || undefined,
      errorMessage: this.errorMessage || undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  async sendProactive(chatId: number, text: string): Promise<void> {
    await this.tracked(chatId, () => messaging.sendProactive(this.msgCtx, chatId, text));
  }

  async sendProactiveFile(
    chatId: number,
    filePath: string,
    sendAs: 'photo' | 'document' | 'auto',
    caption?: string,
    authorizedPaths?: string[],
  ): Promise<void> {
    await this.tracked(chatId, () => messaging.sendProactiveFile(
      this.msgCtx, chatId, filePath, sendAs, caption, authorizedPaths,
    ));
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
    await this.runLocked(async () => {
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
    await this.runLocked(async () => {
      await this.stopInternal();
      this.updateStatus('idle');
    });
  }

  async refreshBotCommands(): Promise<void> {
    await this.runLocked(async () => {
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
    if (!result.ok) {
      await messaging.sendTaskError(this.msgCtx, target, {
        providerLabel: result.providerLabel,
        message: result.text,
      });
      return;
    }
    await messaging.sendTaskSuccess(this.msgCtx, target, {
      providerLabel: result.providerLabel,
      savedFileName: result.savedFileName,
      response: result.text,
      prompt,
      title: result.title,
      elapsedSeconds: result.elapsedSeconds,
    });
  }

  private async startOrReplaceBot(token: string): Promise<void> {
    this.updateStatus('starting');
    this.errorMessage = '';

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
          getKnownUsers: () => this.deps.getKnownUsers(),
          saveKnownUsers: (next) => this.deps.saveKnownUsers(next),
          getPairing: () => this.deps.getPairing(),
          savePairing: (next) => this.deps.savePairing(next),
          recordContact: (input) => { void recordBotContact(input).catch(() => undefined); },
          onLog: (message) => this.deps.onLog(message),
        },
      );
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] directory backfill failed: ${getErrorMessage(err)}`);
    }
  }

  private createBot(token: string): { bot: Bot<TelegramContext>; intake: MediaIntake } {
    const bot = new Bot<TelegramContext>(token, {
      client: {
        fetch: telegramFetchCompat,
        baseFetchConfig: {},
      },
    });
    const pairingBridge = createPairingBridge(
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
      },
    );
    attachPresenceTracking(bot, {
      onPresence: ({ contact, reachability }) => {
        void recordBotContact(contact)
          .then(() => (
            reachability === 'ok'
              ? markBotReachable('telegram', contact.kind, contact.id)
              : markBotUnreachable('telegram', contact.kind, contact.id, reachability)
          ))
          .catch((err: unknown) => {
            this.deps.onLog(`[telegram] could not record presence: ${getErrorMessage(err)}`);
          });
      },
      onLog: this.deps.onLog,
    });
    attachChannelDiscovery(bot, {
      isPairedUser: pairingBridge.isPairedUser,
      getChannels: () => this.deps.getChannels(),
      saveChannels: (next) => this.deps.saveChannels(next),
      onLog: this.deps.onLog,
    });
    const intake = attachTelegramHandlers(bot, {
      isPairedUser: pairingBridge.isPairedUser,
      consumePairingCode: pairingBridge.consumePairingCode,
      allowGroupCommands: () => this.deps.getAllowGroupCommands(),
      getBotToken: () => this.deps.getToken().trim(),
      getEffectiveTargetUrl: () => this.deps.getEffectiveTargetUrl(),
      getByokContextBudgetChars: () => this.deps.getByokContextBudgetChars(),
      isAdminUser: (userId) => this.deps.isAdminUser(userId),
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
        const progress = messaging.createProgressEditor(this.msgCtx, request.replyTarget);
        let result: BotBuiltinRunResult;
        try {
          result = await this.deps.onBuiltinCommand(
            request.key,
            request.input,
            request.targetUrl,
            request.replyTarget.chatId,
            request.replyTarget.userId,
            progress.push,
            request.plain,
          );
        } finally {
          progress.stop();
        }
        await this.deliverBuiltinResult(request.replyTarget, request.input, result);
      },
      hasPendingAgentAsk: (chatId, userId) => this.deps.hasPendingAgentAsk(chatId, userId),
      onDropAgentAsk: (chatId, userId) => this.deps.onDropAgentAsk(chatId, userId),
      onNewConversation: (chatId, userId) => this.deps.onNewConversation(chatId, userId),
      onAgentAnswer: async (request) => {
        const progress = messaging.createProgressEditor(this.msgCtx, request.replyTarget);
        let result: BotBuiltinRunResult | null;
        try {
          result = await this.deps.onAgentAnswer(
            request.answer,
            request.replyTarget.chatId,
            request.replyTarget.userId,
            progress.push,
          );
        } finally {
          progress.stop();
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
    bot.on('callback_query:data', async (ctx) => {
      await handleExportCallback(ctx, this.registry, this.msgCtx);
    });

    bot.catch((err) => {
      if (this.bot !== bot) return;
      this.errorMessage = t(this.deps.getStrings(), 'telegram.runtime.handlerError', {
        error: getErrorMessage(err),
      });
      this.updateStatus('error');
      this.deps.onLog(`[telegram] middleware error: ${getErrorMessage(err)}`);
    });
    return { bot, intake };
  }

  private async stopInternal(): Promise<void> {
    this.mediaIntake?.dispose();
    this.mediaIntake = null;
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

  private async runLocked(work: () => Promise<void>): Promise<void> {
    this.lock = this.lock.then(work, work);
    await this.lock;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

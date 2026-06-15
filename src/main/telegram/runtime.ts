import { Bot } from 'grammy';
import type {
  FlowExecutionResult,
  TelegramPairingState,
  TelegramReplyMode,
  TelegramReplyTarget,
  TelegramRuntimeSnapshot,
  TelegramRuntimeStatus,
} from '../../shared/types';
import { createPairingBridge } from './dmPolicy';
import {
  attachTelegramHandlers,
  syncPrivateCommands,
  type TelegramContext,
  type TelegramTaskRequest,
} from './commands';
import type { ResolvedProviderCommand } from './providerCommands';
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
  getDefaultReplyMode: () => TelegramReplyMode;
  getPairing: () => TelegramPairingState;
  savePairing: (next: TelegramPairingState) => void;
  isAdminUser: (userId: number) => boolean;
  onTaskRequest: (request: TelegramTaskRequest) => Promise<{ taskId: string }>;
  onStatusRequest: () => string;
  onRestartApp?: () => void;
  onUpdateDefaultReplyMode: (mode: TelegramReplyMode) => boolean;
  onExportRequest: (
    request: TelegramExportContext & { format: TelegramExportFormat },
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  onLog: (message: string) => void;
  onRuntime: (snapshot: TelegramRuntimeSnapshot) => void;
  getStrings: () => Record<string, string>;
  getProviderCommands: () => ResolvedProviderCommand[];
  getFlowCommands?: () => Array<{ flowId: string; command: string; description: string; inputVariable: string }>;
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: number,
    chatId: number,
  ) => Promise<{ taskId: string; result: Promise<FlowExecutionResult> }>;
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
  private readonly registry = new ExportTokenRegistry();
  private readonly msgCtx: TelegramMessagingContext;

  constructor(private readonly deps: TelegramRuntimeDeps) {
    this.msgCtx = {
      getBot: () => this.bot,
      isPollerActive: () => this.pollerActive,
      getStrings: () => this.deps.getStrings(),
      getDefaultReplyMode: () => this.deps.getDefaultReplyMode(),
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
    await messaging.sendProactive(this.msgCtx, chatId, text);
  }

  async sendProactiveFile(
    chatId: number,
    filePath: string,
    sendAs: 'photo' | 'document' | 'auto',
    caption?: string,
    authorizedPaths?: string[],
  ): Promise<void> {
    await messaging.sendProactiveFile(this.msgCtx, chatId, filePath, sendAs, caption, authorizedPaths);
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
            await syncPrivateCommands(this.bot, allowGroupCommands, s, this.deps.getProviderCommands(), this.deps.getFlowCommands?.());
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
      if (!this.pollerActive || !this.currentToken) return;
      const token = this.currentToken;
      this.deps.onLog('[telegram] restarting bot to register updated flow commands...');
      await this.startOrReplaceBot(token);
    });
  }

  async sendTaskSuccess(
    target: TelegramReplyTarget,
    payload: TelegramTaskSuccessPayload,
  ): Promise<void> {
    await messaging.sendTaskSuccess(this.msgCtx, target, payload);
  }

  async sendTaskError(
    target: TelegramReplyTarget,
    payload: { providerLabel: string; message: string },
  ): Promise<void> {
    await messaging.sendTaskError(this.msgCtx, target, payload);
  }

  private async startOrReplaceBot(token: string): Promise<void> {
    this.updateStatus('starting');
    this.errorMessage = '';

    const candidate = this.createBot(token);
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
      await syncPrivateCommands(candidate, this.deps.getAllowGroupCommands(), s, this.deps.getProviderCommands(), this.deps.getFlowCommands?.());
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] failed to sync command scope: ${getErrorMessage(err)}`);
    }

    await this.stopInternal();
    this.bot = candidate;
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
  }

  private createBot(token: string): Bot<TelegramContext> {
    const bot = new Bot<TelegramContext>(token, {
      client: {
        fetch: telegramFetchCompat,
        baseFetchConfig: {},
      },
    });
    const pairingBridge = createPairingBridge(
      () => this.deps.getPairing(),
      (next) => this.deps.savePairing(next),
    );
    attachTelegramHandlers(bot, {
      isPairedUser: pairingBridge.isPairedUser,
      consumePairingCode: pairingBridge.consumePairingCode,
      allowGroupCommands: () => this.deps.getAllowGroupCommands(),
      isAdminUser: (userId) => this.deps.isAdminUser(userId),
      onTaskRequest: (request) => this.deps.onTaskRequest(request),
      onStatusRequest: () => this.deps.onStatusRequest(),
      onRestartApp: this.deps.onRestartApp,
      onUpdateOutputMode: (mode) => this.deps.onUpdateDefaultReplyMode(mode),
      onLog: this.deps.onLog,
      getStrings: () => this.deps.getStrings(),
      getProviderCommands: this.deps.getProviderCommands,
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
    return bot;
  }

  private async stopInternal(): Promise<void> {
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

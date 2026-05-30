import { Bot, InputFile } from 'grammy';
import { marked, Renderer } from 'marked';
import type {
  FlowExecutionResult,
  TelegramPairingState,
  TelegramReplyMode,
  TelegramReplyTarget,
  TelegramRuntimeSnapshot,
  TelegramRuntimeStatus,
} from '../../shared/types';
import {
  consumePairingCode,
  hasPairedUser,
  normalizePairingState,
  type PairingUserProfile,
} from './dmPolicy';
import {
  attachTelegramHandlers,
  syncPrivateCommands,
  type TelegramContext,
  type TelegramTaskRequest,
} from './commands';
import { getLangCache, t } from '../i18n';

const TELEGRAM_MSG_LIMIT = 4096;
const TELEGRAM_RESULT_MAX = 2600;
const TELEGRAM_EXPORT_TTL_MS = 30 * 60 * 1000;
const TELEGRAM_EXPORT_CB_PREFIX = 'expdl';

type TelegramExportFormat = 'png' | 'webp' | 'pdf';

type TelegramExportContext = {
  command: TelegramReplyTarget['command'];
  chatId: number;
  userId: number;
  providerLabel: string;
  savedFileName: string;
  prompt: string;
  response: string;
  title: string;
};

type TelegramExportRecord = TelegramExportContext & {
  token: string;
  createdAt: number;
};

// ── ExportTokenRegistry ──────────────────────────────────────────────────────
// Encapsulates export token lifecycle: generation, TTL-aware lookup, and cleanup.
class ExportTokenRegistry {
  private readonly records = new Map<string, TelegramExportRecord>();
  private readonly TTL_MS = TELEGRAM_EXPORT_TTL_MS;
  private readonly MAX_RECORDS = 200;
  private readonly ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly PRUNE_INTERVAL_MS = 10 * 60_000;

  /** Starts a background interval that periodically removes expired records. */
  startPeriodicPrune(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => this.prune(), ExportTokenRegistry.PRUNE_INTERVAL_MS);
  }

  /** Stops the periodic prune interval. */
  stopPeriodicPrune(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  issue(data: Omit<TelegramExportRecord, 'token' | 'createdAt'>): string {
    this.prune();
    // Hard cap: evict oldest entries if registry exceeds limit
    if (this.records.size >= this.MAX_RECORDS) {
      const entries = [...this.records.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = entries.slice(0, this.records.size - this.MAX_RECORDS + 1);
      for (const [key] of toRemove) this.records.delete(key);
    }
    for (let attempt = 0; attempt < 24; attempt += 1) {
      let token = '';
      for (let i = 0; i < 10; i += 1) {
        token += this.ALPHABET[Math.floor(Math.random() * this.ALPHABET.length)];
      }
      if (!this.records.has(token)) {
        this.records.set(token, { ...data, token, createdAt: Date.now() });
        return token;
      }
    }
    const token = `${Date.now().toString(36).toUpperCase()}`;
    this.records.set(token, { ...data, token, createdAt: Date.now() });
    return token;
  }

  /** Returns the record only if it exists and has not expired. */
  get(token: string): TelegramExportRecord | undefined {
    const record = this.records.get(token);
    if (!record) return undefined;
    if (Date.now() - record.createdAt > this.TTL_MS) {
      this.records.delete(token);
      return undefined;
    }
    return record;
  }

  prune(now: number = Date.now()): void {
    for (const [token, record] of this.records.entries()) {
      if (now - record.createdAt > this.TTL_MS) this.records.delete(token);
    }
  }

  clear(): void {
    this.stopPeriodicPrune();
    this.records.clear();
  }
}

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
  onUpdateDefaultReplyMode: (mode: TelegramReplyMode) => boolean;
  onExportRequest: (
    request: TelegramExportContext & { format: TelegramExportFormat },
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  onLog: (message: string) => void;
  onRuntime: (snapshot: TelegramRuntimeSnapshot) => void;
  getStrings: () => Record<string, string>;
  /** Returns current bot-triggered flow commands for dynamic routing. */
  getFlowCommands?: () => Array<{ flowId: string; command: string; description: string; inputVariable: string }>;
  /** Called when a matched flow command is received; resolves once queued. */
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

  constructor(private readonly deps: TelegramRuntimeDeps) {
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
    if (!this.bot || !this.pollerActive) {
      throw new Error('Telegram bot is not running');
    }
    try {
      const s = this.deps.getStrings();
      const responseSection = extractResponseSection(text, s);
      const responseText = truncateText(responseSection.trim(), TELEGRAM_RESULT_MAX);
      const body = formatResponseForTelegramHtml(responseText);
      const fallbackBody = `<i>${escapeTelegramHtml(t(s, 'telegram.msg.emptyResponse'))}</i>`;
      const message = body || fallbackBody;

      if (message.length > TELEGRAM_MSG_LIMIT) {
        const buffer = Buffer.from(responseSection || text, 'utf8');
        await this.bot.api.sendDocument(chatId, new InputFile(buffer, 'output.md'), {
          caption: t(getLangCache(), 'telegram.flowOutputTooLong', {}),
        });
      } else {
        await this.bot.api.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      }
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] sendProactive failed for chat ${chatId}: ${String(err)}`);
      throw err;
    }
  }

  async sendProactiveFile(
    chatId: number,
    filePath: string,
    sendAs: 'photo' | 'document',
    caption?: string,
  ): Promise<void> {
    if (!this.bot || !this.pollerActive) {
      throw new Error('Telegram bot is not running');
    }
    const captionOpts = caption ? { caption } : {};
    try {
      if (sendAs === 'photo') {
        await this.bot.api.sendPhoto(chatId, new InputFile(filePath), captionOpts);
      } else {
        await this.bot.api.sendDocument(chatId, new InputFile(filePath), captionOpts);
      }
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] sendProactiveFile failed for chat ${chatId}: ${String(err)}`);
      throw err;
    }
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
            await syncPrivateCommands(this.bot, allowGroupCommands, s, this.deps.getFlowCommands?.());
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
    payload: {
      providerLabel: string;
      savedFileName: string;
      response: string;
      prompt: string;
      title: string;
      elapsedSeconds: string;
    },
  ): Promise<void> {
    if (!this.bot || !this.pollerActive) return;
    const s = this.deps.getStrings();
    const responseSection = extractResponseSection(payload.response, s);
    const responseText = truncateText(responseSection.trim(), TELEGRAM_RESULT_MAX);
    const body = formatResponseForTelegramHtml(responseText);
    const defaultReplyMode = this.deps.getDefaultReplyMode();
    const titleLine = escapeTelegramHtml(
      t(s, 'telegram.msg.completed', {
        command: target.command,
        provider: payload.providerLabel,
        elapsed: payload.elapsedSeconds,
      }),
    );
    const savedLine = escapeTelegramHtml(
      t(s, 'telegram.msg.saved', { file: payload.savedFileName }),
    );
    if (defaultReplyMode === 'markdown') {
      const exportToken = this.registry.issue({
        command: target.command,
        chatId: target.chatId,
        userId: target.userId,
        providerLabel: payload.providerLabel,
        savedFileName: payload.savedFileName,
        prompt: payload.prompt,
        response: payload.response,
        title: payload.title,
      });
      const message = [
        titleLine,
        savedLine,
        '',
        body || `<i>${escapeTelegramHtml(t(s, 'telegram.msg.emptyResponse'))}</i>`,
      ].join('\n');
      const keyboard = {
        inline_keyboard: [
          [
            { text: t(s, 'telegram.msg.downloadPng'), callback_data: buildExportCallbackData(exportToken, 'png') },
            { text: t(s, 'telegram.msg.downloadWebp'), callback_data: buildExportCallbackData(exportToken, 'webp') },
          ],
          [
            { text: t(s, 'telegram.msg.downloadPdf'), callback_data: buildExportCallbackData(exportToken, 'pdf') },
          ],
        ],
      };
      await this.safeSendMessage(target.chatId, message, target.requestMessageId, keyboard);
      await this.deleteQueuedMessage(target);
      return;
    }

    await this.sendDirectExport({
      command: target.command,
      chatId: target.chatId,
      userId: target.userId,
      providerLabel: payload.providerLabel,
      savedFileName: payload.savedFileName,
      prompt: payload.prompt,
      response: payload.response,
      title: payload.title,
      format: defaultReplyMode,
      replyToMessageId: target.requestMessageId,
    });
    await this.deleteQueuedMessage(target);
  }

  async sendTaskError(
    target: TelegramReplyTarget,
    payload: { providerLabel: string; message: string },
  ): Promise<void> {
    if (!this.bot || !this.pollerActive) return;
    const s = this.deps.getStrings();
    const plainText = truncateText(
      t(s, 'telegram.msg.failed', {
        command: target.command,
        provider: payload.providerLabel,
      })+ '\n' + (payload.message || t(s, 'telegram.msg.unknownError')),
      TELEGRAM_MSG_LIMIT - 32,
    );
    const text = escapeTelegramHtml(plainText);
    await this.safeSendMessage(target.chatId, text, target.requestMessageId);
    await this.deleteQueuedMessage(target);
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
      await syncPrivateCommands(candidate, this.deps.getAllowGroupCommands(), s, this.deps.getFlowCommands?.());
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
    attachTelegramHandlers(bot, {
      isPairedUser: (userId) => {
        const pairing = normalizePairingState(this.deps.getPairing());
        if (pairing.pendingCodes.length !== this.deps.getPairing().pendingCodes.length) {
          this.deps.savePairing(pairing);
        }
        return hasPairedUser(pairing, userId);
      },
      consumePairingCode: (code, user) => this.consumePairing(code, user),
      allowGroupCommands: () => this.deps.getAllowGroupCommands(),
      isAdminUser: (userId) => this.deps.isAdminUser(userId),
      onTaskRequest: (request) => this.deps.onTaskRequest(request),
      onStatusRequest: () => this.deps.onStatusRequest(),
      onUpdateOutputMode: (mode) => this.deps.onUpdateDefaultReplyMode(mode),
      onLog: this.deps.onLog,
      getStrings: () => this.deps.getStrings(),
      getFlowCommands: this.deps.getFlowCommands,
      onFlowCommand: this.deps.onFlowCommand,
    });
    bot.on('callback_query:data', async (ctx) => {
      await this.handleExportCallback(ctx);
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

  private consumePairing(
    code: string,
    user: PairingUserProfile,
  ): { ok: boolean; reason?: string } {
    const pairing = normalizePairingState(this.deps.getPairing());
    const result = consumePairingCode(pairing, code, user);
    this.deps.savePairing(result.nextState);
    return { ok: result.ok, reason: result.reason };
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

  private async safeSendMessage(
    chatId: number,
    text: string,
    replyToMessageId?: number,
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
  ): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      });
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] failed to send message: ${getErrorMessage(err)}`);
    }
  }

  private async deleteQueuedMessage(target: TelegramReplyTarget): Promise<void> {
    if (!this.bot || !target.queuedMessageId) return;
    try {
      await this.bot.api.deleteMessage(target.chatId, target.queuedMessageId);
    } catch (err: unknown) {
      this.deps.onLog(`[telegram] failed to delete queued message: ${getErrorMessage(err)}`);
    }
  }

  private async handleExportCallback(ctx: TelegramContext): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith(`${TELEGRAM_EXPORT_CB_PREFIX}:`)) return;
    const parsed = parseExportCallbackData(data);
    const s = this.deps.getStrings();
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.invalidExport'), show_alert: true });
      return;
    }
    if (!ctx.from) {
      await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.unidentifiedAccount'), show_alert: true });
      return;
    }

    const record = this.registry.get(parsed.token);
    if (!record) {
      await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.exportExpired'), show_alert: true });
      return;
    }
    if (record.userId !== ctx.from.id) {
      await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.exportOtherUser'), show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.preparingFormat', { format: parsed.format.toUpperCase() }) });
    const exportResult = await this.deps.onExportRequest({
      ...record,
      format: parsed.format,
    });
    if (!exportResult.ok || !exportResult.filePath) {
      const message = escapeTelegramHtml(exportResult.error || t(s, 'telegram.msg.exportFailed', { format: parsed.format.toUpperCase() }));
      await this.safeSendMessage(record.chatId, `<i>${message}</i>`);
      return;
    }

    if (!this.bot) return;
    try {
      await this.bot.api.sendDocument(record.chatId, new InputFile(exportResult.filePath), {
        caption: t(s, 'telegram.msg.exportCaption', {
          provider: record.providerLabel,
          format: parsed.format.toUpperCase(),
        }),
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      this.deps.onLog(`[telegram] failed to upload ${parsed.format}: ${message}`);
      await this.safeSendMessage(
        record.chatId,
        `<i>${escapeTelegramHtml(t(s, 'telegram.msg.uploadFailed', { error: message }))}</i>`,
      );
    }
  }

  private async sendDirectExport(
    request: TelegramExportContext & { format: TelegramExportFormat; replyToMessageId?: number },
  ): Promise<void> {
    const s = this.deps.getStrings();
    const exportResult = await this.deps.onExportRequest(request);
    if (!exportResult.ok || !exportResult.filePath) {
      const message = escapeTelegramHtml(exportResult.error || t(s, 'telegram.msg.exportFailed', { format: request.format.toUpperCase() }));
      await this.safeSendMessage(request.chatId, `<i>${message}</i>`);
      return;
    }
    if (!this.bot) return;
    try {
      await this.bot.api.sendDocument(request.chatId, new InputFile(exportResult.filePath), {
        caption: t(s, 'telegram.msg.exportCaption', {
          provider: request.providerLabel,
          format: request.format.toUpperCase(),
        }),
        reply_parameters: request.replyToMessageId ? { message_id: request.replyToMessageId } : undefined,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      this.deps.onLog(`[telegram] failed to upload ${request.format}: ${message}`);
      await this.safeSendMessage(
        request.chatId,
        `<i>${escapeTelegramHtml(t(s, 'telegram.msg.uploadFailed', { error: message }))}</i>`,
      );
    }
  }

  private async runLocked(work: () => Promise<void>): Promise<void> {
    this.lock = this.lock.then(work, work);
    await this.lock;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramFetchCompat(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  // Node.js 18+ requires duplex: 'half' when sending a request body (e.g. multipart/form-data for sendDocument)
  const patchedInit = init?.body != null
    ? ({ ...init, duplex: 'half' } as Parameters<typeof fetch>[1])
    : init;

  const signal = patchedInit?.signal;
  if (!signal || isNativeAbortSignal(signal)) return fetch(input, patchedInit);

  const source = signal as {
    aborted?: boolean;
    addEventListener?: (type: 'abort', listener: () => void) => void;
    removeEventListener?: (type: 'abort', listener: () => void) => void;
  };
  const controller = new AbortController();

  const relayAbort = (): void => {
    controller.abort();
    source.removeEventListener?.('abort', relayAbort);
  };
  if (source.aborted) relayAbort();
  else source.addEventListener?.('abort', relayAbort);

  const result = fetch(input, { ...patchedInit, signal: controller.signal });
  result.finally(() => {
    source.removeEventListener?.('abort', relayAbort);
  });
  return result;
}

function isNativeAbortSignal(value: unknown): value is AbortSignal {
  if (typeof AbortSignal === 'undefined') return false;
  return value instanceof AbortSignal;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const base = err.message?.trim() || err.name || 'unknown error';
    const nested = extractNestedErrorDetail(err);
    if (!nested || nested === base) return base;
    return `${base} (${nested})`;
  }
  return formatErrorDetail(err) ?? 'unknown error';
}

function extractNestedErrorDetail(err: Error): string | null {
  const maybeNested = err as Error & { error?: unknown; cause?: unknown };
  return formatErrorDetail(maybeNested.error) ?? formatErrorDetail(maybeNested.cause);
}

function formatErrorDetail(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (value instanceof Error) {
    const text = value.message?.trim() || value.name;
    const code = readErrorCode(value);
    if (!text) return code ? `[${code}]` : null;
    if (!code || text.includes(code)) return text;
    return `${text} [${code}]`;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  const code = typeof record.code === 'string' || typeof record.code === 'number'
    ? String(record.code)
    : '';
  if (message && code && !message.includes(code)) return `${message} [${code}]`;
  if (message) return message;
  if (code) return `[${code}]`;
  return null;
}

function readErrorCode(error: Error): string | null {
  const maybeCode = (error as Error & { code?: unknown }).code;
  if (typeof maybeCode === 'string' || typeof maybeCode === 'number') return String(maybeCode);
  return null;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildExportCallbackData(token: string, format: TelegramExportFormat): string {
  return `${TELEGRAM_EXPORT_CB_PREFIX}:${token}:${format}`;
}

function parseExportCallbackData(data: string): { token: string; format: TelegramExportFormat } | null {
  const escapedPrefix = TELEGRAM_EXPORT_CB_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = data.match(new RegExp(`^${escapedPrefix}:([A-Z0-9]+):(png|webp|pdf)$`, 'i'));
  if (!match) return null;
  const token = match[1].toUpperCase();
  const format = match[2].toLowerCase() as TelegramExportFormat;
  return { token, format };
}

function extractResponseSection(raw: string, strings: Record<string, string>): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const responseAliases = new Set<string>();
  const localizedResponseHeading = t(strings, 'md.response').trim();
  if (localizedResponseHeading && localizedResponseHeading !== 'md.response') {
    responseAliases.add(localizedResponseHeading);
  }
  if (responseAliases.size === 0) return normalized;

  const lines = normalized.split('\n');
  const responseIdx = lines.findIndex((line) => {
    const match = line.trim().match(/^##\s+(.+)$/);
    if (!match) return false;
    return responseAliases.has(match[1].trim());
  });
  if (responseIdx < 0) return normalized;
  return lines.slice(responseIdx + 1).join('\n').trim();
}

function formatResponseForTelegramHtml(input: string): string {
  const normalized = input.trim().replace(/\r\n?/g, '\n');
  if (!normalized) return '';

  const renderer = new Renderer();
  const renderInline = (tokens: Parameters<typeof renderer.parser.parseInline>[0]): string =>
    renderer.parser.parseInline(tokens);
  const renderBlock = (tokens: Parameters<typeof renderer.parser.parse>[0]): string =>
    renderer.parser.parse(tokens);

  renderer.strong = ({ tokens }) => `<b>${renderInline(tokens)}</b>`;
  renderer.em = ({ tokens }) => `<i>${renderInline(tokens)}</i>`;
  renderer.codespan = ({ text }) => `<code>${escapeTelegramHtml(text)}</code>`;
  renderer.code = ({ text, lang }) => {
    const escapedCode = escapeTelegramHtml(text);
    if (lang?.trim()) {
      return `<pre><code class="language-${escapeTelegramAttribute(lang.trim())}">${escapedCode}</code></pre>\n`;
    }
    return `<pre><code>${escapedCode}</code></pre>\n`;
  };
  renderer.del = ({ tokens }) => `<s>${renderInline(tokens)}</s>`;
  renderer.link = ({ href, tokens }) => {
    const safeHref = normalizeSourceUrl(href);
    const text = renderInline(tokens).trim();
    if (!safeHref) return text;
    const plainText = text.replace(/<[^>]+>/g, '').trim();
    const anchorText = !plainText || /^https?:\/\//i.test(plainText)
      ? escapeTelegramHtml(getSourceLabel(safeHref))
      : text;
    return `<a href="${escapeTelegramAttribute(safeHref)}">${anchorText}</a>`;
  };
  renderer.blockquote = ({ tokens }) => `<blockquote>${renderBlock(tokens).trim()}</blockquote>\n`;
  renderer.paragraph = ({ tokens }) => `${renderInline(tokens)}\n\n`;
  renderer.list = ({ items }) => `${items.map((item) => renderer.listitem(item)).join('')}\n`;
  renderer.listitem = (item) => {
    const rendered = renderBlock(item.tokens).trim();
    const compact = rendered.replace(/\n{2,}/g, '\n').replace(/\n/g, ' ').trim();
    return `• ${compact}\n`;
  };
  renderer.heading = ({ tokens }) => `${renderInline(tokens)}\n`;
  renderer.hr = () => '\n';
  renderer.image = ({ text, href }) => {
    const altText = escapeTelegramHtml((text || '').trim());
    const safeHref = normalizeSourceUrl(href);
    if (safeHref && altText) return `${altText} (${escapeTelegramHtml(safeHref)})`;
    if (safeHref) return escapeTelegramHtml(safeHref);
    return altText;
  };
  renderer.br = () => '\n';
  renderer.html = ({ text }) => escapeTelegramHtml(text);
  renderer.text = (token) => {
    if (token.type === 'text' && token.tokens?.length) return renderInline(token.tokens);
    return escapeTelegramHtml(token.text);
  };
  renderer.table = ({ header, rows }) => {
    const lines = [header.map((cell) => renderInline(cell.tokens).trim()).join(' | ')];
    for (const row of rows) {
      lines.push(row.map((cell) => renderInline(cell.tokens).trim()).join(' | '));
    }
    return `${lines.join('\n')}\n`;
  };

  const parsed = marked.parse(normalized, {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  });
  if (typeof parsed !== 'string') return '';
  return linkifyRawUrlsInHtml(parsed).replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeSourceUrl(rawHref: string | null | undefined): string {
  const href = (rawHref || '').trim();
  if (!href) return '';
  try {
    const parsed = href.startsWith('//') ? new URL(`https:${href}`) : new URL(href);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeTelegramAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, '&quot;');
}

function getSourceLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return (url.hostname || 'source').replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function linkifyRawUrlsInHtml(html: string): string {
  return html.replace(/(^|[\s(>])(https?:\/\/[^\s<)]+[^\s<).,!?;:])/g, (match, prefix: string, rawUrl: string) => {
    const safeUrl = normalizeSourceUrl(rawUrl);
    if (!safeUrl) return match;
    const label = escapeTelegramHtml(getSourceLabel(safeUrl));
    return `${prefix}<a href="${escapeTelegramAttribute(safeUrl)}">${label}</a>`;
  });
}

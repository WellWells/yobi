import type { Context, SessionFlavor } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import type { PairingUserProfile } from './dmPolicy';
import type { FlowExecutionResult, TelegramReplyMode, TelegramReplyTarget } from '../../shared/types';
import type { ResolvedProviderCommand } from './providerCommands';
import { t } from '../i18n';

type TelegramSessionData = Record<string, never>;
export type TelegramContext = Context & SessionFlavor<TelegramSessionData> & ConversationFlavor<Context>;

export interface TelegramTaskRequest {
  command: string;
  prompt: string;
  targetUrl: string;
  replyTarget: TelegramReplyTarget;
}

export interface TelegramCommandOptions {
  consumePairingCode: (
    code: string,
    user: PairingUserProfile,
  ) => { ok: boolean; reason?: string };
  isPairedUser: (userId: number) => boolean;
  isAdminUser: (userId: number) => boolean;
  allowGroupCommands: () => boolean;
  onTaskRequest: (request: TelegramTaskRequest) => Promise<{ taskId: string }>;
  onStatusRequest: () => string;
  onRestartApp?: () => void;
  onUpdateOutputMode: (mode: TelegramReplyMode) => boolean;
  onLog: (message: string) => void;
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

export async function handleProviderCommand(
  ctx: TelegramContext,
  spec: ResolvedProviderCommand,
  options: TelegramCommandOptions,
): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  if (!ctx.chat) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownChat'));
    return;
  }
  const prompt = extractCommandPrompt(ctx.message?.text || '');
  if (!prompt) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.usage', { command: spec.command }));
    return;
  }

  let queuedMessageId: number | undefined;
  try {
    const queuedMessage = await ctx.reply(t(options.getStrings(), 'telegram.cmd.queued'));
    queuedMessageId = queuedMessage.message_id;
    const request: TelegramTaskRequest = {
      command: spec.command,
      prompt,
      targetUrl: spec.targetUrl,
      replyTarget: {
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        requestMessageId: ctx.message?.message_id,
        queuedMessageId: queuedMessage.message_id,
        command: spec.command,
      },
    };
    const queued = await options.onTaskRequest(request);
    await ctx.api.editMessageText(ctx.chat.id, queuedMessage.message_id, t(options.getStrings(), 'telegram.cmd.queuedWithId', { taskId: queued.taskId }));
  } catch (err: unknown) {
    options.onLog(`[telegram] failed to queue /${spec.command}: ${(err as Error).message}`);
    if (queuedMessageId) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, queuedMessageId, t(options.getStrings(), 'telegram.cmd.queueFailed'));
        return;
      } catch {
      }
    }
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.queueFailed'));
  }
}

export async function handleStatusCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  if (!options.isAdminUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.adminOnly'));
    return;
  }
  await ctx.reply(options.onStatusRequest());
}

export async function handleRestartCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  if (!options.isAdminUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.adminOnly'));
    return;
  }
  await ctx.reply(t(options.getStrings(), 'telegram.cmd.restartAck'));
  options.onRestartApp?.();
}

export async function handleOutputCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  if (!options.isAdminUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.adminOnly'));
    return;
  }
  const raw = extractCommandPrompt(ctx.message?.text || '');
  const nextMode = parseOutputMode(raw);
  if (!nextMode) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.outputUsage'));
    return;
  }
  const ok = options.onUpdateOutputMode(nextMode);
  if (!ok) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.outputUpdateFailed'));
    return;
  }
  await ctx.reply(t(options.getStrings(), 'telegram.cmd.outputUpdated', {
    mode: nextMode.toUpperCase(),
  }));
}

export async function handleFlowCommand(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  commandName: string,
): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  if (!ctx.chat) return;
  const chatId = ctx.chat.id;

  const liveCmds = options.getFlowCommands?.() ?? [];
  const match = liveCmds.find((fc) => fc.command === commandName);
  if (!match) return;

  const input = extractCommandPrompt(ctx.message?.text ?? '');
  const s = options.getStrings();

  let queuedMsgId: number | undefined;
  try {
    const queuedMsg = await ctx.reply(t(s, 'telegram.cmd.queued'));
    queuedMsgId = queuedMsg.message_id;
    const { taskId, result } = await options.onFlowCommand!(
      match.flowId,
      match.inputVariable,
      input,
      ctx.from.id,
      chatId,
    );
    await ctx.api.editMessageText(chatId, queuedMsg.message_id, t(s, 'telegram.cmd.queuedWithId', { taskId }));

    void result.then(async (flowResult) => {
      if (!queuedMsgId) return;
      if (!flowResult.success) {
        try {
          await ctx.api.editMessageText(chatId, queuedMsgId, t(s, 'telegram.cmd.flowFailed'));
        } catch {
        }
        return;
      }
      try {
        await ctx.api.deleteMessage(chatId, queuedMsgId);
      } catch {
      }
    }).catch(async (err: unknown) => {
      options.onLog(`[telegram] flow result failed: ${String(err)}`);
      if (queuedMsgId) {
        try {
          await ctx.api.editMessageText(chatId, queuedMsgId, t(s, 'telegram.cmd.flowFailed'));
        } catch {
        }
      }
    });
  } catch (err: unknown) {
    options.onLog(`[telegram] flow command /${commandName} failed: ${(err as Error).message}`);
    if (queuedMsgId) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, queuedMsgId, t(s, 'telegram.cmd.flowFailed'));
        return;
      } catch {
      }
    }
    await ctx.reply(t(s, 'telegram.cmd.flowFailed'));
  }
}

export function extractCommandPrompt(text: string): string {
  return text.replace(/^\/\w+(@\w+)?\s*/i, '').trim();
}

export function ensurePrivateChat(ctx: Context): ctx is Context & { chat: NonNullable<Context['chat']> & { type: 'private' } } {
  return ctx.chat?.type === 'private';
}

function isProviderChatAllowed(ctx: Context, options: TelegramCommandOptions): boolean {
  return ensurePrivateChat(ctx) || options.allowGroupCommands();
}

function parseOutputMode(raw: string): TelegramReplyMode | null {
  const mode = raw.trim().toLowerCase();
  if (mode === 'md' || mode === 'markdown') return 'markdown';
  if (mode === 'png') return 'png';
  if (mode === 'webp') return 'webp';
  if (mode === 'pdf') return 'pdf';
  return null;
}

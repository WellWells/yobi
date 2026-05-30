import { Bot, Context, session, type SessionFlavor } from 'grammy';
import {
  conversations,
  createConversation,
  type Conversation,
  type ConversationFlavor,
} from '@grammyjs/conversations';
import type { PairingUserProfile } from './dmPolicy';
import type { FlowExecutionResult, TelegramReplyMode, TelegramReplyTarget } from '../../shared/types';
import { PROVIDER_URLS } from '../../shared/types';
import { t } from '../i18n';

type TelegramSessionData = Record<string, never>;
export type TelegramContext = Context & SessionFlavor<TelegramSessionData> & ConversationFlavor<Context>;
type TelegramConversation = Conversation;

export interface TelegramTaskRequest {
  command: 'gpt' | 'gemini' | 'pplx';
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
  onUpdateOutputMode: (mode: TelegramReplyMode) => boolean;
  onLog: (message: string) => void;
  getStrings: () => Record<string, string>;
  /** Returns current list of enabled bot-triggered flows (called on each message). */
  getFlowCommands?: () => Array<{ flowId: string; command: string; description: string; inputVariable: string }>;
  /** Executes a flow triggered by a bot command; returns task ID and result promise. */
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: number,
    chatId: number,
  ) => Promise<{ taskId: string; result: Promise<FlowExecutionResult> }>;
}

const PROVIDER_URL: Record<TelegramTaskRequest['command'], string> = {
  gpt: PROVIDER_URLS.chatgpt,
  gemini: PROVIDER_URLS.gemini,
  pplx: PROVIDER_URLS.perplexity,
};

export function attachTelegramHandlers(bot: Bot<TelegramContext>, options: TelegramCommandOptions): void {
  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation((conversation, ctx) => pairingConversation(conversation, ctx, options), 'pairing-init'));

  bot.command('start', async (ctx) => {
    await handleStartCommand(ctx, options);
  });

  bot.command('init', async (ctx) => {
    if (!ensurePrivateChat(ctx)) {
      await ctx.reply(t(options.getStrings(), 'telegram.cmd.privateOnly'));
      return;
    }
    if (!ctx.from) {
      await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownAccount'));
      return;
    }
    if (options.isPairedUser(ctx.from.id)) {
      await ctx.reply(t(options.getStrings(), 'telegram.cmd.alreadyPaired'));
      return;
    }

    const inlineCode = extractCommandPrompt(ctx.message?.text || '');
    if (inlineCode) {
      const ok = tryConsumePairingCode(ctx, inlineCode, options);
      if (ok) {
        await ctx.reply(t(options.getStrings(), 'telegram.cmd.pairingCompleted'));
      } else {
        await ctx.reply(t(options.getStrings(), 'telegram.cmd.initInlineInvalidCode'));
      }
      return;
    }
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.pairingTip'));
    await ctx.conversation.enter('pairing-init');
  });

  bot.command('gpt', async (ctx) => {
    await handleProviderCommand(ctx, 'gpt', options);
  });
  bot.command('gemini', async (ctx) => {
    await handleProviderCommand(ctx, 'gemini', options);
  });
  bot.command('pplx', async (ctx) => {
    await handleProviderCommand(ctx, 'pplx', options);
  });
  bot.command('status', async (ctx) => {
    await handleStatusCommand(ctx, options);
  });
  bot.command('output', async (ctx) => {
    await handleOutputCommand(ctx, options);
  });

  // Register bot.command() for each bot-trigger flow (snapshot taken at bot creation time)
  if (options.getFlowCommands && options.onFlowCommand) {
    for (const fc of options.getFlowCommands()) {
      if (!/^[a-z][a-z0-9_]*$/.test(fc.command)) continue;
      const cmd = fc.command;
      bot.command(cmd, async (ctx) => {
        await handleFlowCommand(ctx, options, cmd);
      });
    }
  }
}

export async function syncPrivateCommands(
  bot: Bot<TelegramContext>,
  allowGroupCommands: boolean,
  strings: Record<string, string> = {},
  flowCommands: Array<{ command: string; description: string }> = [],
): Promise<void> {
  const staticCommands = [
    { command: 'start', description: t(strings, 'telegram.commands.start') },
    { command: 'init', description: t(strings, 'telegram.commands.init') },
    { command: 'output', description: t(strings, 'telegram.commands.output') },
    { command: 'status', description: t(strings, 'telegram.commands.status') },
    { command: 'gpt', description: t(strings, 'telegram.commands.gpt') },
    { command: 'gemini', description: t(strings, 'telegram.commands.gemini') },
    { command: 'pplx', description: t(strings, 'telegram.commands.pplx') },
  ];
  const commands = [
    ...staticCommands,
    ...flowCommands
      .filter((fc) => /^[a-z0-9_]+$/.test(fc.command))
      .map((fc) => ({ command: fc.command, description: fc.description || fc.command })),
  ];
  await bot.api.setMyCommands(commands, { scope: { type: 'all_private_chats' } });
  if (allowGroupCommands) {
    await bot.api.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
    return;
  }
  await bot.api.setMyCommands([], { scope: { type: 'all_group_chats' } });
}

async function pairingConversation(
  conversation: TelegramConversation,
  ctx: Context,
  options: TelegramCommandOptions,
): Promise<void> {
  if (!ctx.from) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownAccount'));
    return;
  }
  await ctx.reply(t(options.getStrings(), 'telegram.cmd.pairingCodePrompt'));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await conversation.waitFor(':text', { maxMilliseconds: 120_000 });
    const text = next.message?.text?.trim() || '';
    if (/^\/cancel$/i.test(text)) {
      await next.reply(t(options.getStrings(), 'telegram.cmd.pairingCancelled'));
      return;
    }
    const code = /^\//.test(text) ? extractCommandPrompt(text) : text;
    const ok = tryConsumePairingCode(ctx, code, options);
    if (ok) {
      await next.reply(t(options.getStrings(), 'telegram.cmd.pairingCompleted'));
      return;
    }
    await next.reply(t(options.getStrings(), 'telegram.cmd.pairingInvalidCode'));
  }
  await ctx.reply(t(options.getStrings(), 'telegram.cmd.pairingTooManyAttempts'));
}

async function handleProviderCommand(
  ctx: TelegramContext,
  command: TelegramTaskRequest['command'],
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
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.usage', { command }));
    return;
  }

  let queuedMessageId: number | undefined;
  try {
    const queuedMessage = await ctx.reply(t(options.getStrings(), 'telegram.cmd.queued'));
    queuedMessageId = queuedMessage.message_id;
    const request: TelegramTaskRequest = {
      command,
      prompt,
      targetUrl: PROVIDER_URL[command],
      replyTarget: {
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        requestMessageId: ctx.message?.message_id,
        queuedMessageId: queuedMessage.message_id,
        command,
      },
    };
    const queued = await options.onTaskRequest(request);
    await ctx.api.editMessageText(ctx.chat.id, queuedMessage.message_id, t(options.getStrings(), 'telegram.cmd.queuedWithId', { taskId: queued.taskId }));
  } catch (err: unknown) {
    options.onLog(`[telegram] failed to queue /${command}: ${(err as Error).message}`);
    if (queuedMessageId) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, queuedMessageId, t(options.getStrings(), 'telegram.cmd.queueFailed'));
        return;
      } catch {
        // fallback to regular reply
      }
    }
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.queueFailed'));
  }
}

async function handleStatusCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
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

async function handleOutputCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
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

async function handleFlowCommand(
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

  // Re-validate against live command list — flow may have been disabled/deleted since bot last started
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
          // ignore update failures
        }
        return;
      }
      try {
        await ctx.api.deleteMessage(chatId, queuedMsgId);
      } catch {
        // ignore delete failures
      }
    }).catch(async (err: unknown) => {
      options.onLog(`[telegram] flow result failed: ${String(err)}`);
      if (queuedMsgId) {
        try {
          await ctx.api.editMessageText(chatId, queuedMsgId, t(s, 'telegram.cmd.flowFailed'));
        } catch {
          // ignore
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
        // fallback to new reply
      }
    }
    await ctx.reply(t(s, 'telegram.cmd.flowFailed'));
  }
}

function extractCommandPrompt(text: string): string {
  return text.replace(/^\/\w+(@\w+)?\s*/i, '').trim();
}

async function handleStartCommand(
  ctx: Context,
  options: TelegramCommandOptions,
): Promise<void> {
  if (!ensurePrivateChat(ctx)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.privateOnly'));
    return;
  }
  if (!ctx.from) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownAccount'));
    return;
  }
  if (options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.alreadyPaired'));
    return;
  }
  const inlineCode = extractCommandPrompt(ctx.message?.text || '');
  if (!inlineCode) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.pairingTip'));
    return;
  }
  const ok = tryConsumePairingCode(ctx, inlineCode, options);
  if (ok) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.pairingCompleted'));
    return;
  }
  await ctx.reply(t(options.getStrings(), 'telegram.cmd.startCodeInvalid'));
}

function tryConsumePairingCode(
  ctx: Context,
  code: string,
  options: TelegramCommandOptions,
): boolean {
  if (!ctx.from) return false;
  const result = options.consumePairingCode(code, {
    userId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
  });
  return result.ok;
}

function ensurePrivateChat(ctx: Context): ctx is Context & { chat: NonNullable<Context['chat']> & { type: 'private' } } {
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

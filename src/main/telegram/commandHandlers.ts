import type { Context, SessionFlavor } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import type { PairingUserProfile } from './dmPolicy';
import type { BotLlmDirectConfig, FlowExecutionResult, TelegramOutputChoice, TelegramReplyTarget } from '../../shared/types';
import type { ResolvedProviderCommand } from '../providerCommands';
import { t } from '../i18n';

type TelegramSessionData = Record<string, never>;
export type TelegramContext = Context & SessionFlavor<TelegramSessionData> & ConversationFlavor<Context>;

export interface TelegramTaskRequest {
  command: string;
  prompt: string;
  targetUrl: string;
  replyTarget: TelegramReplyTarget;
  requesterName?: string;
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
  onUpdateOutputMode: (choice: TelegramOutputChoice) => boolean;
  // Read on every message, never cached, so a settings change applies without
  // restarting the bot.
  getLlmDirect: () => BotLlmDirectConfig;
  onLog: (message: string) => void;
  getStrings: () => Record<string, string>;
  // Empty until getMe() resolves; only used to reject commands aimed at another
  // bot, so an empty value simply means "do not reject".
  getBotUsername?: () => string;
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
  await queueTaskWithAck(ctx, options, { command: spec.command, prompt, targetUrl: spec.targetUrl });
}

// The shared ack path for anything that becomes an AI task: reply "queued",
// submit, then edit the ack with the task id (or a failure notice).
async function queueTaskWithAck(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  params: { command: string; prompt: string; targetUrl: string },
): Promise<void> {
  if (!ctx.chat || !ctx.from) return;
  let queuedMessageId: number | undefined;
  try {
    const queuedMessage = await ctx.reply(t(options.getStrings(), 'telegram.cmd.queued'));
    queuedMessageId = queuedMessage.message_id;
    const request: TelegramTaskRequest = {
      command: params.command,
      prompt: params.prompt,
      targetUrl: params.targetUrl,
      replyTarget: {
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        requestMessageId: ctx.message?.message_id,
        queuedMessageId: queuedMessage.message_id,
        command: params.command,
      },
      // Read off the live update rather than the pairing snapshot: `first_name`
      // rides along on every message, so it can never go stale here.
      requesterName: ctx.from.first_name,
    };
    const queued = await options.onTaskRequest(request);
    await ctx.api.editMessageText(ctx.chat.id, queuedMessage.message_id, t(options.getStrings(), 'telegram.cmd.queuedWithId', { taskId: queued.taskId }));
  } catch (err: unknown) {
    options.onLog(`[telegram] failed to queue /${params.command}: ${(err as Error).message}`);
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

// Command-free chat: a plain (non-command) text message. Private chats forward
// it when the feature is on; groups additionally require the sender to have
// tagged the bot ('@botname …'), so the bot never butts into a conversation.
export async function handleDirectMessage(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  // Entity offsets index the raw text — mention extraction must see it untrimmed.
  const rawText = ctx.message?.text ?? '';
  const text = rawText.trim();
  if (!text || !ctx.from || !ctx.chat) return;
  const s = options.getStrings();
  const direct = options.getLlmDirect();

  if (ctx.chat.type === 'private') {
    // Unpaired users have the /start pairing path; plain text stays quiet.
    if (!options.isPairedUser(ctx.from.id)) return;
    if (!direct.enabled) {
      await ctx.reply(t(s, 'telegram.direct.disabledHint'));
      return;
    }
    await queueTaskWithAck(ctx, options, { command: 'direct', prompt: text, targetUrl: direct.targetUrl });
    return;
  }

  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
  // The group-commands switch stays the operator's master "may act in groups"
  // gate; command-free chat does not widen it.
  if (!options.allowGroupCommands()) return;
  const match = extractBotMention(rawText, ctx.message?.entities, options.getBotUsername?.() ?? '');
  if (!match.mentioned) return;
  // Silent drop: replying would let anyone unpaired make the bot spam the group.
  if (!options.isPairedUser(ctx.from.id)) {
    options.onLog(`[telegram] group mention from unpaired user ${ctx.from.id} — ignored`);
    return;
  }
  if (!direct.enabled) {
    await ctx.reply(t(s, 'telegram.direct.disabledHint'));
    return;
  }
  // Slash commands already have their own group form ('/gemini@botname …'); a
  // tagged command would otherwise reach the AI as a literal prompt.
  if (!match.prompt || match.prompt.startsWith('/')) {
    await ctx.reply(t(s, 'telegram.direct.mentionUsage'));
    return;
  }
  await queueTaskWithAck(ctx, options, { command: 'direct', prompt: match.prompt, targetUrl: direct.targetUrl });
}

// Finds '@botUsername' mention entities and strips them so the rest of the text
// can be used verbatim as a prompt. Entity offsets are UTF-16 code units,
// matching JS string slicing. Case-insensitive: Telegram usernames are.
//
// Exported for the test suite: pure, offline, deterministic.
export function extractBotMention(
  text: string,
  entities: Array<{ type: string; offset: number; length: number }> | undefined,
  botUsername: string,
): { mentioned: boolean; prompt: string } {
  if (!botUsername) return { mentioned: false, prompt: '' };
  const needle = `@${botUsername.toLowerCase()}`;
  const ranges = (entities ?? [])
    .filter((e) => e.type === 'mention')
    .filter((e) => text.slice(e.offset, e.offset + e.length).toLowerCase() === needle)
    .sort((a, b) => b.offset - a.offset);
  if (ranges.length === 0) return { mentioned: false, prompt: '' };
  let prompt = text;
  for (const range of ranges) {
    prompt = prompt.slice(0, range.offset) + prompt.slice(range.offset + range.length);
  }
  return { mentioned: true, prompt: prompt.trim() };
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

function parseOutputMode(raw: string): TelegramOutputChoice | null {
  const mode = raw.trim().toLowerCase();
  if (mode === 'md' || mode === 'markdown') return 'markdown';
  if (mode === 'compact') return 'compact';
  if (mode === 'png') return 'png';
  if (mode === 'webp') return 'webp';
  if (mode === 'pdf') return 'pdf';
  return null;
}

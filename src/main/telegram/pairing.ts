import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { t } from '../i18n';
import {
  ensurePrivateChat,
  extractCommandPrompt,
  type TelegramCommandOptions,
  type TelegramContext,
} from './commandHandlers';

type TelegramConversation = Conversation;

export async function pairingConversation(
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

export async function handleStartCommand(
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

export async function handleInitCommand(
  ctx: TelegramContext,
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

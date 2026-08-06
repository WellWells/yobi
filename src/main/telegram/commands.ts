import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { t } from '../i18n';
import { BUILTIN_NEW_COMMAND } from '../../shared/types';
import {
  handleBuiltinCommand,
  handleDirectMessage,
  handleNewCommand,
  handleFlowCommand,
  handleOutputCommand,
  handleProviderCommand,
  handleRestartCommand,
  handleStatusCommand,
  type TelegramCommandOptions,
  type TelegramContext,
} from './commandHandlers';
import { handleInitCommand, handleStartCommand, pairingConversation } from './pairing';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';

export type {
  TelegramAgentAnswerRequest,
  TelegramBuiltinRequest,
  TelegramCommandOptions,
  TelegramContext,
  TelegramTaskRequest,
} from './commandHandlers';

export function attachTelegramHandlers(bot: Bot<TelegramContext>, options: TelegramCommandOptions): void {
  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation((conversation, ctx) => pairingConversation(conversation, ctx, options), 'pairing-init'));

  bot.command('start', async (ctx) => {
    await handleStartCommand(ctx, options);
  });

  bot.command('init', async (ctx) => {
    await handleInitCommand(ctx, options);
  });

  bot.command('status', async (ctx) => {
    await handleStatusCommand(ctx, options);
  });
  bot.command('output', async (ctx) => {
    await handleOutputCommand(ctx, options);
  });
  bot.command('restart', async (ctx) => {
    await handleRestartCommand(ctx, options);
  });
  bot.command(BUILTIN_NEW_COMMAND, async (ctx) => {
    if (ctx.chat && ctx.from) options.onDropAgentAsk?.(ctx.chat.id, ctx.from.id);
    await handleNewCommand(ctx, options);
  });

  bot.on('message:entities:bot_command', async (ctx, next) => {
    const name = readLeadingCommand(ctx, options.getBotUsername?.() ?? '');
    if (!name) return next();

    // Any command means the user moved on from whatever the agent last asked them.
    if (ctx.chat && ctx.from) options.onDropAgentAsk?.(ctx.chat.id, ctx.from.id);

    const provider = options.getProviderCommands().find((spec) => spec.command === name);
    if (provider) {
      await handleProviderCommand(ctx, provider, options);
      return;
    }

    const builtin = options.getBuiltinCommands().find((spec) => spec.command === name);
    if (builtin) {
      await handleBuiltinCommand(ctx, builtin, options);
      return;
    }

    if (options.onFlowCommand) {
      const flow = options.getFlowCommands?.().find((fc) => fc.command === name);
      if (flow) {
        await handleFlowCommand(ctx, options, name);
        return;
      }
    }

    return next();
  });

  bot.on('message:text', async (ctx) => {
    const hasLeadingCommand = ctx.message?.entities?.some((e) => e.type === 'bot_command' && e.offset === 0);
    if (hasLeadingCommand) {
      if (ctx.chat?.type === 'private' && ctx.from && options.isPairedUser(ctx.from.id)) {
        await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownCommand'));
      }
      return;
    }
    await handleDirectMessage(ctx, options);
  });
}

function readLeadingCommand(ctx: TelegramContext, botUsername: string): string | null {
  const text = ctx.message?.text;
  const entity = ctx.message?.entities?.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (!text || !entity) return null;
  const [name, target] = text.slice(1, entity.length).split('@');
  if (target && botUsername && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  return name.toLowerCase();
}

export async function syncPrivateCommands(
  bot: Bot<TelegramContext>,
  allowGroupCommands: boolean,
  strings: Record<string, string> = {},
  providerCommands: ResolvedProviderCommand[] = [],
  flowCommands: Array<{ command: string; description: string }> = [],
  builtinCommands: ResolvedBuiltinCommand[] = [],
): Promise<void> {
  const staticCommands = [
    { command: 'start', description: t(strings, 'telegram.commands.start') },
    { command: 'init', description: t(strings, 'telegram.commands.init') },
    { command: 'output', description: t(strings, 'telegram.commands.output') },
    { command: 'status', description: t(strings, 'telegram.commands.status') },
    { command: 'restart', description: t(strings, 'telegram.commands.restart') },
    { command: BUILTIN_NEW_COMMAND, description: t(strings, 'telegram.commands.new') },
    ...providerCommands.map((pc) => ({
      command: pc.command,
      description: clampDescription(pc.descriptionKey ? t(strings, pc.descriptionKey) : (pc.description || pc.command)),
    })),
    ...builtinCommands.map((bc) => ({
      command: bc.command,
      description: clampDescription(t(strings, bc.descriptionKey)),
    })),
  ];
  const commands = [
    ...staticCommands,
    ...flowCommands
      .filter((fc) => /^[a-z0-9_]+$/.test(fc.command))
      .map((fc) => ({ command: fc.command, description: clampDescription(fc.description || fc.command) })),
  ];
  await bot.api.setMyCommands(commands, { scope: { type: 'all_private_chats' } });
  if (allowGroupCommands) {
    await bot.api.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
    return;
  }
  await bot.api.setMyCommands([], { scope: { type: 'all_group_chats' } });
}

function clampDescription(raw: string): string {
  const text = raw.trim();
  if (text.length < 3) return `AI: ${text}`;
  return text.slice(0, 256);
}

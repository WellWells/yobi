import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { t } from '../i18n';
import {
  handleDirectMessage,
  handleFlowCommand,
  handleOutputCommand,
  handleProviderCommand,
  handleRestartCommand,
  handleStatusCommand,
  type TelegramCommandOptions,
  type TelegramContext,
} from './commandHandlers';
import { handleInitCommand, handleStartCommand, pairingConversation } from './pairing';
import type { ResolvedProviderCommand } from '../providerCommands';

export type { TelegramCommandOptions, TelegramContext, TelegramTaskRequest } from './commandHandlers';

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

  // Provider and flow commands are resolved when the message arrives, never bound
  // at build time: the user renames a provider command or adds a flow command at
  // any moment, and grammy's bot.command() can only take names known up front.
  // Resolving late means a new command answers immediately, with no bot restart.
  bot.on('message:entities:bot_command', async (ctx, next) => {
    const name = readLeadingCommand(ctx, options.getBotUsername?.() ?? '');
    if (!name) return next();

    const provider = options.getProviderCommands().find((spec) => spec.command === name);
    if (provider) {
      await handleProviderCommand(ctx, provider, options);
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

  // Command-free chat. Registered last so command traffic is resolved first;
  // messages that lead with a bot_command entity are never answered as prompts.
  bot.on('message:text', async (ctx) => {
    const hasLeadingCommand = ctx.message?.entities?.some((e) => e.type === 'bot_command' && e.offset === 0);
    if (hasLeadingCommand) {
      // A paired user's unknown command in private gets a pointer instead of
      // silence (a typo'd '/gemni' otherwise looks like a dead bot). Groups
      // stay silent — the command may belong to another bot in the chat.
      if (ctx.chat?.type === 'private' && ctx.from && options.isPairedUser(ctx.from.id)) {
        await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownCommand'));
      }
      return;
    }
    await handleDirectMessage(ctx, options);
  });
}

// Reads the command Telegram itself tagged as a bot_command entity at offset 0,
// so '/llm x' and '/llm@yobi_bot x' both resolve while a '/llm' quoted mid
// sentence does not — the same rule grammy's bot.command() applies. It searches
// rather than taking entities[0]: a formatted command ('/llm' sent in bold)
// carries a second entity at offset 0 that may sort first.
function readLeadingCommand(ctx: TelegramContext, botUsername: string): string | null {
  const text = ctx.message?.text;
  const entity = ctx.message?.entities?.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (!text || !entity) return null;
  const [name, target] = text.slice(1, entity.length).split('@');
  // A command aimed at another bot in a group is not ours to answer.
  if (target && botUsername && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  return name.toLowerCase();
}

export async function syncPrivateCommands(
  bot: Bot<TelegramContext>,
  allowGroupCommands: boolean,
  strings: Record<string, string> = {},
  providerCommands: ResolvedProviderCommand[] = [],
  flowCommands: Array<{ command: string; description: string }> = [],
): Promise<void> {
  const staticCommands = [
    { command: 'start', description: t(strings, 'telegram.commands.start') },
    { command: 'init', description: t(strings, 'telegram.commands.init') },
    { command: 'output', description: t(strings, 'telegram.commands.output') },
    { command: 'status', description: t(strings, 'telegram.commands.status') },
    { command: 'restart', description: t(strings, 'telegram.commands.restart') },
    // BYOK entries have no i18n key — the configured key/group name is the label.
    ...providerCommands.map((pc) => ({
      command: pc.command,
      description: clampDescription(pc.descriptionKey ? t(strings, pc.descriptionKey) : (pc.description || pc.command)),
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

// Telegram rejects the whole setMyCommands payload when any description falls
// outside 3-256 characters, and BYOK key names / flow descriptions are
// user-typed — one bad label must not freeze the entire '/' menu.
function clampDescription(raw: string): string {
  const text = raw.trim();
  if (text.length < 3) return `AI: ${text}`;
  return text.slice(0, 256);
}

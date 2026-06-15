import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { t } from '../i18n';
import {
  handleFlowCommand,
  handleOutputCommand,
  handleProviderCommand,
  handleRestartCommand,
  handleStatusCommand,
  type TelegramCommandOptions,
  type TelegramContext,
} from './commandHandlers';
import { handleInitCommand, handleStartCommand, pairingConversation } from './pairing';
import type { ResolvedProviderCommand } from './providerCommands';

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

  for (const spec of options.getProviderCommands()) {
    bot.command(spec.command, async (ctx) => {
      await handleProviderCommand(ctx, spec, options);
    });
  }

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
  providerCommands: ResolvedProviderCommand[] = [],
  flowCommands: Array<{ command: string; description: string }> = [],
): Promise<void> {
  const staticCommands = [
    { command: 'start', description: t(strings, 'telegram.commands.start') },
    { command: 'init', description: t(strings, 'telegram.commands.init') },
    { command: 'output', description: t(strings, 'telegram.commands.output') },
    { command: 'status', description: t(strings, 'telegram.commands.status') },
    { command: 'restart', description: t(strings, 'telegram.commands.restart') },
    ...providerCommands.map((pc) => ({ command: pc.command, description: t(strings, pc.descriptionKey) })),
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

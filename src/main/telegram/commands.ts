import { Bot } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { t } from '../i18n';
import { wholeCharsWithin } from '../../shared/textBudget';
import { BUILTIN_NEW_COMMAND } from '../../shared/types';
import type { BotBuiltinCommandKey } from '../../shared/types';
import { isBotCommandAllowed, isBotCommandRestricted, normalizeAllowedUserIds } from '../../shared/botCommandAccess';
import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import {
  handleBuiltinCommand,
  handleDirectMessage,
  handleNewCommand,
  handleAgentAnswer,
  handleFlowButton,
  handleFlowCommand,
  handleOutputCommand,
  handleProviderCommand,
  handleRestartCommand,
  handleStatusCommand,
  type TelegramCommandOptions,
  type TelegramContext,
} from './commandHandlers';
import { handleInitCommand, handleStartCommand, pairingConversation } from './pairing';
import { createMediaIntake, type MediaIntake } from './mediaIntake';
import { FLOW_BUTTON_CB_PREFIX, parseFlowButtonCallback } from './flowButtons';
import { GROUP_ADMIN_CB_PREFIX, handleGroupAdminCallback, handleGroupsCommand } from './groupAdmin';
import { handleAccountAdminCallback, handleUsersCommand } from './accountAdmin';
import { ACCOUNT_ADMIN_CB_PREFIX } from './accountAdminViews';
import { INVITE_CB_PREFIX, handleInviteCallback, handleInviteCommand } from './inviteAdmin';
import { ASK_BUTTON_CB_PREFIX, handleAskButton } from './askButtons';
import { handlePairingRequest, isUnpairedPrivate } from './pairingRequest';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';

export type {
  TelegramCommandOptions,
  TelegramContext,
  TelegramTaskRequest,
} from './commandHandlers';

export function attachTelegramHandlers(
  bot: Bot<TelegramContext>,
  options: TelegramCommandOptions,
): MediaIntake {
  // Someone the owner blocked, and anyone in a group the owner has not allowed yet (paired
  // accounts and the owner too), gets nothing at all — no reply, no pairing, no button, no
  // download — before any handler sees the update. The group itself is registered earlier
  // (presence tracking, or `onPendingGroupSeen` here), so it still shows in settings.
  const pendingSeen = new Set<number>();
  bot.use(async (ctx, next) => {
    if (ctx.from && options.isBlocked?.(ctx.from.id)) {
      options.onLog(`[telegram] update from blocked user ${ctx.from.id} — ignored`);
      return;
    }
    const chat = ctx.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup') && options.isGroupPending?.(chat.id)) {
      if (!pendingSeen.has(chat.id)) {
        pendingSeen.add(chat.id);
        options.onLog(`[telegram] ${chat.type} ${chat.id} waits for the owner's approval in settings — its updates are ignored`);
        options.onPendingGroupSeen?.({ id: chat.id, type: chat.type, ...(chat.title ? { title: chat.title } : {}) });
      }
      return;
    }
    if (chat) pendingSeen.delete(chat.id);
    // After the two refusals above: a blocked person's words and a pending group's talk are never
    // kept, and nothing is while the bot does not answer in groups at all.
    const said = ctx.message ?? ctx.editedMessage;
    if (said && options.allowGroupCommands()) options.groupChat?.record(said);
    await next();
  });
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
  bot.command('groups', async (ctx) => {
    await handleGroupsCommand(ctx, options);
  });
  bot.command('users', async (ctx) => {
    await handleUsersCommand(ctx, options);
  });
  bot.command('invite', async (ctx) => {
    await handleInviteCommand(ctx, options);
  });
  bot.command(BUILTIN_NEW_COMMAND, async (ctx) => {
    if (ctx.chat && ctx.from) options.onDropAgentAsk?.(ctx.chat.id, ctx.from.id);
    await handleNewCommand(ctx, options);
  });

  bot.on('message:entities:bot_command', async (ctx, next) => {
    const name = readLeadingCommand(ctx, options.getBotUsername?.() ?? '');
    if (!name) return next();

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

  // Every inline button goes through one router: each kind registers its own prefix.
  const callbacks = options.callbacks;
  if (callbacks) {
    const answered = (handle: (ctx: TelegramContext, opts: TelegramCommandOptions) => Promise<boolean>) =>
      async (ctx: TelegramContext): Promise<void> => {
        if (!(await handle(ctx, options))) await ctx.answerCallbackQuery().catch(() => undefined);
      };
    callbacks.register(GROUP_ADMIN_CB_PREFIX, answered(handleGroupAdminCallback));
    callbacks.register(ACCOUNT_ADMIN_CB_PREFIX, answered(handleAccountAdminCallback));
    callbacks.register(INVITE_CB_PREFIX, answered(handleInviteCallback));
    callbacks.register(FLOW_BUTTON_CB_PREFIX, async (ctx) => {
      const token = parseFlowButtonCallback(ctx.callbackQuery?.data);
      if (token) await handleFlowButton(ctx, options, token);
      else await ctx.answerCallbackQuery().catch(() => undefined);
    });
    callbacks.register(ASK_BUTTON_CB_PREFIX, (ctx, payload) => handleAskButton(ctx, payload, {
      getStrings: options.getStrings,
      pendingRunId: (chatId, userId) => options.pendingAgentAskRunId?.(chatId, userId) ?? null,
      answer: (pressed, answer) => handleAgentAnswer(pressed, options, answer),
      onLog: options.onLog,
    }));
    bot.on('callback_query:data', (ctx) => callbacks.dispatch(ctx));
  }

  const media = createMediaIntake(options);

  bot.on('message:text', async (ctx) => {
    const hasLeadingCommand = ctx.message?.entities?.some((e) => e.type === 'bot_command' && e.offset === 0);
    // Anything an unpaired person writes in private asks the managers to let them in.
    if (isUnpairedPrivate(ctx, options)) {
      await handlePairingRequest(ctx, options);
      return;
    }
    if (hasLeadingCommand) {
      if (ctx.chat?.type === 'private' && ctx.from && options.isPairedUser(ctx.from.id)) {
        await ctx.reply(t(options.getStrings(), 'telegram.cmd.unknownCommand'));
      }
      return;
    }
    if (await media.handleReply(ctx)) return;
    await handleDirectMessage(ctx, options);
  });

  const orRequest = (handle: (ctx: TelegramContext) => Promise<void>) => async (ctx: TelegramContext): Promise<void> => {
    if (isUnpairedPrivate(ctx, options)) {
      await handlePairingRequest(ctx, options);
      return;
    }
    await handle(ctx);
  };
  bot.on(
    ['message:animation', 'message:video', 'message:video_note', 'message:sticker'],
    orRequest((ctx) => media.handleUnsupported(ctx)),
  );
  bot.on(
    ['message:photo', 'message:document', 'message:voice', 'message:audio'],
    orRequest((ctx) => media.handle(ctx)),
  );
  bot.on('message:file', orRequest((ctx) => media.handleUnsupported(ctx)));

  return media;
}

function readLeadingCommand(ctx: TelegramContext, botUsername: string): string | null {
  const text = ctx.message?.text;
  const entity = ctx.message?.entities?.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (!text || !entity) return null;
  const [name, target] = text.slice(1, entity.length).split('@');
  if (target && botUsername && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  return name.toLowerCase();
}

export interface MenuFlowCommand {
  command: string;
  description: string;
  /**
   * 'users': only allowedUserIds may run it (none when empty); 'admins': the accounts whose
   * `flowAdmin` is set. Either way only their own chats list it.
   */
  access?: BotCommandAccessMode;
  /** Without `access`, a non-empty list alone restricts the command (the legacy reading). */
  allowedUserIds?: readonly string[];
}

/** What one paired account may run beyond what every paired account can, in its private chat. */
export interface MenuAccountAccess {
  userId: number;
  /** Built-in commands its grants allow (`/search` needs the web grant). */
  builtins: readonly BotBuiltinCommandKey[];
  /** May run the Telegram admin commands. */
  admin: boolean;
  /** May run flow commands limited to admins (the owner, or the admin grant). Absent = no. */
  flowAdmin?: boolean;
}

export interface CommandMenuOptions {
  /** Paired accounts; a chat of theirs that no longer needs its own menu is reset to the shared one. */
  pairedUserIds?: readonly number[];
  /** Per-account grants; an account left out gets only the shared menu. */
  accounts?: readonly MenuAccountAccess[];
  onLog?: (message: string) => void;
}

type MenuEntry = { command: string; description: string };

/** The admin commands, in menu order; only an admin's own chat lists them. */
const ADMIN_MENU_COMMANDS = ['output', 'status', 'restart'] as const;

/** The managers' commands (the owner or an admin-grant holder), in menu order. */
const MANAGER_MENU_COMMANDS = ['groups', 'users', 'invite'] as const;

/** Private chats given their own menu by this process, so a later sync can take a stale one back. */
const chatScopedMenus = new Set<number>();

/**
 * Telegram's "/" menu is visible to every user of the bot, paired or not, so the shared menus list
 * only what every paired account can run. Commands that need a grant (`/search`, admin commands,
 * `/groups`, `/users`, `/invite`, restricted flow commands) appear only in the private chats of accounts allowed to run them.
 * Groups never get one: a group menu is shared by everyone in it.
 */
export async function syncPrivateCommands(
  bot: Bot<TelegramContext>,
  allowGroupCommands: boolean,
  strings: Record<string, string> = {},
  providerCommands: ResolvedProviderCommand[] = [],
  flowCommands: MenuFlowCommand[] = [],
  builtinCommands: ResolvedBuiltinCommand[] = [],
  menuOptions: CommandMenuOptions = {},
): Promise<void> {
  const head: MenuEntry[] = [
    { command: 'start', description: t(strings, 'telegram.commands.start') },
    { command: 'init', description: t(strings, 'telegram.commands.init') },
  ];
  const admin: MenuEntry[] = ADMIN_MENU_COMMANDS.map((command) => ({
    command,
    description: t(strings, `telegram.commands.${command}`),
  }));
  const manage: MenuEntry[] = MANAGER_MENU_COMMANDS.map((command) => ({
    command,
    description: t(strings, `telegram.commands.${command}`),
  }));
  const common: MenuEntry[] = [
    { command: BUILTIN_NEW_COMMAND, description: t(strings, 'telegram.commands.new') },
    ...providerCommands.map((pc) => ({
      command: pc.command,
      description: clampDescription(pc.descriptionKey ? t(strings, pc.descriptionKey) : (pc.description || pc.command)),
    })),
  ];
  const listed = flowCommands.filter((fc) => /^[a-z0-9_]+$/.test(fc.command));
  const restricted = listed.filter((fc) => isBotCommandRestricted(fc));
  const toMenu = (fc: MenuFlowCommand): MenuEntry => ({ command: fc.command, description: clampDescription(fc.description || fc.command) });
  const openFlows = listed.filter((fc) => !restricted.includes(fc)).map(toMenu);
  const commands = [...head, ...common, ...openFlows];
  await bot.api.setMyCommands(commands, { scope: { type: 'all_private_chats' } });
  if (allowGroupCommands) {
    await bot.api.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
  } else {
    await bot.api.setMyCommands([], { scope: { type: 'all_group_chats' } });
  }
  // A chat's own menu replaces the shared one there, so it carries the shared commands too.
  const ownMenu = (chatId: number): MenuEntry[] | null => {
    const access = menuOptions.accounts?.find((entry) => entry.userId === chatId);
    const builtins = builtinCommands
      .filter((bc) => access?.builtins.includes(bc.key))
      .map((bc) => ({ command: bc.command, description: clampDescription(t(strings, bc.descriptionKey)) }));
    const flows = restricted
      .filter((fc) => isBotCommandAllowed(fc, String(chatId), { admin: access?.flowAdmin === true }))
      .map(toMenu);
    const isAdmin = access?.admin === true;
    // Managing groups and accounts is for the owner too, who holds no admin grant (`flowAdmin` covers both).
    const manages = access?.flowAdmin === true;
    if (builtins.length === 0 && flows.length === 0 && !isAdmin && !manages) return null;
    return [...head, ...(isAdmin ? admin : []), ...(manages ? manage : []), ...common, ...builtins, ...openFlows, ...flows];
  };
  await syncChatMenus(bot, restricted, ownMenu, menuOptions);
}

/** Telegram ids are numeric; a LINE id in a shared allowlist names nobody here. */
function telegramChatId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const chatId = Number(id);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

async function syncChatMenus(
  bot: Bot<TelegramContext>,
  restricted: readonly MenuFlowCommand[],
  ownMenu: (chatId: number) => MenuEntry[] | null,
  options: CommandMenuOptions,
): Promise<void> {
  const candidates = new Set<number>((options.accounts ?? []).map((entry) => entry.userId));
  for (const fc of restricted) {
    for (const id of normalizeAllowedUserIds(fc.allowedUserIds)) {
      const chatId = telegramChatId(id);
      if (chatId !== null) candidates.add(chatId);
    }
  }
  const failed = (chatId: number, err: unknown): void => {
    options.onLog?.(`[telegram] could not update the command menu of chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
  };
  const scoped = new Set<number>();
  for (const chatId of candidates) {
    const menu = ownMenu(chatId);
    if (!menu) continue;
    scoped.add(chatId);
    try {
      await bot.api.setMyCommands(menu, { scope: { type: 'chat', chat_id: chatId } });
      chatScopedMenus.add(chatId);
    } catch (err: unknown) {
      failed(chatId, err);
    }
  }
  const stale = new Set<number>([...chatScopedMenus, ...(options.pairedUserIds ?? [])]);
  for (const chatId of stale) {
    if (scoped.has(chatId)) continue;
    try {
      await bot.api.deleteMyCommands({ scope: { type: 'chat', chat_id: chatId } });
      chatScopedMenus.delete(chatId);
    } catch (err: unknown) {
      failed(chatId, err);
    }
  }
}

/** Telegram takes 3 to 256 characters; a long one is cut between whole characters. */
export function clampDescription(raw: string): string {
  const text = raw.trim();
  if (text.length < 3) return `AI: ${text}`;
  return wholeCharsWithin(text, 256);
}

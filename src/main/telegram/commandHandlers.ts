import type { Context } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import type { PairingUserProfile } from './dmPolicy';
import type {
  AgentChatLine,
  AgentReplyContext,
  BotBuiltinCommandKey,
  BotRunKind,
  BotLlmDirectConfig,
  FlowExecutionResult,
  TelegramOutputChoice,
  TelegramReplyTarget,
} from '../../shared/types';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';
import { isBuiltinFlowId, linkCommandFor, overheardLinkCommands } from '../../shared/builtinFlows';
import type { LinkSiteFilter } from '../../shared/linkRecognition';
import type { BotCommandAccess, BotCommandAccessMode } from '../../shared/botCommandAccess';
import { builtinCommandGrant } from '../../shared/botPermissions';
import { botAccessDeniedText } from '../botPermissions/denial';
import { createBotChatAccess, type BotChatAccess } from '../botChat/access';
import { botFlowEndText } from '../botChat/texts';
import { t } from '../i18n';
import { claimFlowButton, releaseFlowButton } from './flowButtons';
import type { FlowButtonRecord } from './flowButtons';
import type { GroupAdminDeps } from './groupAdmin';
import type { AccountAdminDeps } from './accountAdmin';
import type { InviteDeps } from './inviteAdmin';
import { createProgressMessage } from './progressMessage';
import { readReplyContext } from './replyContext';
import { asksAboutTheChat, type GroupChatLog } from './groupChatLog';
import { stepProgressMessage } from '../../shared/stepProgress';
import type { StepProgress } from '../../shared/stepProgress';
import type { TelegramCallbackRouter } from './callbackRouter';
import { UNPACED, botPaceNotice, type BotPaceTicket, type BotRequestPace } from '../botRequestPace';
import type { BotMessageSent } from '../botBuiltinCommands';
import { clearRetiredButtons, retireAskButtons } from './askButtons';

export type TelegramContext = Context & ConversationFlavor<Context>;

export interface TelegramTaskRequest {
  command: string;
  prompt: string;
  targetUrl: string;
  replyTarget: TelegramReplyTarget;
  requesterName?: string;
  attachments?: string[];
  /** The bot's model takes no uploads, so `targetUrl` is the stand-in that reads the media. */
  uploadFallback?: true;
}

/**
 * `agent` answers a message or a model command (`/gemini …`, a BYOK key) and decides itself whether
 * to use tools; the account's agent grant, checked where the run starts, limits which tools.
 */
export interface TelegramBuiltinRequest {
  key: BotRunKind;
  input: string;
  targetUrl: string;
  replyTarget: TelegramReplyTarget;
  /** The chat message the request replies to (`readReplyContext`). */
  replyTo?: AgentReplyContext;
  /** The group talk around the request (`GroupChatLog.contextFor`). */
  recentChat?: AgentChatLine[];
  /** The request is about the group's talk itself (`asksAboutTheChat`, in a group). */
  chatRecap?: true;
}

export interface TelegramAgentAnswerRequest {
  answer: string;
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
  onUpdateOutputMode: (choice: TelegramOutputChoice) => boolean;
  getLlmDirect: () => BotLlmDirectConfig;
  onLog: (message: string) => void;
  getStrings: () => Record<string, string>;
  getBotUsername?: () => string;
  getProviderCommands: () => ResolvedProviderCommand[];
  getBuiltinCommands: () => ResolvedBuiltinCommand[];
  onBuiltinCommand?: (request: TelegramBuiltinRequest) => Promise<void>;
  /**
   * Whether this account may type this built-in command in this chat (`/search` needs the web
   * grant). Asked before anything is queued; the runner checks again.
   */
  canUseBuiltin?: (key: BotBuiltinCommandKey, userId: number, chatId: number) => Promise<boolean>;
  /**
   * Whether this account's pasted link (or a button under one) may run the downloader in this
   * chat. Without it the link is an ordinary message; the flow runner checks again.
   */
  canUseDownloader?: (userId: number, chatId: number) => Promise<boolean>;
  /**
   * Which sites' typed or overheard links run their built-in (Settings › Recognize links), read
   * per message. Absent = every site. A menu button already sent still works.
   */
  linkSites?: () => LinkSiteFilter;
  /**
   * Whether this person may talk to the bot in this chat: every paired account, an unpaired
   * person in a group that grants it. Absent = pairing alone decides.
   */
  canChat?: (userId: number, chatId: number) => Promise<boolean>;
  /**
   * Whether this account may run a flow command limited to admins in this chat: the owner or an
   * admin-grant holder in their own private chat. Absent = nobody may.
   */
  isFlowAdmin?: (userId: number, chatId: number) => Promise<boolean>;
  /** Blocked by the owner: nothing they send is answered. */
  isBlocked?: (userId: number) => boolean;
  /** A group the owner has not allowed yet: nothing anyone sends there is answered. */
  isGroupPending?: (chatId: number) => boolean;
  /**
   * An update came from a pending group (once per group per run): it is registered so settings
   * can list it for approval.
   */
  onPendingGroupSeen?: (group: { id: number; type: 'group' | 'supergroup'; title?: string }) => void;
  /** `/groups` and the group cards' buttons: admins allow groups and edit their grants from Telegram. */
  groupAdmin?: GroupAdminDeps;
  /** `/users`, pairing requests and the account cards' buttons. Absent = unpaired people get the pairing tip. */
  accountAdmin?: AccountAdminDeps;
  /** `/invite`: pairing codes issued from Telegram. */
  invites?: InviteDeps;
  /** An unpaired person addressed the bot here — the owner's "used the bot" list. */
  onUse?: (user: PairingUserProfile, chatId: number) => void;
  /** A question waits for this person here; given `sent`, whether that message answers it (sent after it). */
  hasPendingAgentAsk?: (chatId: number, userId: number, sent?: BotMessageSent) => boolean;
  /** The run whose question this person still has to answer here, without taking it (a question's buttons check it). */
  pendingAgentAskRunId?: (chatId: number, userId: number) => string | null;
  onAgentAnswer?: (request: TelegramAgentAnswerRequest) => Promise<void>;
  /** Every inline button's press goes through it; absent = buttons are not handled (tests). */
  callbacks?: TelegramCallbackRouter;
  onDropAgentAsk?: (chatId: number, userId: number) => void;
  onNewConversation?: (chatId: number, userId: number) => Promise<boolean>;
  getFlowCommands?: () => Array<{
    flowId: string;
    command: string;
    description: string;
    inputVariable: string;
    access?: BotCommandAccessMode;
    allowedUserIds: string[];
  }>;
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: number,
    chatId: number,
    /** Where a long step of this run is (a download's percentage). */
    onProgress?: (progress: StepProgress) => void,
    /** The message the run answers — the pasted link, the menu a button was pressed on: its replies in this chat quote it. */
    messageId?: number,
    /** That message says nothing but the input (a link pasted alone): an answer may take its place. */
    messageIsInput?: boolean,
  ) => Promise<{ taskId: string; result: Promise<FlowExecutionResult> }>;
  getBotToken?: () => string;
  getEffectiveTargetUrl?: () => string;
  /** The model that reads a picture or a file the bot's model cannot take; empty = refuse it. */
  getUploadFallbackUrl?: () => string;
  getByokContextBudgetChars?: () => number;
  /** What was said lately in each group: every message is recorded, a request is read against it. */
  groupChat?: GroupChatLog;
  /** How often one person may start work (`botRequestPace.ts`); absent = no limit (tests). */
  pace?: BotRequestPace;
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
  // A model command is a message with its model chosen: the same agent run, on that model.
  await dispatchBuiltin(ctx, options, { key: 'agent', input: prompt, targetUrl: spec.targetUrl, command: spec.command });
}

export async function handleNewCommand(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !ctx.chat) return;
  noteUse(options, ctx.from, ctx.chat.id);
  if (!(await mayChat(options, ctx.from.id, ctx.chat.id))) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  const had = (await options.onNewConversation?.(ctx.chat.id, ctx.from.id)) ?? false;
  await ctx.reply(t(options.getStrings(), had ? 'bot.session.cleared' : 'bot.session.alreadyNew'));
}

export async function handleBuiltinCommand(
  ctx: TelegramContext,
  spec: ResolvedBuiltinCommand,
  options: TelegramCommandOptions,
): Promise<void> {
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.providerPrivateOnly'));
    return;
  }
  if (!ctx.from || !ctx.chat) return;
  noteUse(options, ctx.from, ctx.chat.id);
  if (!(await mayChat(options, ctx.from.id, ctx.chat.id))) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.accessDenied'));
    return;
  }
  if (!options.onBuiltinCommand) return;
  if (!(await mayUseBuiltin(options, spec.key, ctx.from.id, ctx.chat.id))) {
    options.onLog(`[telegram] /${spec.command} refused for user ${ctx.from.id} — not granted`);
    await ctx.reply(botAccessDeniedText(options.getStrings(), builtinCommandGrant(spec.key)));
    return;
  }

  const input = extractCommandPrompt(ctx.message?.text || '');
  if (!input) {
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.usage', { command: spec.command }));
    return;
  }

  await dispatchBuiltin(ctx, options, { key: spec.key, input, targetUrl: spec.targetUrl, command: spec.command });
}

/**
 * The shared fail-closed checks (`botChat/access.ts`) over this bot's options, which take numeric
 * ids user first. Built per call: tests swap an option's function between calls.
 */
function accessOf(options: TelegramCommandOptions): BotChatAccess {
  const { canChat, canUseBuiltin, canUseDownloader, isFlowAdmin } = options;
  const paired = (userId: string): boolean => options.isPairedUser(Number(userId));
  return createBotChatAccess({
    logTag: '[telegram]',
    onLog: options.onLog,
    isPairedUser: paired,
    ...(canChat ? { canChat: (chatId: string, userId: string) => canChat(Number(userId), Number(chatId)) } : {}),
    ...(canUseBuiltin ? { canUseBuiltin: (key: BotBuiltinCommandKey, chatId: string, userId: string) => canUseBuiltin(key, Number(userId), Number(chatId)) } : {}),
    ...(canUseDownloader ? { canUseDownloader: (chatId: string, userId: string) => canUseDownloader(Number(userId), Number(chatId)) } : {}),
    ...(isFlowAdmin ? { isFlowAdmin: (chatId: string, userId: string) => isFlowAdmin(Number(userId), Number(chatId)) } : {}),
  }, paired);
}

function mayUseBuiltin(options: TelegramCommandOptions, key: BotBuiltinCommandKey, userId: number, chatId: number): Promise<boolean> {
  return accessOf(options).mayUseBuiltin(key, String(chatId), String(userId));
}

/** The download grant. Absent, pairing alone decides. */
function mayUseDownloader(options: TelegramCommandOptions, userId: number, chatId: number): Promise<boolean> {
  return accessOf(options).mayDownload(String(chatId), String(userId));
}

function mayRunFlowCommand(options: TelegramCommandOptions, command: BotCommandAccess, userId: number, chatId: number): Promise<boolean> {
  return accessOf(options).mayRunFlowCommand(command, String(chatId), String(userId));
}

function mayChat(options: TelegramCommandOptions, userId: number, chatId: number): Promise<boolean> {
  return accessOf(options).mayChat(String(chatId), String(userId));
}

/** Records an unpaired person addressing the bot, for the owner's "used the bot" list. */
function noteUse(options: TelegramCommandOptions, from: NonNullable<TelegramContext['from']>, chatId: number): void {
  if (options.isPairedUser(from.id)) return;
  options.onUse?.(
    { userId: from.id, ...(from.username ? { username: from.username } : {}), ...(from.first_name ? { firstName: from.first_name } : {}), ...(from.last_name ? { lastName: from.last_name } : {}) },
    chatId,
  );
}

/**
 * The pace check of a request that starts work — an agent run, a link's flow, a flow command, a
 * picture: null = not taken, the sender told once why (`botRequestPace.ts`). Timed by the message's
 * own `date`: updates are read one at a time, so a burst's tail is read long after it was sent.
 * Answers sent after the agent's question and menu buttons are never paced: they follow the bot's
 * own message, not a burst. A message sent before the question is not its answer (`telegramSent`).
 */
export async function admitPaced(ctx: TelegramContext, options: TelegramCommandOptions): Promise<BotPaceTicket | null> {
  if (!options.pace || !ctx.from) return UNPACED;
  const date = ctx.msg?.date;
  const sentAt = date ? date * 1_000 : Date.now();
  const verdict = options.pace.admit(String(ctx.from.id), { sentAt, paired: options.isPairedUser(ctx.from.id) });
  if (verdict.ok) return verdict;
  options.onLog(`[telegram] request from ${ctx.from.id} not taken — ${verdict.reason}${verdict.tell ? '' : ' (already told)'}`);
  if (verdict.tell) {
    const messageId = ctx.msg?.message_id;
    await ctx.reply(
      botPaceNotice(options.getStrings(), verdict),
      messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {},
    ).catch(() => {});
  }
  return null;
}

/** The ticket goes back when the flow it started has settled, or now when nothing was queued. */
function releaseAfter(ticket: BotPaceTicket, run: QueuedFlowRun | undefined): void {
  if (run) void run.settled.finally(ticket.done);
  else ticket.done();
}

/**
 * The queued-ack / run / report dance, shared by typed commands, plain messages and answers to an
 * agent's question: acknowledge, hand the run a reply target pointing at that ack, and when anything
 * throws (the ack itself included) turn the ack into queueFailed, or send it fresh if that fails.
 */
async function runQueued(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  command: string,
  logLabel: string,
  run: (replyTarget: TelegramReplyTarget) => Promise<void>,
): Promise<void> {
  if (!ctx.chat || !ctx.from) return;
  const s = options.getStrings();
  let queuedMessageId: number | undefined;
  try {
    const queuedMessage = await ctx.reply(t(s, 'telegram.cmd.queued'));
    queuedMessageId = queuedMessage.message_id;
    await run({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      // A button's press answers under the question it was pressed on.
      requestMessageId: ctx.message?.message_id ?? ctx.callbackQuery?.message?.message_id,
      queuedMessageId: queuedMessage.message_id,
      command,
    });
  } catch (err: unknown) {
    options.onLog(`[telegram] ${logLabel} failed: ${(err as Error).message}`);
    if (queuedMessageId) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, queuedMessageId, t(s, 'telegram.cmd.queueFailed'));
        return;
      } catch {
      }
    }
    await ctx.reply(t(s, 'telegram.cmd.queueFailed'));
  }
}

/** Paces the request, then runs it; the ticket goes back when the run is over. */
async function dispatchBuiltin(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  run: { key: BotRunKind; input: string; targetUrl: string; command: string },
  ticket?: BotPaceTicket,
): Promise<void> {
  if (!options.onBuiltinCommand) return;
  const taken = ticket ?? await admitPaced(ctx, options);
  if (!taken) return;
  try {
    await runBuiltin(ctx, options, run);
  } finally {
    taken.done();
  }
}

async function runBuiltin(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  run: { key: BotRunKind; input: string; targetUrl: string; command: string },
): Promise<void> {
  // "@bot analyse this" under someone's message: the agent is shown the message and what the group
  // was saying around it, or "this" is whatever the bot conversation was last about. A typed
  // `/search` searches its own words only.
  const message = run.key === 'agent' ? ctx.message : undefined;
  const replyTo = message ? readReplyContext(message, options.getBotUsername?.() ?? '') : null;
  const inGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  // Said even when nothing was kept: the model then says so instead of answering from its own answers.
  const chatRecap = Boolean(inGroup && options.groupChat && asksAboutTheChat(run.input));
  const recentChat = message
    ? options.groupChat?.contextFor(message, { recap: chatRecap }) ?? []
    : [];
  await runQueued(ctx, options, run.command, `built-in /${run.command}`, async (replyTarget) => {
    await options.onBuiltinCommand?.({
      key: run.key,
      input: run.input,
      targetUrl: run.targetUrl,
      replyTarget,
      ...(replyTo ? { replyTo } : {}),
      ...(recentChat.length > 0 ? { recentChat } : {}),
      ...(chatRecap ? { chatRecap: true as const } : {}),
    });
  });
}

/** An answer to the pending question — typed, or the text of the button pressed. */
export async function handleAgentAnswer(ctx: TelegramContext, options: TelegramCommandOptions, answer: string): Promise<void> {
  if (!options.onAgentAnswer) return;
  await runQueued(ctx, options, 'agent', 'agent answer', async (replyTarget) => {
    await options.onAgentAnswer?.({ answer, replyTarget });
  });
}

/**
 * When a message was sent, for "does it answer the question": its id (a later message in the chat
 * has a larger one) and the end of its `date` second — Telegram dates are whole seconds.
 */
export function telegramSent(message: { message_id?: number; date?: number } | undefined): BotMessageSent {
  return {
    ...(message?.message_id !== undefined ? { messageId: message.message_id } : {}),
    ...(message?.date ? { sentAt: (message.date + 1) * 1_000 } : {}),
  };
}

/** A typed answer: the question's buttons come off, showing the choice when the answer is one word for word. */
async function handleTypedAnswer(ctx: TelegramContext, options: TelegramCommandOptions, answer: string): Promise<void> {
  if (ctx.chat && ctx.from) {
    await clearRetiredButtons(ctx.api, retireAskButtons(ctx.chat.id, ctx.from.id), options.getStrings(), answer);
  }
  await handleAgentAnswer(ctx, options, answer);
}

export async function handleDirectMessage(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  const rawText = ctx.message?.text ?? '';
  const text = rawText.trim();
  if (!text || !ctx.from || !ctx.chat) return;
  const direct = options.getLlmDirect();

  // Only a message sent after the question answers it (2026-10-20: a second "1" sent while the run
  // was still working was read after it asked and answered for the user). An earlier one is a request.
  const answersAgent = options.hasPendingAgentAsk?.(ctx.chat.id, ctx.from.id, telegramSent(ctx.message)) ?? false;

  if (ctx.chat.type === 'private') {
    if (!options.isPairedUser(ctx.from.id)) {
      // A private chat stays paired accounts only; the attempt still shows in "used the bot".
      noteUse(options, ctx.from, ctx.chat.id);
      return;
    }
    if (answersAgent) {
      await handleTypedAnswer(ctx, options, text);
      return;
    }
    // "@bot <link>" in a private chat is the link alone too.
    const mention = extractBotMention(rawText, ctx.message?.entities, options.getBotUsername?.() ?? '');
    const ticket = await admitPaced(ctx, options);
    if (!ticket) return;
    if (await runLinkFlow(ctx, options, mention.mentioned ? mention.prompt : text, ticket)) return;
    await dispatchBuiltin(ctx, options, { key: 'agent', input: text, targetUrl: direct.targetUrl, command: 'direct' }, ticket);
    return;
  }

  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
  if (!options.allowGroupCommands()) return;
  const match = extractBotMention(rawText, ctx.message?.entities, options.getBotUsername?.() ?? '');
  if (!match.mentioned) {
    await runOverheardLinks(ctx, options, text);
    return;
  }
  noteUse(options, ctx.from, ctx.chat.id);
  if (!(await mayChat(options, ctx.from.id, ctx.chat.id))) {
    options.onLog(`[telegram] group mention from ${ctx.from.id} in ${ctx.chat.id} — not allowed to use the bot there, ignored`);
    return;
  }
  if (!match.prompt || match.prompt.startsWith('/')) {
    await ctx.reply(t(options.getStrings(), 'telegram.direct.mentionUsage'));
    return;
  }
  if (answersAgent) {
    await handleTypedAnswer(ctx, options, match.prompt);
    return;
  }
  const ticket = await admitPaced(ctx, options);
  if (!ticket) return;
  if (await runLinkFlow(ctx, options, match.prompt, ticket)) return;
  await dispatchBuiltin(ctx, options, { key: 'agent', input: match.prompt, targetUrl: direct.targetUrl, command: 'direct' }, ticket);
}

/**
 * A message that is only a post or a YouTube video link — in a group, what follows the bot's
 * mention — runs Yobi's own flow for it (`linkCommandFor`) in that chat, with the link as its
 * input; false leaves it to the agent — as for an account without the download grant, whose
 * link is an ordinary message. The request's pace ticket goes with the flow when it is one.
 */
async function runLinkFlow(ctx: TelegramContext, options: TelegramCommandOptions, text: string, ticket: BotPaceTicket): Promise<boolean> {
  if (!ctx.from || !ctx.chat || !options.onFlowCommand) return false;
  const match = linkCommandFor(text, options.linkSites?.());
  if (!match) return false;
  if (!(await mayUseDownloader(options, ctx.from.id, ctx.chat.id))) {
    options.onLog(`[telegram] link from ${ctx.from.id} left to the agent — no download grant`);
    return false;
  }
  options.onLog(`[telegram] link from ${ctx.from.id} → ${match.flowId}`);
  let run: QueuedFlowRun | undefined;
  try {
    run = await queueFlowCommand(ctx, options, { match, input: text, userId: ctx.from.id, chatId: ctx.chat.id, commandName: match.command });
  } finally {
    releaseAfter(ticket, run);
  }
  return true;
}

/**
 * A group message that does not mention the bot (heard only when its privacy mode is off or it is
 * an admin there) runs the built-in of each link in it, when whoever sent it may use the
 * downloader there — their account's grant, or the group's for everyone in it. Anything else said
 * in the group is not the bot's to answer: nothing is replied, nothing is logged.
 */
async function runOverheardLinks(ctx: TelegramContext, options: TelegramCommandOptions, text: string): Promise<void> {
  if (!ctx.from || !ctx.chat || !options.onFlowCommand || text.startsWith('/')) return;
  const runs = overheardLinkCommands(text, options.linkSites?.());
  if (runs.length === 0) return;
  if (!(await mayUseDownloader(options, ctx.from.id, ctx.chat.id))) return;
  noteUse(options, ctx.from, ctx.chat.id);
  // One message is one request, however many links it holds.
  const ticket = await admitPaced(ctx, options);
  if (!ticket) return;
  const queued: Promise<void>[] = [];
  try {
    for (const { command, input } of runs) {
      options.onLog(`[telegram] group link from ${ctx.from.id} → ${command.flowId}`);
      const run = await queueFlowCommand(ctx, options, { match: command, input, userId: ctx.from.id, chatId: ctx.chat.id, commandName: command.command });
      if (run) queued.push(run.settled);
    }
  } finally {
    void Promise.allSettled(queued).then(ticket.done);
  }
}

export function extractBotMention(
  text: string,
  entities: Array<{ type: string; offset: number; length: number }> | undefined,
  botUsername: string,
): { mentioned: boolean; prompt: string } {
  if (!botUsername) return { mentioned: false, prompt: '' };
  const needle = `@${botUsername.toLowerCase()}`;
  const tagged = (entities ?? [])
    .filter((e) => e.type === 'mention')
    .filter((e) => text.slice(e.offset, e.offset + e.length).toLowerCase() === needle);
  const ranges = (tagged.length > 0 ? tagged : untaggedMentions(text, botUsername))
    .sort((a, b) => b.offset - a.offset);
  if (ranges.length === 0) return { mentioned: false, prompt: '' };
  let prompt = text;
  for (const range of ranges) {
    prompt = prompt.slice(0, range.offset) + prompt.slice(range.offset + range.length);
  }
  return { mentioned: true, prompt: prompt.trim() };
}

/**
 * The bot's name in the text where Telegram sent no mention entity: it tags none when a letter
 * follows the name, and CJK counts as one ("@bot你好"). Not part of a longer username or an address.
 */
function untaggedMentions(text: string, botUsername: string): Array<{ offset: number; length: number }> {
  if (!/^\w+$/.test(botUsername)) return [];
  const pattern = new RegExp(`(?<!\\w)@${botUsername}(?!\\w)`, 'gi');
  return [...text.matchAll(pattern)].map((m) => ({ offset: m.index, length: m[0].length }));
}

/**
 * The admin commands' shared gate: a paired account with the admin grant, in its private chat.
 * Private only because what they show is the owner's (the queue, the output settings) and
 * /restart restarts this computer's app — none of it for a group (BOT_CAPABILITIES.admin).
 */
async function adminGate(ctx: TelegramContext, options: TelegramCommandOptions): Promise<boolean> {
  const s = options.getStrings();
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(s, 'telegram.cmd.providerPrivateOnly'));
    return false;
  }
  if (!ctx.from || !options.isPairedUser(ctx.from.id)) {
    await ctx.reply(t(s, 'telegram.cmd.accessDenied'));
    return false;
  }
  if (!options.isAdminUser(ctx.from.id)) {
    await ctx.reply(t(s, 'telegram.cmd.adminOnly'));
    return false;
  }
  if (ctx.chat?.type !== 'private') {
    await ctx.reply(t(s, 'telegram.cmd.adminPrivateOnly'));
    return false;
  }
  return true;
}

export async function handleStatusCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  if (!(await adminGate(ctx, options))) return;
  await ctx.reply(options.onStatusRequest());
}

export async function handleRestartCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  if (!(await adminGate(ctx, options))) return;
  await ctx.reply(t(options.getStrings(), 'telegram.cmd.restartAck'));
  options.onRestartApp?.();
}

export async function handleOutputCommand(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  if (!(await adminGate(ctx, options))) return;
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
  // Narrower than pairing: a command over a private data source stays registered on the bot but
  // only answers the ids its author listed, or the admins in their own private chat.
  if (!(await mayRunFlowCommand(options, match, ctx.from.id, chatId))) {
    options.onLog(`[telegram] /${commandName} refused for user ${ctx.from.id} — not on the command's allow list`);
    await ctx.reply(t(options.getStrings(), 'bot.chat.flowNotAllowed'));
    return;
  }

  const input = extractCommandPrompt(ctx.message?.text ?? '');
  const ticket = await admitPaced(ctx, options);
  if (!ticket) return;
  let run: QueuedFlowRun | undefined;
  try {
    run = await queueFlowCommand(ctx, options, { match, input, userId: ctx.from.id, chatId, commandName });
  } finally {
    releaseAfter(ticket, run);
  }
}

/**
 * A press on a flow button: the same as typing the flow's command with the button's input, so
 * it passes the same checks — the chat policy, pairing, the command's own allow list — at the
 * moment of the press, not when the menu was sent.
 */
export async function handleFlowButton(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  token: string,
): Promise<void> {
  const s = options.getStrings();
  if (!ctx.from || !ctx.chat) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.unidentifiedAccount'), show_alert: true });
    return;
  }
  const claim = claimFlowButton(token, { chatId: ctx.chat.id, userId: ctx.from.id });
  if (!claim.ok) {
    if (claim.reason === 'busy') {
      await ctx.answerCallbackQuery({ text: t(s, 'telegram.flowButton.busy') });
      return;
    }
    const key = claim.reason === 'otherUser' ? 'telegram.flowButton.otherUser' : 'telegram.flowButton.expired';
    await ctx.answerCallbackQuery({ text: t(s, key), show_alert: true });
    return;
  }
  let run: QueuedFlowRun | undefined;
  try {
    run = await pressFlowButton(ctx, options, claim.record, { userId: ctx.from.id, chatId: ctx.chat.id });
  } finally {
    if (run) void run.settled.finally(() => releaseFlowButton(token));
    else releaseFlowButton(token);
  }
}

/** Not a promise itself, so awaiting the queueing does not wait for the run. */
interface QueuedFlowRun {
  settled: Promise<void>;
}

/** The queued run, or undefined when nothing was queued. */
async function pressFlowButton(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  record: FlowButtonRecord,
  press: { userId: number; chatId: number },
): Promise<QueuedFlowRun | undefined> {
  const s = options.getStrings();
  await ctx.answerCallbackQuery();
  if (!isProviderChatAllowed(ctx, options)) {
    await ctx.reply(t(s, 'telegram.cmd.providerPrivateOnly'));
    return undefined;
  }
  // A built-in's button runs what its line runs when typed: the YouTube menu's choice reruns the
  // menu, "analyze" under a forwarded post the analysis. A line that is not a built-in's has
  // expired — it never becomes an agent run. Its buttons
  // follow the downloader right (a group's grant reaches unpaired members too); a flow command's
  // buttons stay with paired accounts, like the command itself.
  const builtin = isBuiltinFlowId(record.flowId);
  if (!builtin && !options.isPairedUser(press.userId)) {
    await ctx.reply(t(s, 'telegram.cmd.accessDenied'));
    return undefined;
  }
  // A downloader taken away after the menu went out holds for its buttons too.
  if (builtin && !(await mayUseDownloader(options, press.userId, press.chatId))) {
    options.onLog(`[telegram] downloader button refused for user ${press.userId} — no download grant`);
    await ctx.reply(botAccessDeniedText(s, 'download'));
    return undefined;
  }
  const match = builtin
    ? linkCommandFor(record.input)
    : (options.getFlowCommands?.() ?? []).find((fc) => fc.flowId === record.flowId);
  if (!match) {
    await ctx.reply(t(s, 'telegram.flowButton.expired'));
    return undefined;
  }
  if (!(await mayRunFlowCommand(options, match, press.userId, press.chatId))) {
    options.onLog(`[telegram] button of /${match.command} refused for user ${press.userId} — not on the command's allow list`);
    await ctx.reply(t(s, 'bot.chat.flowNotAllowed'));
    return undefined;
  }
  return queueFlowCommand(ctx, options, {
    match,
    input: record.input,
    userId: press.userId,
    chatId: press.chatId,
    commandName: match.command,
  });
}

/**
 * Runs a flow command. Nothing is posted while it waits or runs — the reply is the flow's own
 * messages — except a status line a long step reports (a download's percentage), posted on the
 * first report and rewritten after; it goes when the run succeeds and turns into the reason when
 * it fails.
 */
async function queueFlowCommand(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  run: {
    match: { flowId: string; inputVariable: string };
    input: string;
    userId: number;
    chatId: number;
    commandName: string;
  },
): Promise<QueuedFlowRun | undefined> {
  const { match, input, chatId, commandName } = run;
  const s = options.getStrings();
  // A button's press answers under the message it was pressed on.
  const messageId = ctx.message?.message_id ?? ctx.callbackQuery?.message?.message_id;
  const quote = messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {};
  // Typed, and nothing in it but the input: not a button's message, not a link among other words.
  const messageIsInput = !ctx.callbackQuery && (ctx.message?.text ?? '').trim() === input.trim();

  let statusMsgId: number | undefined;
  const status = createProgressMessage(async (text) => {
    if (statusMsgId === undefined) statusMsgId = (await ctx.api.sendMessage(chatId, text, quote)).message_id;
    else await ctx.api.editMessageText(chatId, statusMsgId, text);
  });
  const tell = async (text: string): Promise<void> => {
    await status.close();
    try {
      if (statusMsgId !== undefined) {
        await ctx.api.editMessageText(chatId, statusMsgId, text);
        return;
      }
    } catch {
    }
    await ctx.reply(text, quote);
  };

  void ctx.api.sendChatAction(chatId, 'typing').catch(() => {});
  try {
    const { result } = await options.onFlowCommand!(
      match.flowId,
      match.inputVariable,
      input,
      run.userId,
      chatId,
      (progress) => status.push(stepProgressMessage(progress, (key) => t(s, key))),
      messageId,
      messageIsInput,
    );
    const settled = result.then(async (flowResult) => {
      if (!flowResult.success) {
        await tell(botFlowEndText(s, flowResult));
        return;
      }
      await status.close();
      if (statusMsgId === undefined) return;
      try {
        await ctx.api.deleteMessage(chatId, statusMsgId);
      } catch {
      }
    }).catch(async (err: unknown) => {
      options.onLog(`[telegram] flow result failed: ${String(err)}`);
      await tell(t(s, 'bot.chat.flowFailed')).catch(() => {});
    });
    return { settled };
  } catch (err: unknown) {
    options.onLog(`[telegram] flow command /${commandName} failed: ${(err as Error).message}`);
    await tell(t(s, 'bot.chat.flowFailed'));
    return undefined;
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

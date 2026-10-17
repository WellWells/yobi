import type { Context } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import type { PairingUserProfile } from './dmPolicy';
import type {
  BotBuiltinCommandKey,
  BotRunKind,
  BotLlmDirectConfig,
  FlowExecutionResult,
  TelegramOutputChoice,
  TelegramReplyTarget,
} from '../../shared/types';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';
import { isBotCommandAdminOnly, isBotCommandAllowed } from '../../shared/botCommandAccess';
import { isBuiltinFlowId, linkCommandFor, overheardLinkCommands } from '../../shared/builtinFlows';
import type { BotCommandAccess, BotCommandAccessMode } from '../../shared/botCommandAccess';
import { builtinCommandGrant } from '../../shared/botPermissions';
import { botAccessDeniedText } from '../botPermissions/denial';
import { summarizeFlowError } from '../../shared/flowErrorReason';
import { localizeUserFacingError, t } from '../i18n';
import { claimFlowButton, releaseFlowButton } from './flowButtons';
import type { FlowButtonRecord } from './flowButtons';
import { createProgressMessage } from './progressMessage';
import { stepProgressMessage } from '../../shared/stepProgress';
import type { StepProgress } from '../../shared/stepProgress';

type FlowFailure = Pick<FlowExecutionResult, 'error' | 'displayError'>;
export type TelegramContext = Context & ConversationFlavor<Context>;

export interface TelegramTaskRequest {
  command: string;
  prompt: string;
  targetUrl: string;
  replyTarget: TelegramReplyTarget;
  requesterName?: string;
  attachments?: string[];
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
  /** An unpaired person addressed the bot here — the owner's "used the bot" list. */
  onUse?: (user: PairingUserProfile, chatId: number) => void;
  hasPendingAgentAsk?: (chatId: number, userId: number) => boolean;
  onAgentAnswer?: (request: TelegramAgentAnswerRequest) => Promise<void>;
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
  ) => Promise<{ taskId: string; result: Promise<FlowExecutionResult> }>;
  getBotToken?: () => string;
  getEffectiveTargetUrl?: () => string;
  getByokContextBudgetChars?: () => number;
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

/** A grant check that fails closed: an error reading the grants refuses the command. */
async function mayUseBuiltin(
  options: TelegramCommandOptions,
  key: BotBuiltinCommandKey,
  userId: number,
  chatId: number,
): Promise<boolean> {
  if (!options.canUseBuiltin) return true;
  try {
    return await options.canUseBuiltin(key, userId, chatId);
  } catch (err: unknown) {
    options.onLog(`[telegram] could not read the grants of ${userId}: ${(err as Error).message}`);
    return false;
  }
}

/** The download grant, failing closed the same way. Absent, pairing alone decides. */
async function mayUseDownloader(options: TelegramCommandOptions, userId: number, chatId: number): Promise<boolean> {
  if (!options.canUseDownloader) return options.isPairedUser(userId);
  try {
    return await options.canUseDownloader(userId, chatId);
  } catch (err: unknown) {
    options.onLog(`[telegram] could not read the grants of ${userId}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Whether this account may run this flow command here: its allow list, or for a command limited
 * to admins who is asking and where, failing closed like the grants above.
 */
async function mayRunFlowCommand(
  options: TelegramCommandOptions,
  command: BotCommandAccess,
  userId: number,
  chatId: number,
): Promise<boolean> {
  if (!isBotCommandAdminOnly(command)) return isBotCommandAllowed(command, String(userId));
  if (!options.isFlowAdmin) return false;
  try {
    return isBotCommandAllowed(command, String(userId), { admin: await options.isFlowAdmin(userId, chatId) });
  } catch (err: unknown) {
    options.onLog(`[telegram] could not read the grants of ${userId}: ${(err as Error).message}`);
    return false;
  }
}

/** Whether this person may talk to the bot in this chat, failing closed like the grants above. */
async function mayChat(options: TelegramCommandOptions, userId: number, chatId: number): Promise<boolean> {
  if (!options.canChat) return options.isPairedUser(userId);
  try {
    return await options.canChat(userId, chatId);
  } catch (err: unknown) {
    options.onLog(`[telegram] could not read the rights of ${userId}: ${(err as Error).message}`);
    return false;
  }
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
      requestMessageId: ctx.message?.message_id,
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

async function dispatchBuiltin(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  run: { key: BotRunKind; input: string; targetUrl: string; command: string },
): Promise<void> {
  if (!options.onBuiltinCommand) return;
  await runQueued(ctx, options, run.command, `built-in /${run.command}`, async (replyTarget) => {
    await options.onBuiltinCommand?.({ key: run.key, input: run.input, targetUrl: run.targetUrl, replyTarget });
  });
}

async function handleAgentAnswer(ctx: TelegramContext, options: TelegramCommandOptions, answer: string): Promise<void> {
  if (!options.onAgentAnswer) return;
  await runQueued(ctx, options, 'agent', 'agent answer', async (replyTarget) => {
    await options.onAgentAnswer?.({ answer, replyTarget });
  });
}

export async function handleDirectMessage(ctx: TelegramContext, options: TelegramCommandOptions): Promise<void> {
  const rawText = ctx.message?.text ?? '';
  const text = rawText.trim();
  if (!text || !ctx.from || !ctx.chat) return;
  const direct = options.getLlmDirect();

  const answersAgent = options.hasPendingAgentAsk?.(ctx.chat.id, ctx.from.id) ?? false;

  if (ctx.chat.type === 'private') {
    if (!options.isPairedUser(ctx.from.id)) {
      // A private chat stays paired accounts only; the attempt still shows in "used the bot".
      noteUse(options, ctx.from, ctx.chat.id);
      return;
    }
    if (answersAgent) {
      await handleAgentAnswer(ctx, options, text);
      return;
    }
    // "@bot <link>" in a private chat is the link alone too.
    const mention = extractBotMention(rawText, ctx.message?.entities, options.getBotUsername?.() ?? '');
    if (await runLinkFlow(ctx, options, mention.mentioned ? mention.prompt : text)) return;
    await dispatchBuiltin(ctx, options, { key: 'agent', input: text, targetUrl: direct.targetUrl, command: 'direct' });
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
    await handleAgentAnswer(ctx, options, match.prompt);
    return;
  }
  if (await runLinkFlow(ctx, options, match.prompt)) return;
  await dispatchBuiltin(ctx, options, { key: 'agent', input: match.prompt, targetUrl: direct.targetUrl, command: 'direct' });
}

/**
 * A message that is only a post or a YouTube video link — in a group, what follows the bot's
 * mention — runs Yobi's own flow for it (`linkCommandFor`) in that chat, with the link as its
 * input; false leaves it to the agent — as for an account without the download grant, whose
 * link is an ordinary message.
 */
async function runLinkFlow(ctx: TelegramContext, options: TelegramCommandOptions, text: string): Promise<boolean> {
  if (!ctx.from || !ctx.chat || !options.onFlowCommand) return false;
  const match = linkCommandFor(text);
  if (!match) return false;
  if (!(await mayUseDownloader(options, ctx.from.id, ctx.chat.id))) {
    options.onLog(`[telegram] link from ${ctx.from.id} left to the agent — no download grant`);
    return false;
  }
  options.onLog(`[telegram] link from ${ctx.from.id} → ${match.flowId}`);
  await queueFlowCommand(ctx, options, { match, input: text, userId: ctx.from.id, chatId: ctx.chat.id, commandName: match.command });
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
  const runs = overheardLinkCommands(text);
  if (runs.length === 0) return;
  if (!(await mayUseDownloader(options, ctx.from.id, ctx.chat.id))) return;
  noteUse(options, ctx.from, ctx.chat.id);
  for (const { command, input } of runs) {
    options.onLog(`[telegram] group link from ${ctx.from.id} → ${command.flowId}`);
    await queueFlowCommand(ctx, options, { match: command, input, userId: ctx.from.id, chatId: ctx.chat.id, commandName: command.command });
  }
}

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

/**
 * A bare "the flow failed" leaves the sender with nowhere to go — the run's real complaint lives
 * in the app's log, which is not where they are. The reason rides back with it when there is one,
 * in the sender's language when the run worded it.
 */
function flowFailedText(strings: Record<string, string>, result: FlowFailure): string {
  const reason = summarizeFlowError(result.displayError ?? localizeUserFacingError(result.error ?? '', strings));
  return reason
    ? t(strings, 'telegram.cmd.flowFailedReason', { reason })
    : t(strings, 'telegram.cmd.flowFailed');
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
    await ctx.reply(t(options.getStrings(), 'telegram.cmd.flowNotAllowed'));
    return;
  }

  const input = extractCommandPrompt(ctx.message?.text ?? '');
  await queueFlowCommand(ctx, options, { match, input, userId: ctx.from.id, chatId, commandName });
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
    await ctx.reply(t(s, 'telegram.cmd.flowNotAllowed'));
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

  let statusMsgId: number | undefined;
  const status = createProgressMessage(async (text) => {
    if (statusMsgId === undefined) statusMsgId = (await ctx.api.sendMessage(chatId, text)).message_id;
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
    await ctx.reply(text);
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
    );
    const settled = result.then(async (flowResult) => {
      if (!flowResult.success) {
        await tell(flowResult.aborted ? t(s, 'telegram.cmd.flowStopped') : flowFailedText(s, flowResult));
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
      await tell(t(s, 'telegram.cmd.flowFailed')).catch(() => {});
    });
    return { settled };
  } catch (err: unknown) {
    options.onLog(`[telegram] flow command /${commandName} failed: ${(err as Error).message}`);
    await tell(t(s, 'telegram.cmd.flowFailed'));
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

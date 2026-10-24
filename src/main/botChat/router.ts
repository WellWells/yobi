import { t } from '../i18n';
import { BOT_PLATFORM_NAMES, BUILTIN_NEW_COMMAND } from '../../shared/types';
import { linkCommandFor } from '../../shared/builtinFlows';
import { builtinCommandGrant } from '../../shared/botPermissions';
import { botAccessDeniedText } from '../botPermissions/denial';
import type { BotRunKind } from '../../shared/types';
import type { BotMessageSent } from '../botBuiltinCommands';
import type { ResolvedBuiltinCommand } from '../providerCommands';
import { UNPACED, botPaceNotice, type BotPaceTicket } from '../botRequestPace';
import { createAttemptLimiter } from './attemptLimiter';
import { createBotChatAccess, type BotChatAccess } from './access';
import { botFlowEndText } from './texts';
import {
  isHelpCommand,
  listProviderCommands,
  parseBotCommand,
  parsePairCommand,
  resolveProviderAlias,
  resolveProviderTarget,
  type BotCommand,
} from './commands';
import type { BotChatEvent, BotChatRouterDeps, BotFlowCommandDef } from './types';

/**
 * When a message was sent at the latest, to tell whether it can answer a question: the earlier of
 * its batch's arrival here (a later message of the same batch is never the answer) and the
 * platform's own timestamp (review 2026-10-20: a "1" delivered late — redelivered after the tunnel
 * was down — arrived after a shell approval was asked and approved it, though the user sent it
 * before the question existed). A redelivered message is old by definition: never an answer.
 */
function answerSent(event: BotChatEvent, received: BotMessageSent): BotMessageSent {
  if (event.redelivered) return { sentAt: 0 };
  const arrived = received.sentAt ?? Date.now();
  return { sentAt: Math.min(arrived, event.sentAt ?? arrived) };
}

/**
 * What every bot platform does with a typed line, decided once: blocked people and pending groups
 * first, then pairing, commands, an answer to the agent's question, a pasted link, and otherwise an
 * agent run — each start paced, each grant failing closed. A platform hands in its events and an
 * output (`BotChatOutput`) that writes the answers its own way; what differs between platforms
 * (buttons, quoting, formatting) lives there, not here.
 */
export class BotChatRouter<E extends BotChatEvent> {
  private readonly pairAttempts = createAttemptLimiter();
  /** Groups registered this run, so a busy group is looked up once, not on every mention. */
  private readonly seenGroups = new Set<string>();
  /** Pending groups already logged this run: some platforms deliver every group message, not just mentions. */
  private readonly pendingLogged = new Set<string>();
  /** Names looked up this run, by user id. */
  private readonly names = new Map<string, string>();
  protected readonly access: BotChatAccess;
  protected readonly tag: string;

  constructor(protected readonly deps: BotChatRouterDeps<E>) {
    this.tag = `[${deps.platform}]`;
    this.access = createBotChatAccess({
      logTag: this.tag,
      onLog: deps.onLog,
      isPairedUser: deps.isPairedUser,
      ...(deps.canChat ? { canChat: deps.canChat } : {}),
      ...(deps.canUseBuiltin ? { canUseBuiltin: deps.canUseBuiltin } : {}),
      ...(deps.canUseDownloader ? { canUseDownloader: deps.canUseDownloader } : {}),
      ...(deps.isFlowAdmin ? { isFlowAdmin: deps.isFlowAdmin } : {}),
    });
  }

  /** The bot was added to (`join`) or removed from (`leave`) a group. */
  async groupJoined(chatId: string, chatKind: 'group' | 'room'): Promise<void> {
    this.deps.onLog(`${this.tag} added to ${chatKind} ${chatId}`);
    this.seenGroups.delete(chatId);
    const title = await this.noteGroup(chatId, chatKind);
    this.deps.onGroupJoined?.({ chatId, chatKind, ...(title ? { title } : {}) });
  }

  groupLeft(chatId: string, chatKind: 'group' | 'room'): void {
    this.seenGroups.delete(chatId);
    this.deps.onLog(`${this.tag} removed from ${chatKind} ${chatId}`);
    this.deps.onGroupLeft?.(chatId);
  }

  /** Registers a group the bot is in, with its name, once per run; returns the name it looked up. */
  protected async noteGroup(chatId: string, chatKind: 'group' | 'room'): Promise<string | undefined> {
    if (this.seenGroups.has(chatId) || !this.deps.onGroupSeen) return undefined;
    this.seenGroups.add(chatId);
    const title = await this.deps.output.groupName?.(chatId, chatKind).catch(() => undefined);
    this.deps.onGroupSeen({ chatId, chatKind, ...(title ? { title } : {}) });
    return title;
  }

  /** A group's name as the platform shows it, for notices about it; undefined when it has none. */
  async groupTitle(chatId: string): Promise<string | undefined> {
    return this.deps.output.groupName?.(chatId, 'group');
  }

  /** Records an unpaired person addressing the bot, with the name the platform shows for them there. */
  private noteUse(event: E): void {
    if (!this.deps.onUse || this.deps.isPairedUser(event.userId)) return;
    const known = this.names.get(event.userId);
    if (known) {
      this.deps.onUse({ userId: event.userId, displayName: known }, event.chatId);
      return;
    }
    void (async () => {
      const name = await this.deps.output.displayName(event).catch(() => undefined);
      if (name) this.names.set(event.userId, name);
      this.deps.onUse?.({ userId: event.userId, ...(name ? { displayName: name } : {}) }, event.chatId);
    })();
  }

  /**
   * A tap on a button the bot sent (a menu's choice): its line, as if the person had typed it to
   * the bot here — every check and the routing of a typed line. Only a line a menu sends (a link
   * the downloader takes, a command) is taken; anything else is logged and dropped. A downloader
   * button whose grant was taken away is refused rather than read by the agent.
   */
  async dispatchButtonLine(event: E): Promise<void> {
    const text = event.text.trim();
    const isLink = !text.startsWith('/') && linkCommandFor(text) !== null;
    if (!text || (!isLink && !text.startsWith('/'))) {
      this.deps.onLog(`${this.tag} menu tap from ${event.userId} with a line no menu sends — ignored`);
      return;
    }
    const typed: E = { ...event, text, mentionsBot: true, fromMenu: true };
    const pending = event.chatKind !== 'user' && this.deps.isGroupPending?.(event.chatId) === true;
    if (isLink && !pending && this.deps.canUseDownloader && !(await this.access.mayDownload(event.chatId, event.userId))) {
      this.deps.onLog(`${this.tag} downloader button refused for ${event.userId} — no download grant`);
      await this.reply(typed, botAccessDeniedText(this.deps.getStrings(), 'download'));
      return;
    }
    await this.dispatch([typed]);
  }

  /**
   * One delivery's messages, in order. They all reached this computer now, before any of them ran:
   * a question asked while one of them runs is answered only by a later delivery's message, never
   * by the next one in this batch (`answerSent`).
   */
  async dispatch(events: E[]): Promise<void> {
    const received: BotMessageSent = { sentAt: Date.now() };
    for (const event of events) {
      try {
        // Someone the owner blocked gets nothing at all — no reply, no pairing tip.
        if (this.deps.isBlocked?.(event.userId)) {
          this.deps.onLog(`${this.tag} message from blocked user ${event.userId} — ignored`);
          continue;
        }
        // A group the owner has not allowed yet: registered for settings, nothing else, for anyone.
        if (event.chatKind !== 'user' && this.deps.isGroupPending?.(event.chatId)) {
          await this.noteGroup(event.chatId, event.chatKind);
          if (!this.pendingLogged.has(event.chatId)) {
            this.pendingLogged.add(event.chatId);
            this.deps.onLog(`${this.tag} ${event.chatKind} ${event.chatId} waits for the owner's approval in settings — its messages are ignored`);
          }
          continue;
        }
        if (event.chatKind === 'user') {
          await this.dispatchPrivateMessage(event, received);
        } else {
          this.pendingLogged.delete(event.chatId);
          await this.dispatchGroupMessage(event, event.chatKind, received);
        }
      } catch (err: unknown) {
        this.deps.onLog(`${this.tag} dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async dispatchPrivateMessage(event: E, received: BotMessageSent): Promise<void> {
    const pairCode = parsePairCommand(event.text);
    if (pairCode !== null) {
      await this.handlePairCommand(event, pairCode);
      return;
    }
    if (!this.deps.isPairedUser(event.userId)) {
      // A private chat stays paired accounts only; the attempt still shows in "used the bot".
      this.noteUse(event);
      this.deps.onLog(`${this.tag} message from unpaired user ${event.userId} — not answered by the AI`);
      if (this.deps.onPairingRequest) {
        await this.deps.onPairingRequest(event);
        return;
      }
      await this.reply(event, this.pairingTip());
      return;
    }
    const command = parseBotCommand(event.text);
    if (command) {
      await this.handleCommand(event, command);
      return;
    }
    await this.answerOrRun(event, received);
  }

  private async dispatchGroupMessage(event: E, chatKind: 'group' | 'room', received: BotMessageSent): Promise<void> {
    // A group the bot was already in sends no join event: its messages register it.
    await this.noteGroup(event.chatId, chatKind);
    if (!event.mentionsBot) return;
    this.noteUse(event);
    if (!(await this.access.mayChat(event.chatId, event.userId))) {
      this.deps.onLog(`${this.tag} group mention from ${event.userId} in ${event.chatId} — not allowed to use the bot there, ignored`);
      return;
    }
    if (!event.text || event.text.startsWith('/')) {
      await this.reply(event, t(this.deps.getStrings(), 'bot.chat.mentionUsage'));
      return;
    }
    // "@bot <link>": the mention is already gone from the text, so it is the link alone.
    await this.answerOrRun(event, received);
  }

  /** The answer to a waiting question, else a link's own flow, else an agent run. */
  private async answerOrRun(event: E, received: BotMessageSent): Promise<void> {
    if (!event.fromMenu && this.deps.hasPendingAgentAsk(event.chatId, event.userId, answerSent(event, received))) {
      await this.runAgentAnswer(event, event.text);
      return;
    }
    // Only a post or a video link: Yobi's own flow for it, not the agent — given the download grant.
    const linkFlow = await this.downloaderFlowFor(event);
    if (linkFlow) {
      await this.runFlowCommand(event, linkFlow, event.text);
      return;
    }
    // A plain message is an agent turn — working out whether a question needs a tool is the
    // agent's job. How much it may use is the account's agent grant, decided where the run starts.
    await this.runBuiltin(event, 'agent', event.text, this.deps.getLlmDirect().targetUrl, 'direct');
  }

  private async handleCommand(event: E, command: BotCommand): Promise<void> {
    const s = this.deps.getStrings();
    if (isHelpCommand(command)) {
      await this.reply(event, await this.usageText(event.userId));
      return;
    }
    const ownerCommand = this.ownerCommands().find((entry) => entry.name === command.name);
    if (ownerCommand) {
      await ownerCommand.run(event);
      return;
    }
    this.deps.onDropAgentAsk(event.chatId, event.userId);

    if (command.name === BUILTIN_NEW_COMMAND) {
      const had = await this.deps.onNewConversation(event.chatId, event.userId);
      await this.reply(event, t(s, had ? 'bot.session.cleared' : 'bot.session.alreadyNew'));
      return;
    }

    const providers = this.deps.getProviderCommands();
    const reserved = this.reservedCommands();
    const target = resolveProviderTarget(command, providers, reserved);
    if (target) {
      await this.enqueueProviderTask(event, command, target.targetUrl);
      return;
    }

    const builtin = this.deps.getBuiltinCommands().find((bc) => bc.command === command.name);
    if (builtin) {
      await this.runBuiltinCommand(event, command, builtin);
      return;
    }

    const flow = this.deps.getFlowCommands?.().find((fc) => fc.command === command.name);
    if (flow && this.deps.onFlowCommand) {
      // Narrower than pairing: a command over a private data source stays registered on the bot
      // but only answers the ids its author listed, or the owner.
      if (!(await this.access.mayRunFlowCommand(flow, event.chatId, event.userId))) {
        this.deps.onLog(`${this.tag} /${command.name} refused for ${event.userId} — not on the command's allow list`);
        await this.reply(event, t(s, 'bot.chat.flowNotAllowed'));
        return;
      }
      await this.runFlowCommand(event, flow, command.argument);
      return;
    }

    const byok = this.deps.getByokCommands?.().find((bc) => bc.command === command.name);
    if (byok) {
      await this.enqueueProviderTask(event, command, byok.targetUrl);
      return;
    }

    const alias = resolveProviderAlias(command, providers, reserved);
    if (alias) {
      await this.enqueueProviderTask(event, command, alias.targetUrl);
      return;
    }

    await this.reply(event, t(s, 'bot.chat.unknownCommand', {
      command: command.name,
      commands: await this.commandList(event.userId),
    }));
  }

  /** A model command is a message with its model chosen: the same agent run, on that model. */
  private async enqueueProviderTask(event: E, command: BotCommand, targetUrl: string): Promise<void> {
    if (!command.argument) {
      await this.reply(event, t(this.deps.getStrings(), 'bot.chat.usage', { command: command.name }));
      return;
    }
    await this.runBuiltin(event, 'agent', command.argument, targetUrl, command.name);
  }

  private async runBuiltinCommand(event: E, command: BotCommand, builtin: ResolvedBuiltinCommand): Promise<void> {
    const s = this.deps.getStrings();
    if (!(await this.access.mayUseBuiltin(builtin.key, event.chatId, event.userId))) {
      this.deps.onLog(`${this.tag} /${command.name} refused for ${event.userId} — not granted`);
      await this.reply(event, botAccessDeniedText(s, builtinCommandGrant(builtin.key)));
      return;
    }
    if (!command.argument) {
      await this.reply(event, t(s, 'bot.chat.usage', { command: command.name }));
      return;
    }
    await this.runBuiltin(event, builtin.key, command.argument, builtin.targetUrl, command.name);
  }

  private async runBuiltin(event: E, key: BotRunKind, input: string, targetUrl: string, label: string): Promise<void> {
    const s = this.deps.getStrings();
    const ticket = await this.admitPaced(event);
    if (!ticket) return;
    await this.reply(event, t(s, 'bot.chat.queued'));
    try {
      const result = await this.deps.onBuiltinCommand(key, input, targetUrl, event.chatId, event.userId);
      await this.pushResult(event, result);
    } catch (err: unknown) {
      this.deps.onLog(`${this.tag} built-in /${label} failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.deps.output.push(event, t(s, 'bot.chat.queueFailed'));
    } finally {
      ticket.done();
    }
  }

  /**
   * The pace check of a request that starts work (an agent run, a flow): null = not taken, the
   * sender told once why (`botRequestPace.ts`). Deliveries run side by side, so a burst would
   * otherwise be that many runs at once. A button's line and an answer to the agent's question
   * follow the bot's own message and are never paced.
   */
  private async admitPaced(event: E): Promise<BotPaceTicket | null> {
    if (!this.deps.pace || event.fromMenu) return UNPACED;
    const verdict = this.deps.pace.admit(event.userId, {
      sentAt: event.sentAt ?? Date.now(),
      paired: this.deps.isPairedUser(event.userId),
    });
    if (verdict.ok) return verdict;
    this.deps.onLog(`${this.tag} request from ${event.userId} not taken — ${verdict.reason}${verdict.tell ? '' : ' (already told)'}`);
    if (verdict.tell) await this.reply(event, botPaceNotice(this.deps.getStrings(), verdict));
    return null;
  }

  private async runAgentAnswer(event: E, answer: string): Promise<void> {
    const s = this.deps.getStrings();
    await this.reply(event, t(s, 'bot.chat.queued'));
    try {
      const result = await this.deps.onAgentAnswer(answer, event.chatId, event.userId);
      if (!result) {
        await this.deps.output.push(event, t(s, 'bot.builtin.notResumable'));
        return;
      }
      await this.pushResult(event, result);
    } catch (err: unknown) {
      this.deps.onLog(`${this.tag} agent answer failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.deps.output.push(event, t(s, 'bot.chat.queueFailed'));
    }
  }

  private async pushResult(event: E, result: Parameters<BotChatRouterDeps<E>['output']['pushResult']>[1]): Promise<void> {
    if (await this.deps.output.pushResult(event, result)) return;
    // Never clipped: a question the user cannot read whole is withdrawn, so no "1" can approve it.
    const s = this.deps.getStrings();
    this.deps.onLog(`${this.tag} a ${result.text.length}-character question does not fit one message — withdrawn`);
    this.deps.onDropAgentAsk(event.chatId, event.userId);
    await this.deps.output.push(event, `${t(s, 'bot.chat.runFailed', { provider: result.providerLabel })}\n${t(s, 'bot.builtin.failed')}`);
  }

  private async runFlowCommand(event: E, flow: Pick<BotFlowCommandDef, 'flowId' | 'inputVariable' | 'command'>, input: string): Promise<void> {
    const s = this.deps.getStrings();
    const onFlowCommand = this.deps.onFlowCommand;
    if (!onFlowCommand) return;
    const ticket = await this.admitPaced(event);
    if (!ticket) return;
    await this.reply(event, t(s, 'bot.chat.queued'));

    let started: Awaited<ReturnType<typeof onFlowCommand>>;
    try {
      const replyRef = this.deps.output.replyRef?.(event);
      started = replyRef
        ? await onFlowCommand(flow.flowId, flow.inputVariable, input, event.userId, event.chatId, replyRef)
        : await onFlowCommand(flow.flowId, flow.inputVariable, input, event.userId, event.chatId);
    } catch (err: unknown) {
      ticket.done();
      this.deps.onLog(`${this.tag} failed to queue flow /${flow.command}: ${err instanceof Error ? err.message : String(err)}`);
      await this.deps.output.push(event, t(s, 'bot.chat.queueFailed'));
      return;
    }
    this.deps.onLog(`[${started.taskId}] ${BOT_PLATFORM_NAMES[this.deps.platform]} flow command /${flow.command} triggered by ${event.userId}`);

    void started.result.finally(ticket.done).then(async (flowResult) => {
      if (flowResult.success) return;
      await this.deps.output.push(event, botFlowEndText(s, flowResult));
    }).catch(async (err: unknown) => {
      this.deps.onLog(`${this.tag} flow command failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.deps.output.push(event, t(s, 'bot.chat.flowFailed'));
    });
  }

  private async handlePairCommand(event: E, code: string): Promise<void> {
    const s = this.deps.getStrings();
    const { userId } = event;
    if (this.deps.isPairedUser(userId)) {
      await this.reply(event, t(s, 'bot.chat.pair.alreadyPaired'));
      return;
    }
    if (this.pairAttempts.isBlocked(userId)) {
      this.deps.onLog(`${this.tag} pairing throttled for ${userId}`);
      await this.reply(event, t(s, 'bot.chat.pair.tooManyAttempts'));
      return;
    }
    const displayName = await this.deps.output.displayName(event).catch(() => undefined);
    const result = this.deps.consumePairingCode(code, { userId, ...(displayName ? { displayName } : {}) });
    if (!result.ok) {
      this.pairAttempts.recordFailure(userId);
      this.deps.onLog(`${this.tag} pairing rejected for ${userId}: ${result.reason ?? 'invalid_code'}`);
      await this.reply(event, t(s, 'bot.chat.pair.invalidCode'));
      return;
    }
    this.pairAttempts.reset(userId);
    this.deps.onLog(`${this.tag} paired user ${userId}${displayName ? ` (${displayName})` : ''}`);
    this.deps.onCodePaired?.(code, userId);
    await this.reply(event, `${t(s, 'bot.chat.pair.completed')}\n\n${await this.usageText(userId)}`);
  }

  /** What an unpaired person is told in their private chat: where the owner makes a pairing code. */
  pairingTip(): string {
    return t(this.deps.getStrings(), 'bot.chat.pair.tip', { platform: BOT_PLATFORM_NAMES[this.deps.platform] });
  }

  /** The owner's management commands this bot has; each handler checks it is the owner. */
  private ownerCommands(): Array<{ name: string; run: (event: E) => Promise<void> }> {
    return Object.entries(this.deps.ownerCommands ?? {})
      .flatMap(([name, run]) => (run ? [{ name, run }] : []));
  }

  /**
   * Names a model command or alias never takes besides pairing and help: every owner command the
   * platform has, whether or not it is wired this run.
   */
  private reservedCommands(): ReadonlySet<string> {
    return new Set(Object.keys(this.deps.ownerCommands ?? {}));
  }

  /** `/help` for this account: what it may use, as a paired account sees it. */
  helpText(userId: string): Promise<string> {
    return this.usageText(userId);
  }

  /**
   * Listing a command someone is not allowed to run only invites them to try it, so the
   * requester is required: no caller can ask for an unfiltered list.
   */
  private async commandList(userId: string): Promise<string> {
    const builtins: string[] = [];
    for (const bc of this.deps.getBuiltinCommands()) {
      // Lists are only shown in a private chat, whose chat id is the account's own id.
      if (await this.access.mayUseBuiltin(bc.key, userId, userId)) builtins.push(`/${bc.command}`);
    }
    // Managing groups, accounts and invites is the owner's alone; the handler checks again when typed.
    const ownerCommands = this.ownerCommands();
    if (ownerCommands.length > 0 && (await this.access.isFlowAdmin(userId, userId))) {
      builtins.push(...ownerCommands.map((entry) => `/${entry.name}`));
    }
    const builtinCommands = [`/${BUILTIN_NEW_COMMAND}`, ...builtins];
    const flowCommands: string[] = [];
    for (const fc of this.deps.getFlowCommands?.() ?? []) {
      if (await this.access.mayRunFlowCommand(fc, userId, userId)) flowCommands.push(`/${fc.command}`);
    }
    const byokCommands = (this.deps.getByokCommands?.() ?? []).map((bc) => `/${bc.command}`);
    return [
      listProviderCommands(this.deps.getProviderCommands()),
      ...builtinCommands,
      ...flowCommands,
      ...byokCommands,
    ]
      .filter(Boolean)
      .join('  ');
  }

  private async usageText(userId: string): Promise<string> {
    return t(this.deps.getStrings(), 'bot.chat.help', { commands: await this.commandList(userId) });
  }

  /**
   * The downloader's built-in for a message that is only a link, or null — also when the account
   * lacks the download grant, so the link is answered like any other message.
   */
  private async downloaderFlowFor(event: E): Promise<ReturnType<typeof linkCommandFor>> {
    const allows = event.fromMenu ? undefined : this.deps.linkSites?.();
    const linkFlow = this.deps.onFlowCommand ? linkCommandFor(event.text, allows) : null;
    if (!linkFlow || !this.deps.canUseDownloader) return linkFlow;
    if (await this.access.mayDownload(event.chatId, event.userId)) return linkFlow;
    this.deps.onLog(`${this.tag} link from ${event.userId} left to the agent — no download grant`);
    return null;
  }

  protected reply(event: E, text: string): Promise<void> {
    return this.deps.output.reply(event, text);
  }
}

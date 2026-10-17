import { localizeUserFacingError, t } from '../i18n';
import { BUILTIN_NEW_COMMAND } from '../../shared/types';
import { isBotCommandAdminOnly, isBotCommandAllowed } from '../../shared/botCommandAccess';
import { linkCommandFor } from '../../shared/builtinFlows';
import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import { builtinCommandGrant } from '../../shared/botPermissions';
import { botAccessDeniedText } from '../botPermissions/denial';
import { summarizeFlowError } from '../../shared/flowErrorReason';
import type { BotBuiltinCommandKey, BotLlmDirectConfig, BotRunKind, FlowExecutionResult } from '../../shared/types';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import type { ByokCommandDef } from '../byokCommands';
import { formatLineReply, verbatimLineText } from './format';
import { createAttemptLimiter } from './attemptLimiter';
import type { LineClient } from './client';
import {
  isHelpCommand,
  listProviderCommands,
  parseLineCommand,
  parsePairCommand,
  resolveProviderAlias,
  resolveProviderTarget,
} from './commands';
import type { LineCommand } from './commands';
import type { ResolvedBuiltinCommand, ResolvedProviderCommand } from '../providerCommands';
import type { LineChatEvent, LineTextEvent } from './events';
import { respond, safePush } from './messaging';
import type { LinePairingUserProfile } from './pairing';

export interface LineFlowCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
  /**
   * 'admins' = the owner in their own private chat. Absent: an empty list = every paired user,
   * a non-empty one = those ids.
   */
  access?: BotCommandAccessMode;
  allowedUserIds: string[];
}

export interface LineDispatcherDeps {
  getClient: () => LineClient | null;
  isPairedUser: (userId: string) => boolean;
  consumePairingCode: (code: string, user: LinePairingUserProfile) => { ok: boolean; reason?: string };
  onLog: (message: string) => void;
  getStrings: () => Record<string, string>;
  getLlmDirect: () => BotLlmDirectConfig;
  getProviderCommands: () => ResolvedProviderCommand[];
  getBuiltinCommands: () => ResolvedBuiltinCommand[];
  onBuiltinCommand: (
    key: BotRunKind,
    input: string,
    targetUrl: string,
    chatId: string,
    userId: string,
  ) => Promise<BotBuiltinRunResult>;
  /**
   * Whether this account may type this built-in command in this chat (its grants: web for
   * `/search`). Asked before anything is queued and when listing commands.
   */
  canUseBuiltin?: (key: BotBuiltinCommandKey, chatId: string, userId: string) => Promise<boolean>;
  /**
   * Whether this account's pasted link may run the downloader in this chat. Without it the link
   * is an ordinary message; the flow runner checks again.
   */
  canUseDownloader?: (chatId: string, userId: string) => Promise<boolean>;
  /**
   * Whether this person may talk to the bot in this chat: every paired account, an unpaired person
   * in a group that grants it. Absent = pairing alone decides.
   */
  canChat?: (chatId: string, userId: string) => Promise<boolean>;
  /**
   * Whether this account may run a flow command limited to admins in this chat: on LINE the
   * owner alone, in their own private chat. Absent = nobody may.
   */
  isFlowAdmin?: (chatId: string, userId: string) => Promise<boolean>;
  /** Blocked by the owner: nothing they send is answered. */
  isBlocked?: (userId: string) => boolean;
  /**
   * A group or multi-person chat the owner has not allowed yet: nothing anyone sends there is
   * answered (paired accounts included); it is still registered so settings can list it.
   */
  isGroupPending?: (chatId: string) => boolean;
  /** The bot was just added to this group or multi-person chat (a join event). */
  onGroupJoined?: (group: { chatId: string; chatKind: 'group' | 'room'; title?: string }) => void;
  /** An unpaired person addressed the bot here — the owner's "used the bot" list. */
  onUse?: (user: { userId: string; displayName?: string }, chatId: string) => void;
  /** The bot is in this group or multi-person chat (joined, or a message showed it). */
  onGroupSeen?: (group: { chatId: string; chatKind: 'group' | 'room'; title?: string }) => void;
  /** The bot was removed from this group or multi-person chat. */
  onGroupLeft?: (chatId: string) => void;
  onAgentAnswer: (answer: string, chatId: string, userId: string) => Promise<BotBuiltinRunResult | null>;
  hasPendingAgentAsk: (chatId: string, userId: string) => boolean;
  onDropAgentAsk: (chatId: string, userId: string) => void;
  onNewConversation: (chatId: string, userId: string) => Promise<boolean>;
  getFlowCommands?: () => LineFlowCommandDef[];
  getByokCommands?: () => ByokCommandDef[];
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: string,
    /** Where the flow answers: the person's own chat, or the group they asked in. */
    chatId: string,
  ) => Promise<{ taskId: string; result: Promise<FlowCommandResult> }>;
}

type FlowCommandResult = Pick<FlowExecutionResult, 'success' | 'error' | 'displayError' | 'aborted'>;

export class LineDispatcher {
  private readonly pairAttempts = createAttemptLimiter();
  /** Groups registered this run, so a busy group is looked up once, not on every mention. */
  private readonly seenGroups = new Set<string>();
  /** Pending groups already logged this run: LINE delivers every group message, not just mentions. */
  private readonly pendingLogged = new Set<string>();
  /** Names looked up this run, by user id. */
  private readonly names = new Map<string, string>();

  constructor(private readonly deps: LineDispatcherDeps) {}

  async dispatchChatEvents(events: LineChatEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type === 'leave') {
        this.seenGroups.delete(event.chatId);
        this.deps.onLog(`[line] removed from ${event.chatKind} ${event.chatId}`);
        this.deps.onGroupLeft?.(event.chatId);
        continue;
      }
      this.deps.onLog(`[line] added to ${event.chatKind} ${event.chatId}`);
      this.seenGroups.delete(event.chatId);
      const title = await this.noteGroup(event.chatId, event.chatKind);
      this.deps.onGroupJoined?.({ chatId: event.chatId, chatKind: event.chatKind, ...(title ? { title } : {}) });
    }
  }

  /** Registers a group the bot is in, with its name, once per run; returns the name it looked up. */
  private async noteGroup(chatId: string, chatKind: 'group' | 'room'): Promise<string | undefined> {
    if (this.seenGroups.has(chatId) || !this.deps.onGroupSeen) return undefined;
    this.seenGroups.add(chatId);
    const title = chatKind === 'group' ? await this.deps.getClient()?.getGroupName(chatId).catch(() => undefined) : undefined;
    this.deps.onGroupSeen({ chatId, chatKind, ...(title ? { title } : {}) });
    return title;
  }

  /** Records an unpaired person addressing the bot, with the name LINE shows for them there. */
  private noteUse(event: LineTextEvent): void {
    if (!this.deps.onUse || this.deps.isPairedUser(event.userId)) return;
    const known = this.names.get(event.userId);
    if (known) {
      this.deps.onUse({ userId: event.userId, displayName: known }, event.chatId);
      return;
    }
    void (async () => {
      const client = this.deps.getClient();
      const name = event.chatKind === 'user'
        ? await client?.getDisplayName(event.userId).catch(() => undefined)
        : await client?.getMemberName(event.chatKind, event.chatId, event.userId).catch(() => undefined);
      if (name) this.names.set(event.userId, name);
      this.deps.onUse?.({ userId: event.userId, ...(name ? { displayName: name } : {}) }, event.chatId);
    })();
  }

  /** Whether this person may talk to the bot here; an error reading the rights refuses. */
  private async mayChat(event: LineTextEvent): Promise<boolean> {
    if (!this.deps.canChat) return this.deps.isPairedUser(event.userId);
    try {
      return await this.deps.canChat(event.chatId, event.userId);
    } catch (err: unknown) {
      this.deps.onLog(`[line] could not read the rights of ${event.userId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async dispatch(events: LineTextEvent[]): Promise<void> {
    for (const event of events) {
      try {
        // Someone the owner blocked gets nothing at all — no reply, no pairing tip.
        if (this.deps.isBlocked?.(event.userId)) {
          this.deps.onLog(`[line] message from blocked user ${event.userId} — ignored`);
          continue;
        }
        // A group the owner has not allowed yet: registered for settings, nothing else, for anyone.
        if (event.chatKind !== 'user' && this.deps.isGroupPending?.(event.chatId)) {
          await this.noteGroup(event.chatId, event.chatKind);
          if (!this.pendingLogged.has(event.chatId)) {
            this.pendingLogged.add(event.chatId);
            this.deps.onLog(`[line] ${event.chatKind} ${event.chatId} waits for the owner's approval in settings — its messages are ignored`);
          }
          continue;
        }
        if (event.chatKind !== 'user') this.pendingLogged.delete(event.chatId);
        if (event.chatKind === 'user') {
          await this.dispatchPrivateMessage(event);
        } else {
          await this.dispatchGroupMessage(event);
        }
      } catch (err: unknown) {
        this.deps.onLog(`[line] dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async dispatchPrivateMessage(event: LineTextEvent): Promise<void> {
    const pairCode = parsePairCommand(event.text);
    if (pairCode !== null) {
      await this.handlePairCommand(event, pairCode);
      return;
    }
    if (!this.deps.isPairedUser(event.userId)) {
      // A private chat stays paired accounts only; the attempt still shows in "used the bot".
      this.noteUse(event);
      this.deps.onLog(`[line] message from unpaired user ${event.userId} — ignored`);
      await this.reply(event, t(this.deps.getStrings(), 'line.pair.tip'));
      return;
    }
    const command = parseLineCommand(event.text);
    if (command) {
      await this.handleCommand(event, command);
      return;
    }
    if (this.deps.hasPendingAgentAsk(event.chatId, event.userId)) {
      await this.runAgentAnswer(event, event.text);
      return;
    }
    // Only a post or a video link: Yobi's own flow for it, not the agent — given the download grant.
    const linkFlow = await this.downloaderFlowFor(event);
    if (linkFlow) {
      await this.runFlowCommand(event, linkFlow, event.text);
      return;
    }
    await this.runDirectMessage(event, event.text, this.deps.getLlmDirect().targetUrl);
  }

  private async dispatchGroupMessage(event: LineTextEvent): Promise<void> {
    // A group the bot was already in sends no join event: its messages register it.
    if (event.chatKind !== 'user') await this.noteGroup(event.chatId, event.chatKind);
    if (!event.mentionsBot) return;
    this.noteUse(event);
    if (!(await this.mayChat(event))) {
      this.deps.onLog(`[line] group mention from ${event.userId} in ${event.chatId} — not allowed to use the bot there, ignored`);
      return;
    }
    if (!event.text || event.text.startsWith('/')) {
      await this.reply(event, t(this.deps.getStrings(), 'line.direct.mentionUsage'));
      return;
    }
    if (this.deps.hasPendingAgentAsk(event.chatId, event.userId)) {
      await this.runAgentAnswer(event, event.text);
      return;
    }
    // "@bot <link>": the mention is already gone from the text, so it is the link alone.
    const linkFlow = await this.downloaderFlowFor(event);
    if (linkFlow) {
      await this.runFlowCommand(event, linkFlow, event.text);
      return;
    }
    await this.runDirectMessage(event, event.text, this.deps.getLlmDirect().targetUrl);
  }

  private async handleCommand(event: LineTextEvent, command: LineCommand): Promise<void> {
    const s = this.deps.getStrings();
    if (isHelpCommand(command)) {
      await this.reply(event, await this.usageText(event.userId));
      return;
    }
    this.deps.onDropAgentAsk(event.chatId, event.userId);

    if (command.name === BUILTIN_NEW_COMMAND) {
      const had = await this.deps.onNewConversation(event.chatId, event.userId);
      await this.reply(event, t(s, had ? 'bot.session.cleared' : 'bot.session.alreadyNew'));
      return;
    }

    const providers = this.deps.getProviderCommands();
    const target = resolveProviderTarget(command, providers);
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
      if (!(await this.mayRunFlowCommand(flow, event.chatId, event.userId))) {
        this.deps.onLog(`[line] /${command.name} refused for ${event.userId} — not on the command's allow list`);
        await this.reply(event, t(s, 'line.cmd.flowNotAllowed'));
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

    const alias = resolveProviderAlias(command, providers);
    if (alias) {
      await this.enqueueProviderTask(event, command, alias.targetUrl);
      return;
    }

    await this.reply(event, t(s, 'line.cmd.unknown', {
      command: command.name,
      commands: await this.commandList(event.userId),
    }));
  }

  /** A model command is a message with its model chosen: the same agent run, on that model. */
  private async enqueueProviderTask(
    event: LineTextEvent,
    command: LineCommand,
    targetUrl: string,
  ): Promise<void> {
    if (!command.argument) {
      await this.reply(event, t(this.deps.getStrings(), 'line.cmd.usage', { command: command.name }));
      return;
    }
    await this.runBuiltin(event, 'agent', command.argument, targetUrl, command.name);
  }

  private async runBuiltinCommand(
    event: LineTextEvent,
    command: LineCommand,
    builtin: ResolvedBuiltinCommand,
  ): Promise<void> {
    const s = this.deps.getStrings();
    if (!(await this.mayUseBuiltin(builtin.key, event.chatId, event.userId))) {
      this.deps.onLog(`[line] /${command.name} refused for ${event.userId} — not granted`);
      await this.reply(event, botAccessDeniedText(s, builtinCommandGrant(builtin.key)));
      return;
    }
    if (!command.argument) {
      await this.reply(event, t(s, 'line.cmd.usage', { command: command.name }));
      return;
    }
    await this.runBuiltin(event, builtin.key, command.argument, builtin.targetUrl, command.name);
  }

  /**
   * A plain message is an agent turn — working out whether a question needs a tool is the agent's
   * job, not something the user should have to declare with a command first. How much it may use is
   * the account's agent grant, decided where the run starts.
   */
  private async runDirectMessage(event: LineTextEvent, text: string, targetUrl: string): Promise<void> {
    await this.runBuiltin(event, 'agent', text, targetUrl, 'direct');
  }

  private async runBuiltin(
    event: LineTextEvent,
    key: BotRunKind,
    input: string,
    targetUrl: string,
    label: string,
  ): Promise<void> {
    const s = this.deps.getStrings();
    await this.reply(event, t(s, 'line.cmd.queued'));
    try {
      const result = await this.deps.onBuiltinCommand(key, input, targetUrl, event.chatId, event.userId);
      await this.pushResult(event, result);
    } catch (err: unknown) {
      this.deps.onLog(`[line] built-in /${label} failed: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.queueFailed'), this.deps.onLog);
    }
  }

  private async runAgentAnswer(event: LineTextEvent, answer: string): Promise<void> {
    const s = this.deps.getStrings();
    await this.reply(event, t(s, 'line.cmd.queued'));
    try {
      const result = await this.deps.onAgentAnswer(answer, event.chatId, event.userId);
      if (!result) {
        await safePush(this.deps.getClient(), event.chatId, t(s, 'bot.builtin.notResumable'), this.deps.onLog);
        return;
      }
      await this.pushResult(event, result);
    } catch (err: unknown) {
      this.deps.onLog(`[line] agent answer failed: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.queueFailed'), this.deps.onLog);
    }
  }

  private async pushResult(event: LineTextEvent, result: BotBuiltinRunResult): Promise<void> {
    const s = this.deps.getStrings();
    if (result.ok && result.verbatim) {
      const verbatim = verbatimLineText(result.text);
      if (verbatim !== null) {
        await safePush(this.deps.getClient(), event.chatId, verbatim, this.deps.onLog);
        return;
      }
      // Never clipped: a question the user cannot read whole is withdrawn, so no "1" can approve it.
      this.deps.onLog(`[line] a ${result.text.length}-character question does not fit one message — withdrawn`);
      this.deps.onDropAgentAsk(event.chatId, event.userId);
      await safePush(this.deps.getClient(), event.chatId, `${t(s, 'line.msg.failed', { provider: result.providerLabel })}\n${t(s, 'bot.builtin.failed')}`, this.deps.onLog);
      return;
    }
    const text = result.ok
      ? formatLineReply(result.text, t(s, 'line.msg.emptyResponse'))
      : `${t(s, 'line.msg.failed', { provider: result.providerLabel })}\n${result.text}`;
    await safePush(this.deps.getClient(), event.chatId, text, this.deps.onLog);
  }

  private async runFlowCommand(
    event: LineTextEvent,
    flow: LineFlowCommandDef,
    input: string,
  ): Promise<void> {
    const s = this.deps.getStrings();
    await this.reply(event, t(s, 'line.cmd.queued'));

    let taskId: string;
    let result: Promise<FlowCommandResult>;
    try {
      ({ taskId, result } = await this.deps.onFlowCommand!(
        flow.flowId,
        flow.inputVariable,
        input,
        event.userId,
        event.chatId,
      ));
    } catch (err: unknown) {
      this.deps.onLog(`[line] failed to queue flow /${flow.command}: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.queueFailed'), this.deps.onLog);
      return;
    }
    this.deps.onLog(`[${taskId}] LINE flow command /${flow.command} triggered by ${event.userId}`);

    void result.then(async (flowResult) => {
      if (flowResult.success) return;
      const text = flowResult.aborted ? t(s, 'line.cmd.flowStopped') : this.flowFailedText(flowResult);
      await safePush(this.deps.getClient(), event.chatId, text, this.deps.onLog);
    }).catch(async (err: unknown) => {
      this.deps.onLog(`[line] flow command failed: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.flowFailed'), this.deps.onLog);
    });
  }

  private async handlePairCommand(event: LineTextEvent, code: string): Promise<void> {
    const s = this.deps.getStrings();
    const { userId } = event;
    if (this.deps.isPairedUser(userId)) {
      await this.reply(event, t(s, 'line.pair.alreadyPaired'));
      return;
    }
    if (this.pairAttempts.isBlocked(userId)) {
      this.deps.onLog(`[line] pairing throttled for ${userId}`);
      await this.reply(event, t(s, 'line.pair.tooManyAttempts'));
      return;
    }
    const displayName = await this.deps.getClient()?.getDisplayName(userId);
    const result = this.deps.consumePairingCode(code, { userId, displayName });
    if (!result.ok) {
      this.pairAttempts.recordFailure(userId);
      this.deps.onLog(`[line] pairing rejected for ${userId}: ${result.reason ?? 'invalid_code'}`);
      await this.reply(event, t(s, 'line.pair.invalidCode'));
      return;
    }
    this.pairAttempts.reset(userId);
    this.deps.onLog(`[line] paired user ${userId}${displayName ? ` (${displayName})` : ''}`);
    await this.reply(event, `${t(s, 'line.pair.completed')}\n\n${await this.usageText(userId)}`);
  }

  /**
   * A bare "the flow failed" leaves the sender with nowhere to go — the run's real complaint
   * lives in the app's log, which is not where they are. The run's own wording comes first.
   */
  private flowFailedText(result: Pick<FlowExecutionResult, 'error' | 'displayError'>): string {
    const s = this.deps.getStrings();
    const reason = summarizeFlowError(result.displayError ?? localizeUserFacingError(result.error ?? '', s));
    return reason ? t(s, 'line.cmd.flowFailedReason', { reason }) : t(s, 'line.cmd.flowFailed');
  }

  /**
   * Listing a command someone is not allowed to run only invites them to try it, so the
   * requester is required: no caller can ask for an unfiltered list.
   */
  private async commandList(userId: string): Promise<string> {
    const builtins: string[] = [];
    for (const bc of this.deps.getBuiltinCommands()) {
      // Lists are only shown in a private chat, whose chat id is the account's own id.
      if (await this.mayUseBuiltin(bc.key, userId, userId)) builtins.push(`/${bc.command}`);
    }
    const builtinCommands = [`/${BUILTIN_NEW_COMMAND}`, ...builtins];
    const flowCommands: string[] = [];
    for (const fc of this.deps.getFlowCommands?.() ?? []) {
      if (await this.mayRunFlowCommand(fc, userId, userId)) flowCommands.push(`/${fc.command}`);
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
    return t(this.deps.getStrings(), 'line.help.usage', { commands: await this.commandList(userId) });
  }

  /**
   * The downloader's built-in for a message that is only a link, or null — also when the account
   * lacks the download grant, so the link is answered like any other message.
   */
  private async downloaderFlowFor(event: LineTextEvent): Promise<ReturnType<typeof linkCommandFor>> {
    const linkFlow = this.deps.onFlowCommand ? linkCommandFor(event.text) : null;
    if (!linkFlow || !this.deps.canUseDownloader) return linkFlow;
    try {
      if (await this.deps.canUseDownloader(event.chatId, event.userId)) return linkFlow;
      this.deps.onLog(`[line] link from ${event.userId} left to the agent — no download grant`);
    } catch (err: unknown) {
      this.deps.onLog(`[line] could not read the grants of ${event.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  /**
   * Whether this account may run this flow command here: its allow list, or for a command limited
   * to admins who is asking and where. Fails closed like the grants.
   */
  private async mayRunFlowCommand(command: LineFlowCommandDef, chatId: string, userId: string): Promise<boolean> {
    if (!isBotCommandAdminOnly(command)) return isBotCommandAllowed(command, userId);
    if (!this.deps.isFlowAdmin) return false;
    try {
      return isBotCommandAllowed(command, userId, { admin: await this.deps.isFlowAdmin(chatId, userId) });
    } catch (err: unknown) {
      this.deps.onLog(`[line] could not read the grants of ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** A grant check that fails closed: an error reading the grants refuses the command. */
  private async mayUseBuiltin(key: BotBuiltinCommandKey, chatId: string, userId: string): Promise<boolean> {
    if (!this.deps.canUseBuiltin) return true;
    try {
      return await this.deps.canUseBuiltin(key, chatId, userId);
    } catch (err: unknown) {
      this.deps.onLog(`[line] could not read the grants of ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private reply(event: LineTextEvent, text: string): Promise<void> {
    return respond(this.deps.getClient(), event, text, this.deps.onLog);
  }
}

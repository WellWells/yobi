import { localizeUserFacingError, t } from '../i18n';
import { BUILTIN_NEW_COMMAND } from '../../shared/types';
import { isBotCommandAllowed } from '../../shared/botCommandAccess';
import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import { builtinCommandGrant } from '../../shared/botPermissions';
import { botAccessDeniedText } from '../botPermissions/denial';
import { summarizeFlowError } from '../../shared/flowErrorReason';
import type { BotBuiltinCommandKey, BotLlmDirectConfig, BotRunKind, FlowExecutionResult } from '../../shared/types';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import type { ByokCommandDef } from '../byokCommands';
import { formatLineReply } from './format';
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
import type { LineTextEvent } from './events';
import { respond, safePush } from './messaging';
import type { LinePairingUserProfile } from './pairing';

export interface LineFlowCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
  /** Absent reads the list the legacy way: empty = every paired user, non-empty = those ids. */
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
  ) => Promise<{ taskId: string; result: Promise<{ success: boolean; error?: string }> }>;
}

export class LineDispatcher {
  private readonly pairAttempts = createAttemptLimiter();

  constructor(private readonly deps: LineDispatcherDeps) {}

  async dispatch(events: LineTextEvent[]): Promise<void> {
    for (const event of events) {
      try {
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
    await this.runDirectMessage(event, event.text, this.deps.getLlmDirect().targetUrl);
  }

  private async dispatchGroupMessage(event: LineTextEvent): Promise<void> {
    if (!event.mentionsBot) return;
    if (!this.deps.isPairedUser(event.userId)) {
      this.deps.onLog(`[line] group mention from unpaired user ${event.userId} — ignored`);
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
      // but only answers the ids its author listed.
      if (!isBotCommandAllowed(flow, event.userId)) {
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
    let result: Promise<{ success: boolean; error?: string }>;
    try {
      ({ taskId, result } = await this.deps.onFlowCommand!(
        flow.flowId,
        flow.inputVariable,
        input,
        event.userId,
      ));
    } catch (err: unknown) {
      this.deps.onLog(`[line] failed to queue flow /${flow.command}: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.queueFailed'), this.deps.onLog);
      return;
    }
    this.deps.onLog(`[${taskId}] LINE flow command /${flow.command} triggered by ${event.userId}`);

    void result.then(async (flowResult) => {
      if (flowResult.success) return;
      await safePush(this.deps.getClient(), event.chatId, this.flowFailedText(flowResult), this.deps.onLog);
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
    const flowCommands = (this.deps.getFlowCommands?.() ?? [])
      .filter((fc) => isBotCommandAllowed(fc, userId))
      .map((fc) => `/${fc.command}`);
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

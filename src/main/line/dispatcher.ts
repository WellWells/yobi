import { t } from '../i18n';
import type { BotLlmDirectConfig } from '../../shared/types';
import type { ByokCommandDef } from '../byokCommands';
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
import type { ResolvedProviderCommand } from '../providerCommands';
import type { LineTextEvent } from './events';
import { respond, safePush } from './messaging';
import type { LinePairingUserProfile } from './pairing';

export interface LineTaskRequest {
  userId: string;
  // Where the async result is pushed: the userId in a 1:1 chat, the
  // groupId/roomId when triggered by tagging the bot in a group.
  chatId: string;
  text: string;
  // Set when the message named a provider ('/gemini hi') or command-free chat
  // picked one; otherwise the default provider from config is used.
  targetUrl?: string;
}

export interface LineFlowCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
}

export interface LineDispatcherDeps {
  getClient: () => LineClient | null;
  isPairedUser: (userId: string) => boolean;
  consumePairingCode: (code: string, user: LinePairingUserProfile) => { ok: boolean; reason?: string };
  onTaskRequest: (request: LineTaskRequest) => Promise<{ taskId: string }>;
  onLog: (message: string) => void;
  getStrings: () => Record<string, string>;
  // Read on every message, never cached, so a settings change applies without
  // restarting the webhook server.
  getLlmDirect: () => BotLlmDirectConfig;
  // The AI provider commands as configured in the shared bot-command settings.
  // Read per message like the rest: renaming '/gemini' takes effect at once.
  getProviderCommands: () => ResolvedProviderCommand[];
  // Read on every message, never cached: a flow command saved a second ago must
  // answer without restarting anything. LINE has no command-registration API, so
  // there is nothing to sync — resolving late is the whole mechanism.
  getFlowCommands?: () => LineFlowCommandDef[];
  // Same live resolution for BYOK key/group commands ('/mykey …').
  getByokCommands?: () => ByokCommandDef[];
  onFlowCommand?: (
    flowId: string,
    inputVariable: string,
    input: string,
    userId: string,
  ) => Promise<{ taskId: string; result: Promise<{ success: boolean }> }>;
}

// Routes verified webhook events: pairing, bot-owned commands, provider commands
// and plain prompts. Everything it answers goes out on the event's reply token.
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
    // Plain text reaches the AI only when command-free chat is on; otherwise the
    // reply teaches the commands so the bot never looks dead.
    const direct = this.deps.getLlmDirect();
    if (!direct.enabled) {
      await this.reply(event, t(this.deps.getStrings(), 'line.direct.disabledHint', {
        commands: this.commandList(),
      }));
      return;
    }
    await this.enqueueTask(event, event.text, direct.targetUrl || undefined);
  }

  // Group/room messages are ignored unless the sender explicitly tagged the bot;
  // an untagged conversation is none of the bot's business. Unpaired senders are
  // dropped silently — a reply would let anyone make the bot spam the group.
  private async dispatchGroupMessage(event: LineTextEvent): Promise<void> {
    if (!event.mentionsBot) return;
    if (!this.deps.isPairedUser(event.userId)) {
      this.deps.onLog(`[line] group mention from unpaired user ${event.userId} — ignored`);
      return;
    }
    const s = this.deps.getStrings();
    const direct = this.deps.getLlmDirect();
    if (!direct.enabled) {
      // Not the 1:1 hint: it suggests slash commands, which are 1:1-only.
      await this.reply(event, t(s, 'line.direct.disabledHintGroup'));
      return;
    }
    // Slash commands are 1:1-only; a tagged '/gemini hi' would otherwise go to
    // the AI as a literal prompt, which reads like the command silently worked.
    if (!event.text || event.text.startsWith('/')) {
      await this.reply(event, t(s, 'line.direct.mentionUsage'));
      return;
    }
    await this.enqueueTask(event, event.text, direct.targetUrl || undefined);
  }

  // A paired user's slash command either names a provider, a flow, a BYOK key or
  // is unknown — it is never forwarded to the AI verbatim, which would silently
  // answer '/gemini hi' on whatever the default provider happens to be.
  private async handleCommand(event: LineTextEvent, command: LineCommand): Promise<void> {
    const s = this.deps.getStrings();
    if (isHelpCommand(command)) {
      await this.reply(event, this.usageText());
      return;
    }
    const providers = this.deps.getProviderCommands();
    const target = resolveProviderTarget(command, providers);
    if (target) {
      await this.enqueueProviderTask(event, command, target.targetUrl);
      return;
    }

    const flow = this.deps.getFlowCommands?.().find((fc) => fc.command === command.name);
    if (flow && this.deps.onFlowCommand) {
      await this.runFlowCommand(event, flow, command.argument);
      return;
    }

    const byok = this.deps.getByokCommands?.().find((bc) => bc.command === command.name);
    if (byok) {
      await this.enqueueProviderTask(event, command, byok.targetUrl);
      return;
    }

    // Last: a provider's own name ('/chatgpt') after it was renamed. Resolved
    // here so a flow or BYOK command owning that name always wins.
    const alias = resolveProviderAlias(command, providers);
    if (alias) {
      await this.enqueueProviderTask(event, command, alias.targetUrl);
      return;
    }

    await this.reply(event, t(s, 'line.cmd.unknown', {
      command: command.name,
      commands: this.commandList(),
    }));
  }

  private async enqueueProviderTask(
    event: LineTextEvent,
    command: LineCommand,
    targetUrl: string,
  ): Promise<void> {
    if (!command.argument) {
      await this.reply(event, t(this.deps.getStrings(), 'line.cmd.usage', { command: command.name }));
      return;
    }
    await this.enqueueTask(event, command.argument, targetUrl);
  }

  // The flow's own `bot` step delivers the result, so this only acknowledges the
  // request and reports the case where the flow never got that far.
  private async runFlowCommand(
    event: LineTextEvent,
    flow: LineFlowCommandDef,
    input: string,
  ): Promise<void> {
    const s = this.deps.getStrings();
    await this.reply(event, t(s, 'line.cmd.queued'));

    let taskId: string;
    let result: Promise<{ success: boolean }>;
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
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.flowFailed'), this.deps.onLog);
    }).catch(async (err: unknown) => {
      this.deps.onLog(`[line] flow command failed: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.flowFailed'), this.deps.onLog);
    });
  }

  private async handlePairCommand(event: LineTextEvent, code: string): Promise<void> {
    const s = this.deps.getStrings();
    const { userId } = event;
    // Paired users are checked first: they have nothing left to guess, so the
    // throttle must never lock them out of their own bot.
    if (this.deps.isPairedUser(userId)) {
      await this.reply(event, t(s, 'line.pair.alreadyPaired'));
      return;
    }
    if (this.pairAttempts.isBlocked(userId)) {
      this.deps.onLog(`[line] pairing throttled for ${userId}`);
      await this.reply(event, t(s, 'line.pair.tooManyAttempts'));
      return;
    }
    // The name has to be known when the paired-user record is written, and
    // getDisplayName resolves to undefined rather than throwing.
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
    // A freshly paired user has never seen the bot's usage notes, so the
    // confirmation carries them; /help repeats them on demand.
    await this.reply(event, `${t(s, 'line.pair.completed')}\n\n${this.usageText()}`);
  }

  // The acknowledgement goes out before the request is resolved: onTaskRequest
  // may fetch a linked page or a video transcript first, which can outlive the
  // reply token's ~30s life. Spending it here also keeps the ack free — a push
  // would bill the account's monthly quota for every message the bot receives.
  private async enqueueTask(event: LineTextEvent, text: string, targetUrl?: string): Promise<void> {
    const s = this.deps.getStrings();
    await this.reply(event, t(s, 'line.cmd.queued'));
    try {
      const { taskId } = await this.deps.onTaskRequest({
        userId: event.userId,
        chatId: event.chatId,
        text,
        targetUrl,
      });
      this.deps.onLog(`[${taskId}] LINE message queued from ${event.userId}`);
    } catch (err: unknown) {
      this.deps.onLog(`[line] failed to queue task: ${err instanceof Error ? err.message : String(err)}`);
      await safePush(this.deps.getClient(), event.chatId, t(s, 'line.cmd.queueFailed'), this.deps.onLog);
    }
  }

  // LINE has no '/' menu, so the help text is the only place a user can discover
  // commands — flow and BYOK commands included, or a new one would stay invisible.
  private commandList(): string {
    const flowCommands = (this.deps.getFlowCommands?.() ?? []).map((fc) => `/${fc.command}`);
    const byokCommands = (this.deps.getByokCommands?.() ?? []).map((bc) => `/${bc.command}`);
    return [listProviderCommands(this.deps.getProviderCommands()), ...flowCommands, ...byokCommands]
      .filter(Boolean)
      .join('  ');
  }

  // Two variants: with command-free chat on, plain text goes to the AI; with it
  // off, only commands work — the old single text promised the first behavior
  // unconditionally, which is no longer true.
  private usageText(): string {
    const key = this.deps.getLlmDirect().enabled ? 'line.help.usageDirect' : 'line.help.usageCommands';
    return t(this.deps.getStrings(), key, { commands: this.commandList() });
  }

  private reply(event: LineTextEvent, text: string): Promise<void> {
    return respond(this.deps.getClient(), event, text, this.deps.onLog);
  }
}

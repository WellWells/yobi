import type { SocketBotAccountInfo } from '../../shared/types';
import { readUploadFiles } from '../botChat/files';
import { t } from '../i18n';
import { botChatKey } from '../botBuiltinCommands';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { SocketBotRuntime, type SocketBotOutgoing, type SocketBotRuntimeDeps } from '../botChat/socketRuntime';
import type { BotChatOutput } from '../botChat/types';
import {
  CHOICE_BUTTON_PREFIX,
  LINE_BUTTON_PREFIX,
  buttonData,
  createBotButtonRegistry,
  parseButtonData,
  type ChoicePress,
} from '../botChat/buttons';
import { unfoldExpandableQuotes } from '../../shared/expandableQuote';
import { DiscordGateway, type GatewaySocketFactory } from './gateway';
import { DiscordApiError, createDiscordRest, type DiscordActionRow, type DiscordButton, type DiscordFile, type DiscordRest } from './rest';
import { buttonPressEvent, parseDiscordButtonPress, parseDiscordMessage, type DiscordButtonPress, type DiscordTextEvent } from './events';
import {
  DISCORD_FILES_MAX,
  DISCORD_FILE_MAX_BYTES,
  DISCORD_LABEL_MAX,
  DISCORD_MESSAGE_MAX,
  DISCORD_ROWS,
  DISCORD_ROW_BUTTONS,
  discordMessages,
} from './format';

/** View channels, send messages (and in threads), embed links, attach files, read history. */
const INVITE_PERMISSIONS = String((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n) | (1n << 38n));
const READY_TIMEOUT_MS = 20_000;

export function discordInviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
}

export interface DiscordRuntimeDeps extends SocketBotRuntimeDeps<DiscordTextEvent> {
  /** Tests hand in a fake gateway socket and a fake `fetch`. */
  socketFactory?: GatewaySocketFactory;
  createRest?: (token: string) => DiscordRest;
}

type ButtonSpec = NonNullable<SocketBotOutgoing['buttons']>[number];

function truncateLabel(label: string): string {
  const chars = [...label.trim()];
  return chars.length <= DISCORD_LABEL_MAX ? chars.join('') : `${chars.slice(0, DISCORD_LABEL_MAX - 1).join('')}…`;
}

/** Buttons in rows: a `rowStart` begins a new row, a full row wraps; whatever does not fit five rows is left off. */
export function discordButtonRows(buttons: ReadonlyArray<{ label: string; customId: string; rowStart?: boolean }>): DiscordActionRow[] {
  const rows: DiscordButton[][] = [];
  for (const button of buttons) {
    const last = rows[rows.length - 1];
    if (!last || button.rowStart || last.length >= DISCORD_ROW_BUTTONS) rows.push([]);
    rows[rows.length - 1]!.push({ type: 2, style: 2, label: truncateLabel(button.label), custom_id: button.customId });
  }
  return rows.slice(0, DISCORD_ROWS).map((components) => ({ type: 1, components }));
}

/**
 * The Discord bot: the gateway for messages and button presses, the HTTP API for everything it
 * sends. A DM is filed under the person's id and answered in its DM channel; a server channel is a
 * group, answered there with the asking message quoted.
 */
export class DiscordRuntime extends SocketBotRuntime<DiscordTextEvent> {
  private rest: DiscordRest | null = null;
  private gateway: DiscordGateway | null = null;
  private botId = '';
  private readonly buttons = createBotButtonRegistry();
  private readonly groupNames = new Map<string, string>();

  constructor(private readonly discordDeps: DiscordRuntimeDeps) {
    super('discord', discordDeps);
  }

  protected output(): BotChatOutput<DiscordTextEvent> {
    return {
      reply: (event, text) => this.post(event.channelId, { text, ...(event.messageId ? { replyTo: event.messageId } : {}) }),
      push: (event, text) => this.post(event.channelId, { text, ...(event.messageId ? { replyTo: event.messageId } : {}) }),
      pushResult: (event, result) => this.pushResult(event, result),
      displayName: async (event) => event.displayName,
      groupName: (chatId) => this.groupName(chatId),
      replyRef: (event) => event.messageId,
    };
  }

  protected async connect(secrets: Record<string, string>): Promise<SocketBotAccountInfo> {
    const token = secrets.botToken ?? '';
    const rest = (this.discordDeps.createRest ?? createDiscordRest)(token);
    let me;
    try {
      me = await rest.getMe();
    } catch (err: unknown) {
      if (err instanceof DiscordApiError && err.status === 401) throw new Error(t(this.deps.getStrings(), 'bot.discord.tokenInvalid'));
      throw err;
    }
    this.rest = rest;
    this.botId = me.id;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t(this.deps.getStrings(), 'bot.socket.connectTimeout'))), READY_TIMEOUT_MS);
      const gateway = new DiscordGateway({
        token,
        onLog: this.deps.onLog,
        ...(this.discordDeps.socketFactory ? { socketFactory: this.discordDeps.socketFactory } : {}),
        onConnected: () => {
          clearTimeout(timer);
          resolve();
        },
        onFatal: (code) => {
          clearTimeout(timer);
          const message = t(this.deps.getStrings(), code === 4004 ? 'bot.discord.tokenInvalid' : 'bot.discord.gatewayRefused', { code: String(code) });
          if (this.gateway === gateway) this.fail(message);
          reject(new Error(message));
        },
        onDispatch: (type, data) => this.onDispatch(type, data),
      });
      this.gateway = gateway;
      gateway.start();
    });
    return { id: me.id, name: me.global_name || me.username, inviteUrl: discordInviteUrl(me.id) };
  }

  protected async disconnect(): Promise<void> {
    this.gateway?.stop();
    this.gateway = null;
    this.rest = null;
    this.botId = '';
    this.buttons.clear();
    this.groupNames.clear();
  }

  private onDispatch(type: string, data: unknown): void {
    if (type === 'MESSAGE_CREATE') this.onMessage(data);
    else if (type === 'INTERACTION_CREATE') void this.onInteraction(data);
  }

  private onMessage(data: unknown): void {
    const event = parseDiscordMessage(data, this.botId);
    if (!event) return;
    if (!event.text) {
      // A file alone: the bot cannot read it, and says so only to a paired person in their DM.
      if (event.hasAttachments && event.chatKind === 'user' && this.deps.isPairedUser(event.userId)) {
        void this.post(event.channelId, { text: t(this.deps.getStrings(), 'bot.socket.attachmentsUnsupported'), ...(event.messageId ? { replyTo: event.messageId } : {}) });
      }
      if (event.chatKind === 'user' || !event.mentionsBot) return;
    }
    this.dispatch(event);
  }

  private async onInteraction(data: unknown): Promise<void> {
    const press = parseDiscordButtonPress(data);
    const rest = this.rest;
    if (!press || !rest) return;
    const parsed = parseButtonData(press.customId);
    const blocked = Boolean(this.deps.isBlocked?.(press.userId));
    const choice = parsed && !blocked && parsed.prefix === CHOICE_BUTTON_PREFIX && parsed.index !== undefined
      ? this.choiceOutcome(press, parsed.token, parsed.index)
      : null;
    // Answered at once, or Discord shows the press as failed after three seconds. Someone else's
    // question is said so only to the presser: in a channel anyone can press the asker's buttons.
    const response = choice?.outcome.kind === 'notYours'
      ? { type: 4 as const, data: { content: t(this.deps.getStrings(), 'bot.socket.questionGone'), flags: 64 as const } }
      : { type: 6 as const };
    await rest.answerInteraction(press.interactionId, press.interactionToken, response).catch((err: unknown) => {
      this.deps.onLog(`[discord] could not acknowledge a button press: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!parsed || blocked) return;
    if (parsed.prefix === LINE_BUTTON_PREFIX) {
      const line = this.buttons.lineOf(parsed.token);
      if (!line) {
        await this.post(press.channelId, { text: t(this.deps.getStrings(), 'bot.socket.buttonExpired') });
        return;
      }
      await this.dispatchButtonLine(buttonPressEvent(press, line));
      return;
    }
    if (choice) await this.pressChoice(press, choice);
  }

  private choiceOutcome(press: DiscordButtonPress, token: string, index: number): { event: DiscordTextEvent; outcome: ChoicePress } {
    const event = buttonPressEvent(press, '');
    const pending = this.deps.pendingAgentAskRunId?.(event.chatId, event.userId) ?? null;
    return { event, outcome: this.buttons.pressChoice(token, index, botChatKey('discord', event.chatId, event.userId), pending) };
  }

  /**
   * A question's choice: the answer it stands for, typed by the person asked. Anyone else's press
   * leaves the question and its buttons as they are (the presser was told when it was
   * acknowledged); a stale one takes the buttons off.
   */
  private async pressChoice(press: DiscordButtonPress, { event, outcome }: { event: DiscordTextEvent; outcome: ChoicePress }): Promise<void> {
    if (outcome.kind === 'notYours') return;
    const s = this.deps.getStrings();
    if (outcome.kind === 'stale') {
      if (press.messageId) await this.rest?.editMessage(press.channelId, press.messageId, { components: [] }).catch(() => undefined);
      await this.post(press.channelId, { text: t(s, 'bot.socket.questionGone') });
      return;
    }
    if (press.messageId) {
      const chosen = discordButtonRows([{ label: t(s, 'bot.socket.chosen', { choice: outcome.text }), customId: 'done:chosen' }]);
      chosen[0]!.components[0]!.disabled = true;
      await this.rest?.editMessage(press.channelId, press.messageId, { components: chosen }).catch(() => undefined);
    }
    this.dispatch({ ...event, text: outcome.text });
  }

  private async pushResult(event: DiscordTextEvent, result: BotBuiltinRunResult): Promise<boolean> {
    const s = this.deps.getStrings();
    const replyTo = event.messageId ? { replyTo: event.messageId } : {};
    const question = result.ok ? result.question : undefined;
    if (result.ok && result.verbatim) {
      // Never clipped: an approval the user cannot read whole is not sent at all.
      const text = unfoldExpandableQuotes(question?.text ?? result.text);
      if (text.length > DISCORD_MESSAGE_MAX) return false;
      await this.sendQuestion(event, text, question?.runId, question?.choices ?? [], replyTo);
      return true;
    }
    if (question && question.choices.length > 0) {
      const [text = ''] = discordMessages(question.text);
      await this.sendQuestion(event, text, question.runId, question.choices, replyTo);
      return true;
    }
    if (!result.ok) {
      await this.post(event.channelId, { text: `${t(s, 'bot.chat.runFailed', { provider: result.providerLabel })}\n${result.text}`, ...replyTo });
      return true;
    }
    await this.post(event.channelId, {
      text: result.text.trim() ? result.text : t(s, 'bot.chat.emptyResponse'),
      ...(result.files?.length ? { files: result.files } : {}),
      ...replyTo,
    }, { markdown: true });
    return true;
  }

  /** One message with a button per choice; the choices carry no numbers, so a typed "1" picks none of them. */
  private async sendQuestion(event: DiscordTextEvent, text: string, runId: string | undefined, choices: readonly string[], replyTo: { replyTo?: string }): Promise<void> {
    const rest = this.rest;
    if (!rest) return;
    const usable = runId ? choices.slice(0, DISCORD_ROWS * DISCORD_ROW_BUTTONS) : [];
    const token = runId && usable.length > 0 ? this.buttons.registerChoices(botChatKey('discord', event.chatId, event.userId), runId, usable) : '';
    const components = token
      ? discordButtonRows(usable.map((choice, index) => ({ label: choice, customId: buttonData(CHOICE_BUTTON_PREFIX, token, index) })))
      : [];
    await rest.sendMessage(event.channelId, {
      content: text,
      ...(components.length ? { components } : {}),
      ...(replyTo.replyTo ? { message_reference: { message_id: replyTo.replyTo, fail_if_not_exists: false } } : {}),
    });
    if (token) this.deps.onAgentAskShown?.(event.chatId, event.userId, { numbered: false });
  }

  /** A server channel's name as people see it: `Server #channel`. */
  private async groupName(channelId: string): Promise<string | undefined> {
    const known = this.groupNames.get(channelId);
    if (known) return known;
    const rest = this.rest;
    if (!rest) return undefined;
    const channel = await rest.getChannel(channelId);
    const server = channel.guild_id ? await rest.getGuildName(channel.guild_id).catch(() => '') : '';
    const name = [server, channel.name ? `#${channel.name}` : ''].filter(Boolean).join(' ');
    if (name) this.groupNames.set(channelId, name);
    return name || undefined;
  }

  async sendToChat(chatId: string, message: SocketBotOutgoing): Promise<void> {
    const rest = this.rest;
    if (!rest) throw new Error('Discord bot is not running');
    // A paired person's id is their DM; anything else is a channel the bot was given.
    const channelId = this.deps.isPairedUser(chatId) ? await rest.openDm(chatId) : chatId;
    await this.post(channelId, message, { markdown: true });
  }

  /**
   * Sends text (split to Discord's limit), then files and buttons with the last piece; the first
   * piece quotes `replyTo`. `markdown` renders the model's Markdown; without it the text is the
   * app's own line, sent as written.
   */
  private async post(channelId: string, message: SocketBotOutgoing, options: { markdown?: boolean } = {}): Promise<void> {
    const rest = this.rest;
    if (!rest) {
      this.deps.onLog('[discord] send skipped — not connected');
      return;
    }
    const pieces = options.markdown ? discordMessages(message.text) : [message.text.slice(0, DISCORD_MESSAGE_MAX)];
    const files = await this.readFiles(message.files ?? []);
    const components = this.lineButtons(message.buttons ?? []);
    for (const [index, content] of (pieces.length > 0 ? pieces : ['']).entries()) {
      const last = index === pieces.length - 1 || pieces.length === 0;
      const payload = {
        ...(content ? { content } : {}),
        ...(index === 0 && message.replyTo ? { message_reference: { message_id: message.replyTo, fail_if_not_exists: false as const } } : {}),
        ...(last && components.length ? { components } : {}),
      };
      if (last && files.length > 0) await rest.sendFiles(channelId, payload, files);
      else if (content || payload.components) await rest.sendMessage(channelId, payload);
    }
  }

  private lineButtons(buttons: readonly ButtonSpec[]): DiscordActionRow[] {
    return discordButtonRows(buttons.map((button) => ({
      label: button.label,
      customId: buttonData(LINE_BUTTON_PREFIX, this.buttons.registerLine(button.line)),
      ...(button.rowStart ? { rowStart: true } : {}),
    })));
  }

  /** The files Discord can take (ten, each within the upload limit); the rest are logged and left out. */
  private readFiles(paths: readonly string[]): Promise<DiscordFile[]> {
    return readUploadFiles(paths, { max: DISCORD_FILES_MAX, maxBytes: DISCORD_FILE_MAX_BYTES }, this.deps.onLog, '[discord]');
  }
}

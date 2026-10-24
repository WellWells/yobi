import type { SocketBotAccountInfo } from '../../shared/types';
import { t } from '../i18n';
import { botChatKey } from '../botBuiltinCommands';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { SocketBotRuntime, type SocketBotOutgoing, type SocketBotRuntimeDeps } from '../botChat/socketRuntime';
import type { BotChatOutput } from '../botChat/types';
import { readUploadFiles } from '../botChat/files';
import type { BotWebSocketFactory } from '../botChat/webSocket';
import {
  CHOICE_BUTTON_PREFIX,
  LINE_BUTTON_PREFIX,
  buttonData,
  createBotButtonRegistry,
  parseButtonData,
} from '../botChat/buttons';
import { unfoldExpandableQuotes } from '../../shared/expandableQuote';
import { SLACK_AUTH_ERRORS, SlackApiError, createSlackApi, type SlackApi, type SlackBlock, type SlackButton } from './api';
import { SlackSocketMode } from './socketMode';
import {
  isSlackDm,
  parseSlackButtonPress,
  parseSlackEvent,
  slackPressEvent,
  type SlackButtonPress,
  type SlackTextEvent,
} from './events';
import {
  SLACK_BUTTONS_MAX,
  SLACK_FILES_MAX,
  SLACK_FILE_MAX_BYTES,
  SLACK_LABEL_MAX,
  SLACK_MESSAGE_MAX,
  slackMessages,
} from './format';

const READY_TIMEOUT_MS = 20_000;

export interface SlackRuntimeDeps extends SocketBotRuntimeDeps<SlackTextEvent> {
  /** Tests hand in a fake socket and API. */
  socketFactory?: BotWebSocketFactory;
  createApi?: (botToken: string, appToken: string) => SlackApi;
}

type ButtonSpec = NonNullable<SocketBotOutgoing['buttons']>[number];

function truncateLabel(label: string): string {
  const chars = [...label.trim()];
  return chars.length <= SLACK_LABEL_MAX ? chars.join('') : `${chars.slice(0, SLACK_LABEL_MAX - 1).join('')}…`;
}

function slackButton(label: string, actionId: string): SlackButton {
  return { type: 'button', text: { type: 'plain_text', text: truncateLabel(label), emoji: true }, action_id: actionId, value: actionId };
}

/** Text then buttons, as blocks: the plain `text` stays as the notification's words. */
function withButtons(text: string, buttons: readonly SlackButton[]): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  if (text) blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons.slice(0, SLACK_BUTTONS_MAX) });
  return blocks;
}

/**
 * The Slack bot: Socket Mode for events and button presses, the Web API for everything it sends.
 * A DM is filed under the person's id and answered in it; a channel mention is a group's message,
 * answered in its thread.
 */
export class SlackRuntime extends SocketBotRuntime<SlackTextEvent> {
  private api: SlackApi | null = null;
  private socket: SlackSocketMode | null = null;
  private botUserId = '';
  private readonly buttons = createBotButtonRegistry();
  private readonly channelNames = new Map<string, string>();

  constructor(private readonly slackDeps: SlackRuntimeDeps) {
    super('slack', slackDeps);
  }

  protected output(): BotChatOutput<SlackTextEvent> {
    return {
      reply: (event, text) => this.post(event.channel, { text }, { threadTs: event.threadTs }),
      push: (event, text) => this.post(event.channel, { text }, { threadTs: event.threadTs }),
      pushResult: (event, result) => this.pushResult(event, result),
      displayName: async (event) => this.api?.userName(event.userId).catch(() => undefined),
      groupName: (chatId) => this.channelName(chatId),
      replyRef: (event) => event.threadTs,
    };
  }

  protected async connect(secrets: Record<string, string>): Promise<SocketBotAccountInfo> {
    const s = this.deps.getStrings();
    const api = (this.slackDeps.createApi ?? createSlackApi)(secrets.botToken ?? '', secrets.appToken ?? '');
    let me;
    try {
      me = await api.authTest();
    } catch (err: unknown) {
      if (err instanceof SlackApiError && SLACK_AUTH_ERRORS.has(err.code)) throw new Error(t(s, 'bot.slack.tokenInvalid'));
      throw err;
    }
    this.api = api;
    this.botUserId = me.userId;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t(s, 'bot.socket.connectTimeout'))), READY_TIMEOUT_MS);
      const socket = new SlackSocketMode({
        openUrl: () => api.openConnection(),
        isFatal: (err) => err instanceof SlackApiError && SLACK_AUTH_ERRORS.has(err.code),
        onConnected: () => {
          clearTimeout(timer);
          resolve();
        },
        onFatal: () => {
          clearTimeout(timer);
          const message = t(s, 'bot.slack.appTokenInvalid');
          if (this.socket === socket) this.fail(message);
          reject(new Error(message));
        },
        onEnvelope: (envelope) => {
          if (envelope.type === 'events_api') this.onEvent(envelope.payload, envelope.retried);
          else if (envelope.type === 'interactive') void this.onInteraction(envelope.payload);
        },
        onLog: this.deps.onLog,
        ...(this.slackDeps.socketFactory ? { socketFactory: this.slackDeps.socketFactory } : {}),
      });
      this.socket = socket;
      socket.start();
    });
    return { id: me.userId, name: me.botName, ...(me.team ? { workspace: me.team } : {}) };
  }

  protected async disconnect(): Promise<void> {
    this.socket?.stop();
    this.socket = null;
    this.api = null;
    this.botUserId = '';
    this.buttons.clear();
    this.channelNames.clear();
  }

  private onEvent(payload: unknown, retried: boolean): void {
    const event = parseSlackEvent((payload as { event?: unknown } | undefined)?.event, this.botUserId, retried);
    if (!event) return;
    if (!event.text) {
      if (event.hasFiles && event.chatKind === 'user' && this.deps.isPairedUser(event.userId)) {
        void this.post(event.channel, { text: t(this.deps.getStrings(), 'bot.socket.attachmentsUnsupported') });
      }
      if (event.chatKind === 'user') return;
    }
    this.dispatch(event);
  }

  private async onInteraction(payload: unknown): Promise<void> {
    const press = parseSlackButtonPress(payload);
    if (!press || this.deps.isBlocked?.(press.userId)) return;
    const parsed = parseButtonData(press.actionId);
    if (!parsed) return;
    if (parsed.prefix === LINE_BUTTON_PREFIX) {
      const line = this.buttons.lineOf(parsed.token);
      if (!line) {
        await this.post(press.channel, { text: t(this.deps.getStrings(), 'bot.socket.buttonExpired') }, { threadTs: press.threadTs });
        return;
      }
      await this.dispatchButtonLine(slackPressEvent(press, line));
      return;
    }
    if (parsed.prefix === CHOICE_BUTTON_PREFIX && parsed.index !== undefined) await this.pressChoice(press, parsed.token, parsed.index);
  }

  /** A question's choice: the answer it stands for, typed by the person asked; anyone else's press, or a stale one, does nothing. */
  private async pressChoice(press: SlackButtonPress, token: string, index: number): Promise<void> {
    const event = slackPressEvent(press, '');
    const pending = this.deps.pendingAgentAskRunId?.(event.chatId, event.userId) ?? null;
    const outcome = this.buttons.pressChoice(token, index, botChatKey('slack', event.chatId, event.userId), pending);
    const s = this.deps.getStrings();
    if (outcome.kind !== 'answer') {
      await this.post(press.channel, { text: t(s, 'bot.socket.questionGone') }, { threadTs: event.threadTs });
      return;
    }
    if (press.messageTs) {
      const chosen = t(s, 'bot.socket.chosen', { choice: outcome.text });
      await this.api?.updateMessage(press.channel, press.messageTs, chosen, [{ type: 'context', elements: [{ type: 'mrkdwn', text: chosen }] }])
        .catch(() => undefined);
    }
    this.dispatch({ ...event, text: outcome.text });
  }

  private async pushResult(event: SlackTextEvent, result: BotBuiltinRunResult): Promise<boolean> {
    const s = this.deps.getStrings();
    const question = result.ok ? result.question : undefined;
    if (result.ok && result.verbatim) {
      // Never clipped: an approval the user cannot read whole is not sent at all.
      const text = unfoldExpandableQuotes(question?.text ?? result.text);
      if (text.length > SLACK_MESSAGE_MAX) return false;
      await this.sendQuestion(event, text, question?.runId, question?.choices ?? []);
      return true;
    }
    if (question && question.choices.length > 0) {
      const [text = ''] = slackMessages(question.text);
      await this.sendQuestion(event, text, question.runId, question.choices);
      return true;
    }
    if (!result.ok) {
      await this.post(event.channel, { text: `${t(s, 'bot.chat.runFailed', { provider: result.providerLabel })}\n${result.text}` }, { threadTs: event.threadTs });
      return true;
    }
    await this.post(event.channel, {
      text: result.text.trim() ? result.text : t(s, 'bot.chat.emptyResponse'),
      ...(result.files?.length ? { files: result.files } : {}),
    }, { markdown: true, threadTs: event.threadTs });
    return true;
  }

  /** One message with a button per choice; the choices carry no numbers, so a typed "1" picks none of them. */
  private async sendQuestion(event: SlackTextEvent, text: string, runId: string | undefined, choices: readonly string[]): Promise<void> {
    const api = this.api;
    if (!api) return;
    const usable = runId ? choices.slice(0, SLACK_BUTTONS_MAX) : [];
    const token = runId && usable.length > 0 ? this.buttons.registerChoices(botChatKey('slack', event.chatId, event.userId), runId, usable) : '';
    const buttons = token ? usable.map((choice, index) => slackButton(choice, buttonData(CHOICE_BUTTON_PREFIX, token, index))) : [];
    await api.postMessage({
      channel: event.channel,
      text,
      ...(buttons.length > 0 ? { blocks: withButtons(text, buttons) } : {}),
      ...(event.threadTs ? { thread_ts: event.threadTs } : {}),
    });
    if (token) this.deps.onAgentAskShown?.(event.chatId, event.userId, { numbered: false });
  }

  private async channelName(channelId: string): Promise<string | undefined> {
    const known = this.channelNames.get(channelId);
    if (known) return known;
    const name = await this.api?.channelName(channelId);
    if (!name) return undefined;
    const shown = `#${name}`;
    this.channelNames.set(channelId, shown);
    return shown;
  }

  async sendToChat(chatId: string, message: SocketBotOutgoing): Promise<void> {
    const api = this.api;
    if (!api) throw new Error('Slack bot is not running');
    // A paired person's id is their DM (opened on first use); anything else is a channel the app was added to.
    const channel = this.deps.isPairedUser(chatId) ? await api.openDm(chatId) : chatId;
    await this.post(channel, message, { markdown: true, ...(message.replyTo && !isSlackDm(channel) ? { threadTs: message.replyTo } : {}) });
  }

  /**
   * Sends text (split under Slack's block limit), then files, with buttons on the last text piece;
   * in a channel everything goes into `threadTs`. `markdown` renders the model's Markdown as
   * mrkdwn; without it the text is the app's own line, sent as written.
   */
  private async post(channel: string, message: SocketBotOutgoing, options: { markdown?: boolean; threadTs?: string | undefined } = {}): Promise<void> {
    const api = this.api;
    if (!api) {
      this.deps.onLog('[slack] send skipped — not connected');
      return;
    }
    const pieces = options.markdown ? slackMessages(message.text) : [message.text.slice(0, SLACK_MESSAGE_MAX)];
    const buttons = this.lineButtons(message.buttons ?? []);
    const thread = options.threadTs ? { thread_ts: options.threadTs } : {};
    for (const [index, text] of pieces.entries()) {
      const last = index === pieces.length - 1;
      await api.postMessage({
        channel,
        text,
        ...(last && buttons.length > 0 ? { blocks: withButtons(text, buttons) } : {}),
        ...thread,
      });
    }
    if (pieces.length === 0 && buttons.length > 0) await api.postMessage({ channel, text: ' ', blocks: withButtons('', buttons), ...thread });
    const files = await readUploadFiles(message.files ?? [], { max: SLACK_FILES_MAX, maxBytes: SLACK_FILE_MAX_BYTES }, this.deps.onLog, '[slack]');
    for (const file of files) {
      await api.uploadFile(channel, file, undefined, options.threadTs).catch((err: unknown) => {
        this.deps.onLog(`[slack] could not upload ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private lineButtons(buttons: readonly ButtonSpec[]): SlackButton[] {
    return buttons.map((button) => slackButton(button.label, buttonData(LINE_BUTTON_PREFIX, this.buttons.registerLine(button.line))));
  }
}

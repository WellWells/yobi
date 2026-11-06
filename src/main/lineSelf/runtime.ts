import type { SocketBotAccountInfo } from '../../shared/types';
import { t } from '../i18n';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { FlowUserError } from '../flow/userError';
import { SocketBotRuntime, type SocketBotOutgoing, type SocketBotRuntimeDeps } from '../botChat/socketRuntime';
import type { BotChatEvent, BotChatOutput } from '../botChat/types';
import { formatLineReply, formatLineText, verbatimLineText } from '../line/format';
import type { SendFilesRequest, SendRequest } from '../line/lineService';
import type { SendFilesPlan } from '../line/lineSendFiles';
import type { SendPlan } from '../line/lineSendText';
import type { WatchedMessage } from '../line/ownMessages';
import type { LineReader } from '../line/reader';
import { isLineDirectChat, isLineGroupChat } from './chats';
import { createLineSelfSender, type LineSelfFileOptions, type LineSelfQuote, type LineSelfSender, type LineSelfSenderDeps } from './sender';
import { addressedText, groupRequest, isYobiReply, menuPick, numberedMenu, withReplyPrefix } from './text';
import { LineSelfWatcher, type LineSelfStore, type LineSelfWatcherDeps } from './watcher';

/** A line addressed to the bot in a chat; the user's one-person group carries their id as `chatId`. */
export interface LineSelfTextEvent extends BotChatEvent {
  /** The LINE chat it was typed in, where the answer goes. */
  lineChatId: string;
  messageId: string;
}

/** What the bot needs of LINE PC: the reader for names and members, fresh reads, and sending. */
export interface LineSelfService {
  getReader: () => Promise<LineReader>;
  openFresh: LineSelfStore['openFresh'];
  databasePath: () => string | null;
  send: (req: SendRequest) => Promise<SendPlan>;
  sendFiles: (req: SendFilesRequest) => Promise<SendFilesPlan>;
}

export interface LineSelfRuntimeDeps extends SocketBotRuntimeDeps<LineSelfTextEvent> {
  /** The LINE connector's switch (Settings › Connectors): the bot reads through it. */
  readerEnabled: () => boolean;
  /**
   * The app's one LineService, asked for each time: turning the connector off replaces it, and it
   * loads the native database driver, so the setup imports it lazily.
   */
  service: () => Promise<LineSelfService>;
  scanTokens: () => Promise<string[]>;
  /** Why the native core cannot be used, as a LineError code; '' when it can. */
  coreProblem: () => Promise<string>;
  /**
   * The account is the user's own: paired as them, with every right, the first time the bot
   * connects with it — there is no code to send. An account already paired keeps what the user made of it.
   */
  ensureOwner: (owner: { userId: string; displayName?: string }) => Promise<void>;
  /** The groups Yobi has been used in, kept across runs: where a flow's message may go. */
  knownChats: () => Promise<readonly string[]>;
  /**
   * A flow's picture on the web (a video menu's cover) as a photo file LINE can send, or "" — its
   * link then goes in the text. Without it every picture goes as its link.
   */
  pictureFile?: (url: string) => Promise<string>;
  /** A file on this computer as the photo LINE sends (a WebP made a JPEG); without it a WebP goes as a file. */
  photoFile?: (file: string) => Promise<string>;
  platformSupported?: () => boolean;
  watcher?: Partial<Pick<LineSelfWatcherDeps, 'statMs' | 'now' | 'intervalMs'>>;
  sender?: Partial<Pick<LineSelfSenderDeps, 'gapMs' | 'sleep' | 'now'>>;
}

/** How long a chat's member list is trusted before it is read again (someone may have joined). */
const AUDIENCE_TTL_MS = 60_000;
/** How long a flow's numbered menu can still be picked from by typing its number. */
const MENU_TTL_MS = 30 * 60_000;

/**
 * The LINE PC bot: no server and no public address. It watches LINE PC's own database and answers
 * as the user through LINE PC's session, each answer marked so it is never read back as a request.
 * Nothing to bind: the account pairs itself as the user's when it connects, and a line starting
 * with "Yobi" is a request in any group, and from the user in any 1:1 chat. In a group someone
 * else may ask too, on their own rights; with none, their "Yobi" asks the owner to let them in.
 * A group with nobody but the user is their private chat (owner rights, memory), where the answer
 * to Yobi's question or a flow menu's number needs no "Yobi".
 */
export class LineSelfRuntime extends SocketBotRuntime<LineSelfTextEvent> {
  private watcher: LineSelfWatcher | null = null;
  private sender: LineSelfSender | null = null;
  private ownMid = '';
  private ownName = '';
  private readonly audience = new Map<string, { solo: boolean; at: number }>();
  private readonly menus = new Map<string, { lines: string[]; at: number }>();
  /** The group each other person last addressed Yobi in: where `sendToChat(theirId)` reaches them. */
  private readonly askedIn = new Map<string, string>();
  /**
   * The 1:1 chats the user asked Yobi in this run. Such a chat's id is the other person's own: a
   * flow started there answers there, not in a group that person last asked in.
   */
  private readonly directChats = new Set<string>();
  /** The user's own group they last asked in, and the ones registered for flows this run. */
  private homeChat = '';
  private readonly homes = new Set<string>();

  constructor(private readonly selfDeps: LineSelfRuntimeDeps) {
    // Only the user has a private chat here: everyone else's command, and the user's own outside
    // their one-person group, is typed in a group or a 1:1 chat.
    super('lineSelf', { ...selfDeps, groupPairingRequests: true, groupCommands: true });
  }

  /**
   * Every answer quotes the line that asked (LINE's Reply): in a
   * busy group it says which request it answers. A flow's result does too (`replyRef` → the bot
   * step's `replyTo`).
   */
  protected output(): BotChatOutput<LineSelfTextEvent> {
    return {
      reply: (event, text) => this.post(event.lineChatId, text, { replyTo: event.messageId }),
      push: (event, text) => this.post(event.lineChatId, text, { replyTo: event.messageId }),
      // Every line sent here is the user's own message, read by everyone in the chat.
      quietStart: true,
      pushResult: (event, result) => this.pushResult(event, result),
      displayName: (event) => this.nameOf(event.userId),
      groupName: (chatId) => this.chatName(chatId),
      replyRef: (event) => event.messageId,
    };
  }

  protected async connect(): Promise<SocketBotAccountInfo> {
    const s = this.deps.getStrings();
    if (!(this.selfDeps.platformSupported ?? (() => process.platform === 'win32'))()) throw new Error(t(s, 'bot.lineSelf.windowsOnly'));
    if (!this.selfDeps.readerEnabled()) throw new Error(t(s, 'bot.lineSelf.readerOff'));
    if (await this.selfDeps.coreProblem()) throw new Error(t(s, 'bot.lineSelf.coreMissing'));
    let reader: LineReader;
    try {
      reader = await (await this.selfDeps.service()).getReader();
      this.ownMid = reader.myMid();
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] could not open LINE's database: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error(t(s, 'bot.lineSelf.cannotRead'));
    }
    const name = reader.displayNameOf(this.ownMid);
    this.ownName = name === this.ownMid ? '' : name;
    await this.selfDeps.ensureOwner({ userId: this.ownMid, ...(this.ownName ? { displayName: this.ownName } : {}) }).catch((err: unknown) => {
      this.deps.onLog(`[lineSelf] could not pair the account as yours: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.sender = createLineSelfSender({
      send: async (req) => (await this.selfDeps.service()).send(req),
      sendFiles: async (req) => (await this.selfDeps.service()).sendFiles(req),
      scanTokens: this.selfDeps.scanTokens,
      ...(this.selfDeps.photoFile ? { photoFile: this.selfDeps.photoFile } : {}),
      onLog: this.deps.onLog,
      ...this.selfDeps.sender,
    });
    const watcher = new LineSelfWatcher({
      store: {
        openFresh: async () => {
          if (!this.selfDeps.readerEnabled()) throw new Error('the LINE connector is off');
          return (await this.selfDeps.service()).openFresh();
        },
        databasePath: async () => (await this.selfDeps.service()).databasePath(),
      },
      ownMid: this.ownMid,
      onMessages: (rows) => this.onRows(rows),
      onLog: this.deps.onLog,
      ...this.selfDeps.watcher,
    });
    await watcher.start();
    this.watcher = watcher;
    return { id: this.ownMid, name: this.ownName || 'LINE' };
  }

  protected async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    this.sender?.reset();
    this.sender = null;
    this.audience.clear();
    this.menus.clear();
    this.homes.clear();
  }

  /** The watcher's look, for tests: reads what LINE stored since the last one. */
  async poll(): Promise<void> {
    await this.watcher?.tick(true);
  }

  private async onRows(rows: WatchedMessage[]): Promise<void> {
    for (const row of rows) {
      try {
        await this.onRow(row);
      } catch (err: unknown) {
        this.deps.onLog(`[lineSelf] message ${row.message.id ?? ''} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async onRow({ chatId, createdMs, message, mentions }: WatchedMessage): Promise<void> {
    const text = message.content ?? '';
    const id = message.id ?? '';
    const fromMe = message.from_me === true;
    const speaker = fromMe ? this.ownMid : message.sender_id ?? '';
    if (!id || !speaker || isYobiReply(text) || this.sender?.sentByBot(id)) return;
    // The bot speaks as the user only while their account is paired (it pairs itself when it
    // connects; unpaired in settings, nothing is read).
    if (!this.deps.isPairedUser(this.ownMid)) return;
    const group = isLineGroupChat(chatId);
    // A line from someone else proves the chat is not the user's alone, whatever was read before.
    if (group && !fromMe) this.audience.set(chatId, { solo: false, at: Date.now() });
    if (message.type !== 'text' || message.undecryptable) return;
    const request = this.requestIn(chatId, fromMe, speaker, text, mentions) ?? (await this.ownReply(chatId, fromMe, text));
    if (!request) return;
    const solo = group && fromMe && (await this.isSolo(chatId));
    if (solo) await this.rememberHome(chatId);
    else if (group && !fromMe) this.askedIn.set(speaker, chatId);
    else if (isLineDirectChat(chatId)) this.directChats.add(chatId);
    const event: LineSelfTextEvent = {
      userId: speaker,
      chatId: solo ? this.ownMid : chatId,
      chatKind: solo ? 'user' : 'group',
      text: request,
      mentionsBot: true,
      sentAt: createdMs,
      lineChatId: chatId,
      messageId: id,
    };
    const line = this.menuLine(chatId, request);
    if (line && !this.deps.hasPendingAgentAsk(event.chatId, event.userId)) {
      await this.dispatchButtonLine({ ...event, text: line });
      return;
    }
    // Someone else in a group runs on their own rights; with none, the router makes it a request
    // to the owner (`groupPairingRequests`), said in the group once.
    this.dispatch(event);
  }

  /**
   * What a line asks Yobi, or null when it is not addressed to Yobi.
   * - A 1:1 chat: only the user's own "Yobi" line, answered there for whoever reads it (no memory:
   *   the other person sees the answer). The other side is never read, and Keep (the user's own
   *   id) holds personal notes and is never used.
   * - A group: anyone's "Yobi" line, or one @-mentioning the user from someone already let in. An
   *   @-mention from anyone else is people talking to the user — counted, it would ask the owner
   *   to let in half of every work group.
   * Other chats (open chats, multi-person rooms) are not the bot's.
   */
  private requestIn(chatId: string, fromMe: boolean, speaker: string, text: string, mentions: WatchedMessage['mentions']): string | null {
    if (isLineDirectChat(chatId)) return fromMe && chatId !== this.ownMid ? addressedText(text) : null;
    if (!isLineGroupChat(chatId)) return null;
    return groupRequest(text, this.deps.isPairedUser(speaker) ? mentions : [], this.ownMid);
  }

  /**
   * In the user's own group (nobody else in it), a reply needs no "Yobi": the answer to the question
   * Yobi asked there, or a number from a flow's menu. Anything else there is the user's own note.
   */
  private async ownReply(chatId: string, fromMe: boolean, text: string): Promise<string | null> {
    const line = text.trim();
    if (!fromMe || !line || !isLineGroupChat(chatId)) return null;
    const awaited = this.menus.has(chatId) || this.deps.hasPendingAgentAsk(this.ownMid, this.ownMid);
    return awaited && (await this.isSolo(chatId)) ? line : null;
  }

  /** The user's own group: where a flow's message to them goes, kept in the directory once per run. */
  private async rememberHome(chatId: string): Promise<void> {
    this.homeChat = chatId;
    if (this.homes.has(chatId)) return;
    this.homes.add(chatId);
    const title = await this.chatName(chatId).catch(() => undefined);
    this.deps.onGroupSeen?.({ chatId, chatKind: 'group', ...(title ? { title } : {}) });
  }

  /** A typed number picks a line of the last numbered menu a flow sent here. */
  private menuLine(chatId: string, text: string): string | null {
    const menu = this.menus.get(chatId);
    if (!menu) return null;
    if (Date.now() - menu.at > MENU_TTL_MS) {
      this.menus.delete(chatId);
      return null;
    }
    return menuPick(text, menu.lines);
  }

  /**
   * Whether the user is the only one in this chat (everyone joined or invited is them). Unknown
   * counts as other people: a private chat's rights must never reach a chat someone else reads.
   */
  private async isSolo(chatId: string): Promise<boolean> {
    const known = this.audience.get(chatId);
    if (known && Date.now() - known.at < AUDIENCE_TTL_MS) return known.solo;
    let solo = false;
    try {
      const { reader, close } = await (await this.selfDeps.service()).openFresh();
      try {
        const list = reader.members(chatId);
        solo = !list.note && list.members.length > 0 && list.members.every((member) => member.is_me === true);
      } finally {
        close();
      }
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] could not read who is in ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.audience.set(chatId, { solo, at: Date.now() });
    return solo;
  }

  /** A person's name as LINE shows it to the user; undefined when LINE has none. */
  private async nameOf(mid: string): Promise<string | undefined> {
    if (mid === this.ownMid) return this.ownName || undefined;
    const name = (await (await this.selfDeps.service()).getReader()).displayNameOf(mid);
    return name && name !== mid ? name : undefined;
  }

  private async chatName(chatId: string): Promise<string | undefined> {
    const reader = await (await this.selfDeps.service()).getReader();
    const name = reader.listChats({ query: chatId, limit: 1 })[0]?.name ?? '';
    return name && name !== chatId ? name : undefined;
  }

  private async pushResult(event: LineSelfTextEvent, result: BotBuiltinRunResult): Promise<boolean> {
    const s = this.deps.getStrings();
    const quote = { replyTo: event.messageId };
    if (result.ok && result.verbatim) {
      const verbatim = verbatimLineText(result.text);
      if (verbatim === null) return false;
      await this.post(event.lineChatId, verbatim, quote);
      return true;
    }
    const files = result.ok ? result.files ?? [] : [];
    const documents = result.ok ? result.documents ?? [] : [];
    // Pictures alone need no "(empty answer)" line: every message here rings everyone's phone.
    const withText = !result.ok || Boolean(result.text.trim()) || files.length + documents.length === 0;
    if (withText) {
      const text = result.ok
        ? formatLineReply(result.text, t(s, 'bot.chat.emptyResponse'))
        : `${t(s, 'bot.chat.runFailed', { provider: result.providerLabel })}\n${result.text}`;
      await this.post(event.lineChatId, text, quote);
    }
    // Only the first message of the answer quotes the request.
    await this.postFiles(event.lineChatId, files, withText ? {} : quote);
    // A file made for the answer goes as a file: a PNG asked for as one is wanted whole, not as a photo.
    await this.postFiles(event.lineChatId, documents, { asFile: true, ...(withText || files.length > 0 ? {} : quote) });
    return true;
  }

  /**
   * Files on this computer (a drawn picture, a flow's file) after the text as LINE shows them —
   * photos sent together as one album, every other file its own message; the ones LINE would not
   * take are named by count in one more line. Resolves with how many went.
   */
  private async postFiles(chatId: string, paths: readonly string[], options: LineSelfFileOptions = {}): Promise<number> {
    const sender = this.sender;
    if (paths.length === 0 || !sender) return 0;
    const delivered = await sender.sendFiles(chatId, paths, options);
    const missed = paths.length - delivered;
    if (missed > 0) await this.post(chatId, t(this.deps.getStrings(), 'bot.lineSelf.filesOnComputer', { count: String(missed) }));
    return delivered;
  }

  /**
   * A flow's message. The user's own id is their private chat: the one-person group they last asked
   * in, else the first one Yobi was used in — never a group with other people, who would read what
   * was meant for the user. Someone else's id is the 1:1 chat with them when the user asked Yobi
   * there since the app started (a flow started there answers there), else the group they last
   * addressed Yobi in; a group id must be one Yobi was used in.
   */
  async sendToChat(chatId: string, message: SocketBotOutgoing): Promise<void> {
    if (!this.sender) throw new Error('LINE PC bot is not running');
    const known = await this.selfDeps.knownChats();
    const target = chatId === this.ownMid
      ? await this.privateChat(known)
      : this.directChats.has(chatId) ? chatId : this.askedIn.get(chatId) ?? (known.includes(chatId) ? chatId : '');
    if (!target) throw new Error(`LINE PC bot has no chat to reach ${chatId} in`);
    const sender = this.sender;
    const buttons = message.buttons ?? [];
    const files = message.files ?? [];
    const { photos, links } = await this.picturesAsPhotos(message.pictures ?? []);
    const body = formatLineText([message.text, ...links].filter(Boolean).join('\n'));
    if (buttons.length > 0) this.menus.set(target, { lines: buttons.map((button) => button.line), at: Date.now() });
    const withText = Boolean(body.trim()) || buttons.length > 0 || files.length + photos.length === 0;
    // The request it answers is quoted by the first message (in another chat, LINE refuses the quote
    // and the message goes without it).
    const quote = message.replyTo ? { replyTo: message.replyTo } : {};
    let went = 0;
    // The picture first, as a chat app shows a link's picture above its words: the menu's choices
    // stay the last thing in the chat. One that does not go is only logged — its words still do.
    if (photos.length > 0) went += await sender.sendFiles(target, photos, quote);
    if (withText) {
      await this.post(target, numberedMenu(body, buttons.map((button) => button.label)), { throwOnFailure: true, ...(went === 0 ? quote : {}) });
      went += 1;
    }
    went += await this.postFiles(target, files, went === 0 ? quote : {});
    // A step that sent nothing at all must not count as sent.
    const count = files.length + photos.length;
    if (went === 0 && count > 0) {
      throw new FlowUserError('flow.error.lineSelfFilesUnsent', { count: String(count) }, `LINE PC could not send any of the ${count} file(s), and this step has no message, so nothing was sent`);
    }
  }

  /** The step's pictures as photo files, in order; one that cannot be made one stays a link. */
  private async picturesAsPhotos(pictures: readonly string[]): Promise<{ photos: string[]; links: string[] }> {
    const photos: string[] = [];
    const links: string[] = [];
    for (const url of pictures) {
      const file = (await this.selfDeps.pictureFile?.(url).catch(() => '')) ?? '';
      if (file) photos.push(file);
      else links.push(url);
    }
    return { photos, links };
  }

  /**
   * Someone the owner let in hears it in the group they asked from: how to ask there, not the
   * command list — the whole group reads it, and "Yobi /help" lists what they may use.
   */
  protected async approvalText(): Promise<string> {
    return t(this.deps.getStrings(), 'bot.lineSelf.approved');
  }

  /** Checked again each time: someone may have joined the group since the user last asked there. */
  private async privateChat(known: readonly string[]): Promise<string> {
    if (this.homeChat && (await this.isSolo(this.homeChat))) return this.homeChat;
    for (const chatId of known) {
      if (await this.isSolo(chatId)) return chatId;
    }
    return '';
  }

  private async post(chatId: string, text: string, options: LineSelfQuote & { throwOnFailure?: boolean } = {}): Promise<void> {
    const sender = this.sender;
    if (!sender) {
      this.deps.onLog('[lineSelf] send skipped — not connected');
      return;
    }
    try {
      await sender.send(chatId, withReplyPrefix(text), options.replyTo ? { replyTo: options.replyTo } : {});
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] could not send to ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
      if (options.throwOnFailure) throw err;
    }
  }
}

import type { LineSelfTargetOption, SocketBotAccountInfo } from '../../shared/types';
import { t } from '../i18n';
import { LineError } from '../line/errors';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { FlowUserError } from '../flow/userError';
import type { FlowBotMessage } from '../flow/types';
import { SocketBotRuntime, type SocketBotOutgoing, type SocketBotRuntimeDeps } from '../botChat/socketRuntime';
import { pageAnalyzeChoice, pageForwardForLine } from '../botChat/pageForward';
import { singleLinkOf } from '../../shared/linkQuestion';
import { targetMessage } from '../line/lineSendReply';
import type { BotAgentContext, BotAgentMedia, BotChatEvent, BotChatOutput, BotChatRouterDeps, BotPairingProfileInput } from '../botChat/types';
import { formatLineReply, formatLineText, verbatimLineText } from '../line/format';
import type { SendFilesRequest, SendRequest } from '../line/lineService';
import type { DownloadResult } from '../line/lineMediaRows';
import type { MessageDownloadRequest } from '../line/lineMessageDownload';
import type { SendFilesPlan } from '../line/lineSendFiles';
import type { SendPlan } from '../line/lineSendText';
import type { WatchedMessage } from '../line/ownMessages';
import type { LineReader } from '../line/reader';
import { createLineSelfAdmin, LINE_SELF_OWNER_ONLY_COMMANDS, type LineSelfAdmin, type LineSelfAdminSource } from './admin';
import { lineSelfChatContext } from './chatContext';
import { defaultMediaPrompt, lineSelfMediaUnavailable, prepareLineSelfMedia } from './media';
import { requestMedia, type LineSelfMediaRef } from './mediaRows';
import { isLineDirectChat, isLineGroupChat } from './chats';
import { createLineSelfSender, type LineSelfFileOptions, type LineSelfQuote, type LineSelfSender, type LineSelfSenderDeps } from './sender';
import { addressedText, groupRequest, isYobiReply, menuPick, numberedMenu, withReplyPrefix } from './text';
import { LineSelfWatcher, type LineSelfStore, type LineSelfWatcherDeps } from './watcher';

/** A line addressed to the bot in a chat; the user's one-person group carries their id as `chatId`. */
export interface LineSelfTextEvent extends BotChatEvent {
  /** The LINE chat it was typed in, where the answer goes. */
  lineChatId: string;
  messageId: string;
  /** The message the line quotes (LINE's Reply), when it does. */
  replyToId?: string;
  /** The request is the one link the quoted message is made of: that message is the request, not context. */
  fromQuotedLink?: true;
  /** The photos or file it is about (quoted, or its sender's just before), fetched when its run starts. */
  media?: LineSelfMediaRef;
  /** A bare "Yobi": the words are what the user would have asked of `media`, so it cannot run without it. */
  mediaOnly?: true;
}

/** What the bot needs of LINE PC: the reader for names and members, fresh reads, and sending. */
export interface LineSelfService {
  getReader: () => Promise<LineReader>;
  openFresh: LineSelfStore['openFresh'];
  databasePath: () => string | null;
  send: (req: SendRequest) => Promise<SendPlan>;
  sendFiles: (req: SendFilesRequest) => Promise<SendFilesPlan>;
  /** One message's picture or file from LINE's server (a request's photo); absent = only copies saved on this computer. */
  downloadMessage?: (req: MessageDownloadRequest) => Promise<DownloadResult>;
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
   * A group or friend LINE PC has on this computer, by id (the flow editor's recipient list, read
   * fresh), or null. Without it a flow reaches only the chats Yobi was used in.
   */
  liveChat?: (chatId: string) => Promise<LineSelfTargetOption | null>;
  /**
   * A flow's picture on the web (a video menu's cover) as a photo file LINE can send, or "" — its
   * link then goes in the text. Without it every picture goes as its link.
   */
  pictureFile?: (url: string) => Promise<string>;
  /** A file on this computer as the photo LINE sends (a WebP made a JPEG); without it a WebP goes as a file. */
  photoFile?: (file: string) => Promise<string>;
  /** The model that reads a request's photos when the run's own takes no uploads ('' or absent = none). */
  uploadFallbackUrl?: () => string;
  /** The app's model, which a bot model left empty follows. */
  appModelUrl?: () => string;
  /** Where a request's photos and files are copied for its run; absent = the bots' scratch folder. */
  mediaDir?: string;
  /**
   * What `Yobi /users` and `Yobi /groups` read and write (the settings page's own writes); it also
   * lets a pairing request be posted into the owner's one-person group. Absent = neither.
   */
  admin?: LineSelfAdminSource;
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
 * with "Yobi" is a request in any group and in any 1:1 chat, from either side. Someone else asks
 * on their own rights; with none, their "Yobi" asks the owner to let them in.
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
  private readonly adminMenus: LineSelfAdmin;

  constructor(private readonly selfDeps: LineSelfRuntimeDeps) {
    // Only the user has a private chat here: everyone else's command, and the user's own outside
    // their one-person group, is typed in a group or a 1:1 chat.
    super('lineSelf', { ...selfDeps, groupPairingRequests: true, groupCommands: true });
    const asked = (event: BotChatEvent): LineSelfTextEvent => event as LineSelfTextEvent;
    this.adminMenus = createLineSelfAdmin({
      source: () => selfDeps.admin,
      ownMid: () => this.ownMid,
      isFlowAdmin: (chatId, userId) => selfDeps.isFlowAdmin?.(chatId, userId) ?? Promise.resolve(false),
      getStrings: selfDeps.getStrings,
      send: (event, message) => this.sendToTarget(asked(event).lineChatId, {
        text: message.text,
        buttons: message.buttons,
        ...(asked(event).messageId ? { replyTo: asked(event).messageId } : {}),
      }),
      reply: (event, text) => this.post(asked(event).lineChatId, text, { replyTo: asked(event).messageId }),
      onLog: selfDeps.onLog,
    });
  }

  /**
   * `Yobi /users` and `Yobi /groups`, when the setup gives what they manage. Called from the base
   * constructor, before this class's fields exist: the handlers read them only when they run.
   */
  protected ownerCommands(): BotChatRouterDeps<LineSelfTextEvent>['ownerCommands'] {
    if (!(this.deps as LineSelfRuntimeDeps).admin) return undefined;
    return {
      users: (event) => this.adminMenus.users(event),
      groups: (event) => this.adminMenus.groups(event),
    };
  }

  /**
   * A request the owner was told of also goes into their one-person group, "allow" and "block" as
   * numbers. Anyone unpaired sets one off, whenever they like: while another menu there is still
   * open (a flow's, `/users`, an earlier request's), or an agent question waits there, it goes
   * without numbers, so a number the owner types for that menu or question never allows or blocks
   * someone else, and a "1" meant to allow someone never approves the question.
   */
  protected onPairingRequestTold(user: BotPairingProfileInput, group?: { title: string }): void {
    if (!this.selfDeps.admin) return;
    void (async () => {
      const target = await this.privateChat(await this.selfDeps.knownChats());
      if (!target) {
        this.deps.onLog(`[lineSelf] no one-person group to post ${user.userId}'s request in`);
        return;
      }
      const notice = (numbered: boolean): SocketBotOutgoing => this.adminMenus.requestNotice(user, group, numbered);
      await this.sendToTarget(target, notice(true), { unlessMenuOpen: notice(false) });
    })().catch((err: unknown) => this.deps.onLog(`[lineSelf] could not post ${user.userId}'s request: ${err instanceof Error ? err.message : String(err)}`));
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
      pairingCodes: false,
      listsOwnerCommand: (name, userId) => !LINE_SELF_OWNER_ONLY_COMMANDS.has(name) || userId === this.ownMid,
      pushResult: (event, result) => this.pushResult(event, result),
      displayName: (event) => this.nameOf(event.userId),
      groupName: (chatId) => this.chatName(chatId),
      replyRef: (event) => event.messageId,
      agentContext: (event, input) => this.agentContext(event, input),
      agentMedia: (event, targetUrl) => this.agentMedia(event, targetUrl),
    };
  }

  /**
   * The photos or file a request is about, ready for its run (fetched now that it is taken, with
   * the tokens the sends keep). Someone no longer let in gets none.
   */
  private async agentMedia(event: LineSelfTextEvent, targetUrl: string): Promise<BotAgentMedia | null> {
    if (!event.media || !this.deps.isPairedUser(event.userId)) return null;
    // A bare "Yobi" or a quote is about its media; words typed after a photo or file also stand alone.
    const aboutMedia = event.media.quoted || event.mediaOnly === true;
    let media: BotAgentMedia;
    try {
      media = await this.prepareMedia(event.media, event, targetUrl);
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] could not prepare the media of message ${event.messageId}: ${err instanceof Error ? err.message : String(err)}`);
      return aboutMedia ? lineSelfMediaUnavailable(targetUrl, this.deps.getStrings()) : null;
    }
    if (!media.refusal || aboutMedia) return media;
    this.deps.onLog(`[lineSelf] the file before message ${event.messageId} cannot be read — answering its words alone`);
    return null;
  }

  private async prepareMedia(ref: LineSelfMediaRef, event: LineSelfTextEvent, targetUrl: string): Promise<BotAgentMedia> {
    const service = await this.selfDeps.service();
    const download = service.downloadMessage?.bind(service);
    const sender = this.sender;
    const effective = targetUrl || (this.selfDeps.appModelUrl?.() ?? '');
    const media = await prepareLineSelfMedia(ref, { chatId: event.lineChatId, userId: event.userId, targetUrl: effective }, {
      ...(download ? { download } : {}),
      tokens: () => (sender ? sender.tokens() : this.selfDeps.scanTokens()),
      fallbackUrl: this.selfDeps.uploadFallbackUrl?.() ?? '',
      strings: this.deps.getStrings(),
      onLog: this.deps.onLog,
      ...(this.selfDeps.mediaDir ? { dir: this.selfDeps.mediaDir } : {}),
    });
    // The run's own model stays as the router had it (empty = the app's); only the stand-in replaces it.
    return media.targetUrl === effective ? { ...media, targetUrl } : media;
  }

  /**
   * The photos or file a paired person's "Yobi" line is about, read fresh: the message it quotes,
   * else their own one just before. None while Yobi waits for their answer (the line answers it),
   * and never for someone not let in: nothing of theirs is fetched.
   */
  private async requestMediaOf(chatId: string, speaker: string, request: { id: string; createdMs: number; replyTo?: string }): Promise<LineSelfMediaRef | null> {
    if (!this.deps.isPairedUser(speaker)) return null;
    if (this.deps.hasPendingAgentAsk(chatId, speaker) || this.deps.hasPendingAgentAsk(this.ownMid, speaker)) return null;
    try {
      const { reader, close } = await (await this.selfDeps.service()).openFresh();
      try {
        return requestMedia(reader, {
          chatId,
          userId: speaker,
          messageId: request.id,
          sentAt: request.createdMs,
          ...(request.replyTo ? { replyToId: request.replyTo } : {}),
          sentByBot: (messageId) => this.sender?.sentByBot(messageId) === true,
        });
      } finally {
        close();
      }
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] could not read what message ${request.id} is about: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** The quoted message and, in a group with other people, its talk: read fresh, as LINE stored them. */
  private async agentContext(event: LineSelfTextEvent, input: string): Promise<BotAgentContext> {
    const { reader, close } = await (await this.selfDeps.service()).openFresh();
    try {
      const ownGroup = event.chatKind === 'user' && isLineGroupChat(event.lineChatId);
      return lineSelfChatContext(reader, {
        lineChatId: event.lineChatId,
        userId: event.userId,
        sentAt: event.sentAt ?? Date.now(),
        ...(event.replyToId ? { replyToId: event.replyToId } : {}),
        ...(event.fromQuotedLink ? { fromQuotedLink: true } : {}),
        privateChat: ownGroup,
        sharedGroup: isLineGroupChat(event.lineChatId) && !ownGroup,
        ownName: this.ownName,
      }, input);
    } finally {
      close();
    }
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
    const asked = this.requestIn(chatId, fromMe, speaker, text, mentions);
    const said = asked ?? (await this.ownReply(chatId, fromMe, text));
    const linked = said === '' && message.reply_to ? await this.quotedLink(chatId, message.reply_to) : '';
    // A photo or file a "Yobi" line is about (not an answer or a menu number): a bare "Yobi" then
    // asks what the user would have asked of it.
    const media = asked !== null && !linked
      ? await this.requestMediaOf(chatId, speaker, { id, createdMs, ...(message.reply_to ? { replyTo: message.reply_to } : {}) })
      : null;
    const request = linked || said || (media ? defaultMediaPrompt(media, this.deps.getStrings()) : '');
    if (!request) return;
    const solo = group && fromMe && (await this.isSolo(chatId));
    // The other side of a 1:1 chat asks in their own chat with the user (its id is theirs): the
    // router's private path, so someone not let in yet asks the owner, and once let in has their own rights.
    const theirs = isLineDirectChat(chatId) && !fromMe;
    if (solo) await this.rememberHome(chatId);
    else if (group && !fromMe) this.askedIn.set(speaker, chatId);
    else if (isLineDirectChat(chatId)) this.directChats.add(chatId);
    const event: LineSelfTextEvent = {
      userId: speaker,
      chatId: solo ? this.ownMid : chatId,
      chatKind: solo || theirs ? 'user' : 'group',
      text: request,
      mentionsBot: true,
      sentAt: createdMs,
      lineChatId: chatId,
      messageId: id,
      ...(message.reply_to ? { replyToId: message.reply_to } : {}),
      ...(linked ? { fromQuotedLink: true as const } : {}),
      ...(media ? { media } : {}),
      ...(media && !linked && !said ? { mediaOnly: true as const } : {}),
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
   * - A 1:1 chat: a "Yobi" line from either side, answered there. The user's runs on their rights
   *   without memory (the other person sees the answer); the other person's is their own request
   *   in their own chat — nothing else of theirs is read, so their answer to Yobi's question needs
   *   "Yobi" too. Keep (the user's own id) holds personal notes and is never used.
   * - A group: anyone's "Yobi" line, or one @-mentioning the user from someone already let in. An
   *   @-mention from anyone else is people talking to the user — counted, it would ask the owner
   *   to let in half of every work group.
   * Other chats (open chats, multi-person rooms) are not the bot's.
   */
  private requestIn(chatId: string, fromMe: boolean, speaker: string, text: string, mentions: WatchedMessage['mentions']): string | null {
    if (isLineDirectChat(chatId)) {
      if (chatId === this.ownMid) return null;
      return fromMe || speaker === chatId ? addressedText(text) : null;
    }
    if (!isLineGroupChat(chatId)) return null;
    return groupRequest(text, this.deps.isPairedUser(speaker) ? mentions : [], this.ownMid);
  }

  /** "Yobi" alone, quoting a message that is one link: that link. A quote it cannot read is no request. */
  private async quotedLink(chatId: string, id: string): Promise<string> {
    try {
      const { reader, close } = await (await this.selfDeps.service()).openFresh();
      try {
        return singleLinkOf(targetMessage(reader, chatId, id, 'reply_to', 'replied to').message.content ?? '') ?? '';
      } finally {
        close();
      }
    } catch {
      return '';
    }
  }

  /**
   * In the user's own group (nobody else in it), a reply needs no "Yobi": the answer to the question
   * Yobi asked there, or a number of the menu open there. Anything else there is the user's own note
   * — also while a menu is open: someone's pairing request can put one there.
   */
  private async ownReply(chatId: string, fromMe: boolean, text: string): Promise<string | null> {
    const line = text.trim();
    if (!fromMe || !line || !isLineGroupChat(chatId)) return null;
    const awaited = this.menuLine(chatId, line) !== null || this.deps.hasPendingAgentAsk(this.ownMid, this.ownMid);
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

  /** The last numbered menu sent here while a typed number still picks from it (an expired one is dropped). */
  private openMenu(chatId: string): { lines: string[]; at: number } | undefined {
    const menu = this.menus.get(chatId);
    if (menu && Date.now() - menu.at > MENU_TTL_MS) {
      this.menus.delete(chatId);
      return undefined;
    }
    return menu;
  }

  /** A typed number picks a line of the last numbered menu sent here. */
  private menuLine(chatId: string, text: string): string | null {
    const menu = this.openMenu(chatId);
    return menu ? menuPick(text, menu.lines) : null;
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
    if (result.ok && result.pageForward) {
      const choice = pageAnalyzeChoice(result.pageForward, s);
      await this.sendToTarget(event.lineChatId, {
        text: pageForwardForLine(result.pageForward, s, Array.from(withReplyPrefix(numberedMenu('x', [choice.label]))).length),
        pictures: result.pageForward.images,
        buttons: [choice],
        ...(event.messageId ? { replyTo: event.messageId } : {}),
      });
      return true;
    }
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
   * A flow's message, or the notice that the owner let someone in. The user's own id is their
   * private chat: the one-person group they last asked in, else the first one Yobi was used in —
   * never a group with other people, who would read what was meant for the user. Any other id is, in
   * order: the 1:1 chat the user asked Yobi in since the app started (a flow started there answers
   * there); only when the step picked it (`picked`), a group or friend LINE PC has (`liveChat`: the
   * flow editor's list — a person's id is their 1:1 chat, a flow started in a group answers in that
   * group); the group that person last addressed Yobi in; a group Yobi was used in. Else it fails,
   * worded for the user, as do LINE's refusals the user can fix (no key yet, sealing off, LINE closed).
   *
   * Not picked — a variable's chat, a blank field's paired person, the approval notice — never looks
   * in LINE PC's list: a variable would otherwise reach the owner's whole address book, and the
   * approval ("ask in this group") would land in a 1:1 the person never used, often with no key.
   */
  async sendToChat(chatId: string, message: FlowBotMessage): Promise<void> {
    if (!this.sender) throw new Error('LINE PC bot is not running');
    const { picked, ...outgoing } = message;
    const target = await this.flowTarget(chatId, picked === true);
    try {
      await this.sendToTarget(target.id, outgoing);
    } catch (err: unknown) {
      throw await this.flowSendFailure(err, target);
    }
  }

  /** Where `sendToChat` sends a flow's message for this id, with the name LINE PC shows for it when known. */
  private async flowTarget(chatId: string, picked: boolean): Promise<{ id: string; name?: string }> {
    if (chatId === this.ownMid) {
      const own = await this.privateChat(await this.selfDeps.knownChats());
      if (own) return { id: own };
      throw new FlowUserError('flow.error.lineSelfNoOwnGroup', {}, 'LINE PC has no chat with only you in it to send to: say "Yobi" once in a LINE group that has only you');
    }
    if (this.directChats.has(chatId)) return { id: chatId };
    const live = picked ? await this.liveChat(chatId) : null;
    if (live) return { id: live.id, name: live.name };
    const asked = this.askedIn.get(chatId);
    if (asked) return { id: asked };
    if ((await this.selfDeps.knownChats()).includes(chatId)) return { id: chatId };
    throw new FlowUserError('flow.error.lineSelfChatNotFound', { id: chatId }, `LINE PC has no chat ${chatId} to send to: no group or friend with that id on this computer`);
  }

  private async liveChat(chatId: string): Promise<LineSelfTargetOption | null> {
    if (!this.selfDeps.liveChat) return null;
    try {
      return await this.selfDeps.liveChat(chatId);
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] could not look ${chatId} up in LINE's chats: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** LINE's refusals the user can fix, in their words: open the chat once, sealing is off, LINE is closed. */
  private async flowSendFailure(err: unknown, target: { id: string; name?: string }): Promise<unknown> {
    if (!(err instanceof LineError)) return err;
    if (err.code === 'LINE_NOT_RUNNING') {
      return new FlowUserError('flow.error.lineSelfLineNotRunning', {}, 'LINE PC is not running on this computer: open LINE, sign in, then run again');
    }
    if (err.code !== 'E2EE_KEY_MISSING' && err.code !== 'E2EE_DISABLED') return err;
    const name = target.name ?? (await this.chatName(target.id).catch(() => undefined)) ?? (await this.nameOf(target.id).catch(() => undefined)) ?? target.id;
    return err.code === 'E2EE_KEY_MISSING'
      ? new FlowUserError('flow.error.lineSelfKeyMissing', { name }, `LINE PC has no key for ${target.id} yet: open that chat once in LINE PC, then run again`)
      : new FlowUserError('flow.error.lineSelfSealingOff', { name }, `${target.id} has Letter Sealing off, so LINE PC cannot send there`);
  }

  /**
   * A step's message or a forwarded page: pictures, the words with a numbered menu, then files.
   * `unlessMenuOpen` goes instead while a menu is still open there, checked where the menu is taken.
   */
  private async sendToTarget(target: string, message: SocketBotOutgoing, options: { unlessMenuOpen?: SocketBotOutgoing } = {}): Promise<void> {
    const sender = this.sender;
    if (!sender) throw new Error('LINE PC bot is not running');
    const buttons = message.buttons ?? [];
    const files = message.files ?? [];
    const { photos, links } = await this.picturesAsPhotos(message.pictures ?? []);
    // `unlessMenuOpen` only goes to the owner's one-person group, whose questions wait under the
    // owner's own chat: a number typed there answers a waiting question before any menu.
    const taken = (): boolean => Boolean(this.openMenu(target)) || this.deps.hasPendingAgentAsk(this.ownMid, this.ownMid);
    if (options.unlessMenuOpen && buttons.length > 0 && taken()) {
      await this.sendToTarget(target, options.unlessMenuOpen);
      return;
    }
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
   * Someone the owner let in hears it where they asked (`sendToChat`: their 1:1 chat with the user
   * when they asked there, else the group): how to ask there, not the command list — in a group
   * everyone reads it, and "Yobi /help" lists what they may use.
   */
  protected async approvalText(userId: string): Promise<string> {
    return t(this.deps.getStrings(), this.directChats.has(userId) ? 'bot.lineSelf.approvedDirect' : 'bot.lineSelf.approved');
  }

  /**
   * Someone not let in asking in their 1:1 chat with the user: told once (when the owner heard of
   * it), with no `/pair` code to type — LINE PC has none.
   */
  protected pairingRequestedKey(inGroup: boolean): string {
    return inGroup ? 'bot.socket.groupPairingRequested' : 'bot.lineSelf.pairingRequested';
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

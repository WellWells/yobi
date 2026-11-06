import type { SocketBotAccountInfo, SocketBotPlatform, SocketBotRuntimeSnapshot, SocketBotRuntimeStatus } from '../../shared/types';
import { Mutex } from '../flow/lanes';
import { t } from '../i18n';
import { createBotRequestPace } from '../botRequestPace';
import { BotChatRouter } from './router';
import type { BotChatEvent, BotChatOutput, BotChatRouterDeps, BotPairingProfileInput } from './types';

/** A message a flow's bot step sends: Markdown text, files on this computer, and buttons that stand for lines. */
export interface SocketBotOutgoing {
  text: string;
  /** Absolute paths, already checked to be this run's own files. */
  files?: readonly string[];
  /**
   * Pictures on the web the step sends as photos (a video menu's cover). Discord and Slack show a
   * link as its picture, so they get the links after the text (`withPictureLinks`); LINE PC shows
   * the address, so it sends the picture itself.
   */
  pictures?: readonly string[];
  buttons?: ReadonlyArray<{ label: string; line: string; rowStart?: boolean }>;
  /** A message in the same chat to quote (the request the run answers). */
  replyTo?: string;
}

/** The message with its pictures as links after the text, for a chat that shows a link as its picture. */
export function withPictureLinks(message: SocketBotOutgoing): SocketBotOutgoing {
  const pictures = message.pictures ?? [];
  return pictures.length === 0 ? message : { ...message, text: [message.text, ...pictures].filter(Boolean).join('\n') };
}

type RouterOwned = 'platform' | 'output' | 'pace' | 'ownerCommands';

export interface SocketBotRuntimeDeps<E extends BotChatEvent> extends Omit<BotChatRouterDeps<E>, RouterOwned> {
  getEnabled: () => boolean;
  /** The secrets it signs in with, by field (`SOCKET_BOT_SECRET_FIELDS`); all must be set. */
  getSecrets: () => Record<string, string>;
  onRuntime: (snapshot: SocketBotRuntimeSnapshot) => void;
  /** Pairs an id without a code, as `/pair <code>` would; false = it was already paired. */
  pairWithoutCode?: (user: BotPairingProfileInput) => boolean;
  /** The run whose question this person has to answer here, without taking it (a choice button checks it). */
  pendingAgentAskRunId?: (chatId: string, userId: string) => string | null;
  /** The question went out, its choices as buttons without numbers: a typed "1" then picks nothing. */
  onAgentAskShown?: (chatId: string, userId: string, shown: { numbered: boolean }) => void;
  /** A pending group was addressed for the first time this run: the owner hears about it once. */
  onPendingGroupAddressed?: (group: { chatId: string; title?: string }) => void;
  /**
   * An unpaired person wrote in their private chat — or, where the platform has no private chat
   * for them (`groupPairingRequests`), addressed the bot in a group that lets them do nothing: a
   * request to use the bot, recorded so the settings page can allow it. Resolves true when the
   * owner was told (a desktop notification); `group` names where they asked.
   */
  notePairingRequest?: (user: BotPairingProfileInput, group?: { title: string }) => Promise<boolean>;
}

/**
 * What Discord's and Slack's runtimes share: start and stop with the config (one lock, so a quick
 * second save waits for the first), the status the settings page shows, the shared router fed by
 * the platform's events, and pairing without a code. A platform supplies how it connects, how it
 * writes answers (`output`) and how a flow's message reaches a chat (`sendToChat`).
 */
export abstract class SocketBotRuntime<E extends BotChatEvent> {
  protected readonly router: BotChatRouter<E>;
  private readonly lock = new Mutex();
  private status: SocketBotRuntimeStatus = 'idle';
  private errorMessage = '';
  protected account: SocketBotAccountInfo | undefined;
  private currentSecrets = '';
  private readonly addressedPending = new Set<string>();

  protected constructor(readonly platform: SocketBotPlatform, protected readonly deps: SocketBotRuntimeDeps<E>) {
    const {
      getEnabled: _enabled, getSecrets: _secrets, onRuntime: _runtime, pairWithoutCode: _pair,
      pendingAgentAskRunId: _pending, onAgentAskShown: _shown, onPendingGroupAddressed: _addressed,
      notePairingRequest, ...routerDeps
    } = deps;
    const output = this.output();
    this.router = new BotChatRouter<E>({
      ...routerDeps,
      platform,
      pace: createBotRequestPace(),
      output,
      ...(notePairingRequest ? {
        onPairingRequest: async (event: E) => {
          const inGroup = event.chatKind !== 'user';
          const displayName = await output.displayName(event).catch(() => undefined);
          const group = inGroup ? { title: (await output.groupName?.(event.chatId, event.chatKind).catch(() => undefined)) || event.chatId } : undefined;
          const told = await notePairingRequest({ userId: event.userId, ...(displayName ? { displayName } : {}) }, group).catch((err: unknown) => {
            deps.onLog(`[${platform}] could not record ${event.userId}'s request: ${err instanceof Error ? err.message : String(err)}`);
            return false;
          });
          // Everyone in a group reads the reply: it is said once, when the owner heard of the request.
          if (inGroup && !told) return;
          await output.reply(event, t(deps.getStrings(), inGroup ? 'bot.socket.groupPairingRequested' : 'bot.socket.pairingRequested'));
        },
      } : {}),
    });
  }

  /**
   * How this platform writes the router's answers. Called once, from this constructor — before the
   * subclass's own fields exist — so its functions may read them only when called, never eagerly.
   */
  protected abstract output(): BotChatOutput<E>;
  /** Connects with these secrets; resolves with the bot's account once it is ready to receive. */
  protected abstract connect(secrets: Record<string, string>): Promise<SocketBotAccountInfo>;
  protected abstract disconnect(): Promise<void>;
  /** A flow's message to a chat id as the bot step names it: a paired person's id (their DM) or a group's. */
  abstract sendToChat(chatId: string, message: SocketBotOutgoing): Promise<void>;

  getSnapshot(): SocketBotRuntimeSnapshot {
    return {
      platform: this.platform,
      status: this.status,
      ...(this.errorMessage ? { errorMessage: this.errorMessage } : {}),
      ...(this.account ? { account: this.account } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  async syncWithConfig(): Promise<void> {
    await this.lock.runExclusive(async () => {
      const secrets = this.deps.getSecrets();
      const complete = Object.values(secrets).every((value) => value.trim());
      if (!this.deps.getEnabled() || !complete) {
        await this.stopInternal();
        this.errorMessage = this.deps.getEnabled() && !complete ? t(this.deps.getStrings(), 'bot.socket.credentialsRequired') : '';
        this.setStatus('idle');
        return;
      }
      const fingerprint = JSON.stringify(secrets);
      if (this.status === 'running' && this.currentSecrets === fingerprint) return;
      await this.stopInternal();
      this.errorMessage = '';
      this.setStatus('starting');
      try {
        this.account = await this.connect(secrets);
        this.currentSecrets = fingerprint;
        this.setStatus('running');
        this.deps.onLog(`[${this.platform}] connected as ${this.account.name} (${this.account.id})`);
      } catch (err: unknown) {
        await this.disconnect().catch(() => undefined);
        this.fail(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /** Reconnects with the same settings (the settings page's retry after an error). */
  async reconnect(): Promise<void> {
    this.currentSecrets = '';
    await this.syncWithConfig();
  }

  async shutdown(): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.stopInternal();
      this.setStatus('idle');
    });
  }

  /** The connection is gone for good (a token Discord or Slack refuses): shown until the settings change. */
  protected fail(message: string): void {
    this.currentSecrets = '';
    this.errorMessage = message;
    this.deps.onLog(`[${this.platform}] ${message}`);
    this.setStatus('error');
  }

  private async stopInternal(): Promise<void> {
    this.currentSecrets = '';
    this.account = undefined;
    this.addressedPending.clear();
    await this.disconnect().catch((err: unknown) => {
      this.deps.onLog(`[${this.platform}] disconnect failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private setStatus(next: SocketBotRuntimeStatus): void {
    this.status = next;
    this.deps.onRuntime(this.getSnapshot());
  }

  /**
   * One typed line. A group the owner has not allowed only hears about it when someone addresses
   * the bot there — every other message in it is not the bot's business, and registering them all
   * would fill the settings page with every channel of every server.
   */
  protected dispatch(event: E): void {
    if (event.chatKind !== 'user' && this.deps.isGroupPending?.(event.chatId)) {
      if (!event.mentionsBot) return;
      if (!this.addressedPending.has(event.chatId)) {
        this.addressedPending.add(event.chatId);
        void this.notePendingGroup(event.chatId);
      }
    }
    void this.router.dispatch([event]);
  }

  private async notePendingGroup(chatId: string): Promise<void> {
    const title = await this.router.groupTitle(chatId).catch(() => undefined);
    this.deps.onPendingGroupAddressed?.({ chatId, ...(title ? { title } : {}) });
  }

  /** A button standing for a typed line (a menu's choice), as if typed here. */
  protected dispatchButtonLine(event: E): Promise<void> {
    return this.router.dispatchButtonLine(event);
  }

  /**
   * The owner let this person in without a code (the settings page's "Allow"): paired with every
   * effect a code pairing has, then told so with their command list. Idempotent.
   */
  async pairWithoutCode(user: BotPairingProfileInput): Promise<'paired' | 'alreadyPaired' | 'failed'> {
    const userId = (user.userId ?? '').trim();
    if (!userId || !this.deps.pairWithoutCode) return 'failed';
    if (!this.deps.pairWithoutCode({ ...user, userId })) return 'alreadyPaired';
    this.deps.onLog(`[${this.platform}] ${userId} paired by the owner, without a code`);
    if (this.isRunning()) {
      void (async () => {
        await this.sendToChat(userId, { text: await this.approvalText(userId) });
      })().catch((err: unknown) => this.deps.onLog(`[${this.platform}] could not tell ${userId} they were let in: ${err instanceof Error ? err.message : String(err)}`));
    }
    return 'paired';
  }

  /** What someone the owner let in is told, where `sendToChat(theirId)` reaches them: their command list. */
  protected async approvalText(userId: string): Promise<string> {
    return `${t(this.deps.getStrings(), 'bot.socket.approved')}\n\n${await this.router.helpText(userId)}`;
  }
}

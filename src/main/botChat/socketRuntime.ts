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
  buttons?: ReadonlyArray<{ label: string; line: string; rowStart?: boolean }>;
  /** A message in the same chat to quote (the request the run answers). */
  replyTo?: string;
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
   * An unpaired person wrote in their private chat: a request to use the bot, recorded so the
   * settings page can allow it (the owner gets a desktop notification). They are told so.
   */
  notePairingRequest?: (user: BotPairingProfileInput) => Promise<void>;
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
          const displayName = await output.displayName(event).catch(() => undefined);
          await notePairingRequest({ userId: event.userId, ...(displayName ? { displayName } : {}) }).catch((err: unknown) => {
            deps.onLog(`[${platform}] could not record ${event.userId}'s request: ${err instanceof Error ? err.message : String(err)}`);
          });
          await output.reply(event, t(deps.getStrings(), 'bot.socket.pairingRequested'));
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
      const s = this.deps.getStrings();
      void (async () => {
        await this.sendToChat(userId, { text: `${t(s, 'bot.socket.approved')}\n\n${await this.router.helpText(userId)}` });
      })().catch((err: unknown) => this.deps.onLog(`[${this.platform}] could not tell ${userId} they were let in: ${err instanceof Error ? err.message : String(err)}`));
    }
    return 'paired';
  }
}

import type { LineAccountInfo, LineRuntimeSnapshot, LineRuntimeStatus } from '../../shared/types';
import { Mutex } from '../flow/lanes';
import { t } from '../i18n';
import { createLineClient } from './client';
import type { LineClient } from './client';
import { LineWebhookServer, LINE_WEBHOOK_PATH } from './server';
import { formatLineReply, formatLineText } from './format';
import { buildLineAddFriendLink } from './deepLink';
import { LineDispatcher } from './dispatcher';
import type { LineDispatcherDeps } from './dispatcher';
import { safePush } from './messaging';
import { pickCarouselMessage, type LineCarouselItem } from './pickCarousel';
import { LINE_FLOW_BUTTON_PREFIX, lineMenuMessage, type LineFlowMenu } from './flowMenu';
import { LinePostbackRouter } from './postbackRouter';
import type { LinePostbackHandler } from './postbackRouter';
import { LINE_GROUP_ADMIN_PREFIX, createLineGroupAdmin, withJoinCard } from './groupAdmin';
import type { LineGroupAdminSource } from './groupAdmin';
import { createLineAccountAdmin } from './accountAdmin';
import type { LineAccountAdmin, LineAccountAdminSource } from './accountAdmin';
import { LINE_ACCOUNT_ADMIN_PREFIX } from './accountCards';
import { LINE_INVITE_PREFIX, createLineInviteAdmin } from './inviteAdmin';
import { InviteIssuers } from '../botPermissions/invites';
import type { InviteStore } from '../botPermissions/invites';
import type { LinePairingUserProfile } from './pairing';
import { createBotRequestPace } from '../botRequestPace';

type JoinedGroup = Parameters<NonNullable<LineDispatcherDeps['onGroupJoined']>>[0];

type OwnedDispatcherDeps = 'getClient' | 'onGroupJoined' | 'onGroupsCommand' | 'onUsersCommand' | 'onInviteCommand' | 'onPairingRequest';

export interface LineRuntimeDeps extends Omit<LineDispatcherDeps, OwnedDispatcherDeps> {
  getEnabled: () => boolean;
  getChannelAccessToken: () => string;
  getChannelSecret: () => string;
  getPort: () => number;
  onRuntime: (snapshot: LineRuntimeSnapshot) => void;
  /**
   * The bot was just added to a group or multi-person chat. True = the first notice of a group
   * still pending this run: its card is then pushed to the owner.
   */
  onGroupJoined?: (group: JoinedGroup) => boolean | void;
  /** What the owner's group cards read and write; absent = no `/groups`, no cards. */
  groupAdmin?: LineGroupAdminSource;
  /** What the owner's account cards read and write; absent = no `/users`, no request cards. */
  accountAdmin?: LineAccountAdminSource;
  /** The settings page's pairing codes; absent = no `/invite`. */
  invites?: InviteStore;
  /** Pairs an id without a code, as `/pair <code>` would; false = it was already paired. */
  pairWithoutCode?: (user: LinePairingUserProfile) => boolean;
}

const MAX_ERROR_TEXT = 4_900;

export class LineRuntime {
  private server: LineWebhookServer | null = null;
  private client: LineClient | null = null;
  private status: LineRuntimeStatus = 'idle';
  private errorMessage = '';
  private account: LineAccountInfo | undefined;
  private currentToken = '';
  private currentSecret = '';
  private currentPort = 0;
  private readonly lock = new Mutex();
  private readonly dispatcher: LineDispatcher;
  private readonly postbacks: LinePostbackRouter;
  private readonly accountAdmin: LineAccountAdmin | null;
  /** Who issued each pairing code sent from LINE (`/invite`). */
  private readonly inviteIssuers = new InviteIssuers<string>();

  constructor(private readonly deps: LineRuntimeDeps) {
    const {
      groupAdmin: source, accountAdmin: accounts, invites, pairWithoutCode: _pairer, onGroupJoined, onCodePaired, ...dispatcherDeps
    } = deps;
    const owner = {
      getClient: () => this.client,
      getStrings: deps.getStrings,
      onLog: deps.onLog,
      isPairedUser: deps.isPairedUser,
      ...(deps.isFlowAdmin ? { isFlowAdmin: deps.isFlowAdmin } : {}),
    };
    const groupAdmin = source ? createLineGroupAdmin({ ...owner, source }) : null;
    this.accountAdmin = accounts ? createLineAccountAdmin({ ...owner, source: accounts }) : null;
    const inviteAdmin = invites
      ? createLineInviteAdmin({ ...owner, store: invites, issuers: this.inviteIssuers, getBasicId: () => this.basicId() })
      : null;
    const accountAdmin = this.accountAdmin;
    this.dispatcher = new LineDispatcher({
      ...dispatcherDeps,
      pace: createBotRequestPace(),
      getClient: () => this.client,
      onGroupJoined: withJoinCard(onGroupJoined, groupAdmin, deps.onLog),
      ...(groupAdmin ? { onGroupsCommand: groupAdmin.handleCommand } : {}),
      ...(accountAdmin ? { onUsersCommand: accountAdmin.handleCommand, onPairingRequest: accountAdmin.handlePairingRequest } : {}),
      ...(inviteAdmin ? { onInviteCommand: inviteAdmin.handleCommand } : {}),
      onCodePaired: (code, userId) => {
        onCodePaired?.(code, userId);
        this.afterCodePairing(code, userId);
      },
    });
    this.postbacks = new LinePostbackRouter({
      onLog: deps.onLog,
      ...(deps.isBlocked ? { isBlocked: deps.isBlocked } : {}),
    });
    if (groupAdmin) this.postbacks.register(LINE_GROUP_ADMIN_PREFIX, groupAdmin.handlePostback);
    if (accountAdmin) this.postbacks.register(LINE_ACCOUNT_ADMIN_PREFIX, accountAdmin.handlePostback);
    if (inviteAdmin) this.postbacks.register(LINE_INVITE_PREFIX, inviteAdmin.handlePostback);
    this.postbacks.register(LINE_FLOW_BUTTON_PREFIX, (event, line) => this.dispatcher.dispatchFlowButton(event, line));
    this.emitRuntime();
  }

  /** The bot's basic ID for links: the account read at start, else asked now (a free read). */
  private async basicId(): Promise<string> {
    if (this.account?.basicId) return this.account.basicId;
    const client = this.client;
    if (!client) return '';
    return (await client.getBotInfo().catch(() => null))?.basicId ?? '';
  }

  /** A code was used: when the owner issued it from LINE, they get the new account's card (one push). */
  private afterCodePairing(code: string, userId: string): void {
    const issuerId = this.inviteIssuers.take(code);
    if (issuerId === undefined || !this.accountAdmin) return;
    void this.accountAdmin.tellInviteIssuer(issuerId, userId);
  }

  /**
   * The owner let this person in without a code (`/users`, a request card, the settings page):
   * paired with every effect a code pairing has, then told so with their command list — one push,
   * when the bot is running. Idempotent: an id already paired changes nothing and is not messaged.
   */
  async pairWithoutCode(user: LinePairingUserProfile): Promise<'paired' | 'alreadyPaired' | 'failed'> {
    const userId = (user.userId ?? '').trim();
    if (!userId || !this.deps.pairWithoutCode) return 'failed';
    if (!this.deps.pairWithoutCode({ ...user, userId })) return 'alreadyPaired';
    this.deps.onLog(`[line] ${userId} paired by the owner, without a code`);
    const client = this.client;
    if (client) {
      const s = this.deps.getStrings();
      void (async () => {
        await client.pushText(userId, `${t(s, 'line.users.request.approved')}\n\n${await this.dispatcher.helpText(userId)}`);
      })().catch((err: unknown) => this.deps.onLog(`[line] could not tell ${userId} they were let in: ${err instanceof Error ? err.message : String(err)}`));
    }
    return 'paired';
  }

  /** Another kind of Flex card's buttons: taps whose data starts with `<prefix>:` go to `handler`. */
  registerPostbackHandler(prefix: string, handler: LinePostbackHandler): void {
    this.postbacks.register(prefix, handler);
  }

  getSnapshot(): LineRuntimeSnapshot {
    return {
      status: this.status,
      webhookPath: LINE_WEBHOOK_PATH,
      errorMessage: this.errorMessage || undefined,
      account: this.account,
      updatedAt: new Date().toISOString(),
    };
  }

  async syncWithConfig(): Promise<void> {
    await this.lock.runExclusive(async () => {
      const enabled = this.deps.getEnabled();
      const token = this.deps.getChannelAccessToken().trim();
      const secret = this.deps.getChannelSecret().trim();
      const port = this.deps.getPort();
      const s = this.deps.getStrings();

      if (!enabled || !token || !secret) {
        await this.stopInternal();
        this.errorMessage = enabled && (!token || !secret)
          ? t(s, 'line.runtime.credentialsRequired')
          : '';
        this.updateStatus('idle');
        return;
      }

      if (this.server?.isListening() && this.currentSecret === secret && this.currentPort === port) {
        if (this.currentToken !== token) {
          this.client = createLineClient(token);
          this.currentToken = token;
          this.deps.onLog('[line] channel access token updated');
          void this.refreshAccount();
        }
        return;
      }

      await this.startOrReplace(token, secret, port);
    });
  }

  async shutdown(): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.stopInternal();
      this.updateStatus('idle');
    });
  }

  async refreshAccount(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const [info, webhookActive] = await Promise.all([client.getBotInfo(), client.getWebhookActive()]);
      if (this.client !== client) return;
      this.account = {
        basicId: info.basicId,
        displayName: info.displayName,
        chatModeOn: info.chatMode === 'chat',
        webhookActive,
        addFriendUrl: buildLineAddFriendLink(info.basicId),
      };
      this.emitRuntime();
    } catch (err: unknown) {
      this.deps.onLog(`[line] failed to read account info: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async sendTaskSuccess(to: string, response: string): Promise<void> {
    const s = this.deps.getStrings();
    await this.push(to, formatLineReply(response, t(s, 'bot.chat.emptyResponse')));
  }

  async sendTaskError(to: string, payload: { providerLabel: string; message: string }): Promise<void> {
    const s = this.deps.getStrings();
    const header = t(s, 'bot.chat.runFailed', { provider: payload.providerLabel });
    const text = payload.message ? `${header}\n${payload.message}` : header;
    await this.push(to, text.slice(0, MAX_ERROR_TEXT));
  }

  async sendProactive(userId: string, text: string): Promise<void> {
    const client = this.requireClient();
    await client.pushText(userId, formatLineText(text));
  }

  async sendProactiveImage(userId: string, imageUrl: string): Promise<void> {
    const client = this.requireClient();
    await client.pushImage(userId, imageUrl);
  }

  async sendProactiveVideo(userId: string, videoUrl: string, previewUrl: string): Promise<void> {
    const client = this.requireClient();
    await client.pushVideo(userId, videoUrl, previewUrl);
  }

  async sendProactiveCarousel(userId: string, items: readonly LineCarouselItem[], altText: string): Promise<void> {
    const client = this.requireClient();
    await client.pushFlex(userId, pickCarouselMessage(items, altText));
  }

  async sendProactiveMenu(userId: string, menu: LineFlowMenu): Promise<void> {
    const client = this.requireClient();
    await client.pushFlex(userId, lineMenuMessage({ ...menu, text: formatLineText(menu.text) }));
  }

  private requireClient(): LineClient {
    if (!this.client) throw new Error('LINE bot is not running');
    return this.client;
  }

  private async startOrReplace(token: string, secret: string, port: number): Promise<void> {
    this.updateStatus('starting');
    this.errorMessage = '';
    await this.stopInternal();

    const server = new LineWebhookServer({
      getChannelSecret: () => this.deps.getChannelSecret(),
      onEvents: (events) => { void this.dispatcher.dispatch(events); },
      onChatEvents: (events) => { void this.dispatcher.dispatchChatEvents(events); },
      onPostbacks: (events) => { void this.postbacks.dispatch(events); },
      onLog: this.deps.onLog,
    });

    try {
      await server.start(port);
    } catch (err: unknown) {
      const s = this.deps.getStrings();
      this.errorMessage = t(s, 'line.runtime.listenFailed', {
        port: String(port),
        error: err instanceof Error ? err.message : String(err),
      });
      this.updateStatus('error');
      throw err;
    }

    this.server = server;
    this.client = createLineClient(token);
    this.currentToken = token;
    this.currentSecret = secret;
    this.currentPort = port;
    this.updateStatus('running');
    this.deps.onLog(`[line] webhook server listening on http://127.0.0.1:${port}${LINE_WEBHOOK_PATH}`);
    void this.refreshAccount();
  }

  private push(to: string, text: string): Promise<void> {
    return safePush(this.client, to, text, this.deps.onLog);
  }

  private async stopInternal(): Promise<void> {
    this.client = null;
    this.account = undefined;
    this.currentToken = '';
    this.currentSecret = '';
    this.currentPort = 0;
    const server = this.server;
    this.server = null;
    if (server) {
      await server.stop();
      this.deps.onLog('[line] webhook server stopped');
    }
  }

  private updateStatus(next: LineRuntimeStatus): void {
    this.status = next;
    this.emitRuntime();
  }

  private emitRuntime(): void {
    this.deps.onRuntime(this.getSnapshot());
  }
}

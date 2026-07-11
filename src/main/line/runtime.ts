import type { LineAccountInfo, LineRuntimeSnapshot, LineRuntimeStatus } from '../../shared/types';
import { t } from '../i18n';
import { createLineClient } from './client';
import type { LineClient } from './client';
import { LineWebhookServer, LINE_WEBHOOK_PATH } from './server';
import { formatLineReply, truncateLineText } from './format';
import { buildLineAddFriendLink } from './deepLink';
import { LineDispatcher } from './dispatcher';
import type { LineDispatcherDeps } from './dispatcher';
import { safePush } from './messaging';

export type { LineTaskRequest } from './dispatcher';

export interface LineRuntimeDeps extends Omit<LineDispatcherDeps, 'getClient'> {
  getEnabled: () => boolean;
  getChannelAccessToken: () => string;
  getChannelSecret: () => string;
  getPort: () => number;
  onRuntime: (snapshot: LineRuntimeSnapshot) => void;
}

const MAX_ERROR_TEXT = 4_900;

// Owns the webhook server's lifecycle and the account diagnostics. Message
// routing lives in LineDispatcher.
export class LineRuntime {
  private server: LineWebhookServer | null = null;
  private client: LineClient | null = null;
  private status: LineRuntimeStatus = 'idle';
  private errorMessage = '';
  private account: LineAccountInfo | undefined;
  private currentToken = '';
  private currentSecret = '';
  private currentPort = 0;
  private lock: Promise<void> = Promise.resolve();
  private readonly dispatcher: LineDispatcher;

  constructor(private readonly deps: LineRuntimeDeps) {
    this.dispatcher = new LineDispatcher({ ...deps, getClient: () => this.client });
    this.emitRuntime();
  }

  getSnapshot(): LineRuntimeSnapshot {
    return {
      status: this.status,
      listenUrl: this.status === 'running' ? `http://127.0.0.1:${this.currentPort}` : undefined,
      webhookPath: LINE_WEBHOOK_PATH,
      errorMessage: this.errorMessage || undefined,
      account: this.account,
      updatedAt: new Date().toISOString(),
    };
  }

  async syncWithConfig(): Promise<void> {
    await this.runLocked(async () => {
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

      // Server verifies against the live config secret, so a same-port/same-secret
      // credential change only needs the push client rebuilt — no server restart.
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
    await this.runLocked(async () => {
      await this.stopInternal();
      this.updateStatus('idle');
    });
  }

  // Reads the Official Account's settings back from the Messaging API so the UI
  // can flag the two silent misconfigurations (Chat mode on, webhook disabled).
  // Diagnostics are a bonus, never a prerequisite: failures only log.
  async refreshAccount(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const [info, webhookActive] = await Promise.all([client.getBotInfo(), client.getWebhookActive()]);
      // The fetch runs outside syncWithConfig's lock, so a credential change may
      // have replaced the client meanwhile — never let a stale reply win.
      if (this.client !== client) return;
      this.account = {
        basicId: info.basicId,
        displayName: info.displayName,
        chatModeOn: info.chatMode === 'chat',
        webhookActive,
        addFriendUrl: buildLineAddFriendLink(info.basicId),
        checkedAt: new Date().toISOString(),
      };
      this.emitRuntime();
    } catch (err: unknown) {
      this.deps.onLog(`[line] failed to read account info: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // `to` is any push destination: a userId, or the groupId/roomId of the chat
  // the task was triggered from.
  async sendTaskSuccess(to: string, response: string): Promise<void> {
    const s = this.deps.getStrings();
    await this.push(to, formatLineReply(response, t(s, 'line.msg.emptyResponse')));
  }

  async sendTaskError(to: string, payload: { providerLabel: string; message: string }): Promise<void> {
    const s = this.deps.getStrings();
    const header = t(s, 'line.msg.failed', { provider: payload.providerLabel });
    const text = payload.message ? `${header}\n${payload.message}` : header;
    await this.push(to, text.slice(0, MAX_ERROR_TEXT));
  }

  // Flow `bot` steps need a failed send to surface (step error, emitFailFlag),
  // so these throw where safePush deliberately swallows.
  async sendProactive(userId: string, text: string): Promise<void> {
    const client = this.requireClient();
    await client.pushText(userId, truncateLineText(text));
  }

  async sendProactiveImage(userId: string, imageUrl: string): Promise<void> {
    const client = this.requireClient();
    await client.pushImage(userId, imageUrl);
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

  // Task results always push: the reply token from the triggering message is long
  // expired (~30s) by the time the AI answers.
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

  private async runLocked(work: () => Promise<void>): Promise<void> {
    this.lock = this.lock.then(work, work);
    await this.lock;
  }
}

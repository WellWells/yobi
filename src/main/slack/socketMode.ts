/**
 * Slack's Socket Mode over the WebSocket Node ships: this computer opens the connection with the
 * app-level token, so the app needs no public Request URL. Every envelope is acknowledged at once
 * (Slack retries one left unacknowledged for three seconds). Slack asks for a fresh connection
 * every few hours (`disconnect`), and any drop reconnects with a new URL, backing off; a URL Slack
 * refuses to hand out because the token is wrong stops it for good.
 */
import { openBotWebSocket, type BotWebSocket, type BotWebSocketFactory } from '../botChat/webSocket';

const MAX_BACKOFF_MS = 60_000;

export interface SlackEnvelope {
  envelopeId: string;
  type: string;
  payload: unknown;
  /** Slack sent it again: the first delivery was not acknowledged in time. */
  retried: boolean;
}

export interface SlackSocketOptions {
  /** A fresh WebSocket URL (`apps.connections.open`); a rejection with `fatal` stops reconnecting. */
  openUrl: () => Promise<string>;
  isFatal: (err: unknown) => boolean;
  onEnvelope: (envelope: SlackEnvelope) => void;
  /** The first `hello` of a connection. */
  onConnected: () => void;
  onFatal: (err: unknown) => void;
  onLog: (message: string) => void;
  socketFactory?: BotWebSocketFactory;
}

export class SlackSocketMode {
  private socket: BotWebSocket | null = null;
  private stopped = true;
  private backoffMs = 1_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SlackSocketOptions) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, 'stopped');
    } catch {
      // Already closed.
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let url: string;
    try {
      url = await this.options.openUrl();
    } catch (err: unknown) {
      if (this.options.isFatal(err)) {
        this.stopped = true;
        this.options.onFatal(err);
        return;
      }
      this.options.onLog(`[slack] could not open Socket Mode: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    const socket = (this.options.socketFactory ?? openBotWebSocket)(url);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(socket, event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      this.options.onLog(`[slack] Socket Mode closed (${event.code}) — reconnecting`);
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // The close that follows reconnects.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, wait);
  }

  /** Swaps to a new connection right away (Slack's `disconnect` asks for one). */
  private refresh(socket: BotWebSocket): void {
    if (this.socket === socket) this.socket = null;
    try {
      socket.close(1000, 'refresh');
    } catch {
      // Already closed.
    }
    this.backoffMs = 1_000;
    void this.connect();
  }

  private handleMessage(socket: BotWebSocket, raw: unknown): void {
    let message: { type?: string; envelope_id?: string; payload?: unknown; retry_attempt?: number; reason?: string };
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as typeof message;
    } catch {
      return;
    }
    if (message.type === 'hello') {
      this.backoffMs = 1_000;
      this.options.onConnected();
      return;
    }
    if (message.type === 'disconnect') {
      this.options.onLog(`[slack] Slack asked to reconnect (${message.reason ?? 'no reason'})`);
      this.refresh(socket);
      return;
    }
    if (!message.envelope_id) return;
    try {
      socket.send(JSON.stringify({ envelope_id: message.envelope_id }));
    } catch (err: unknown) {
      this.options.onLog(`[slack] acknowledge failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      this.options.onEnvelope({
        envelopeId: message.envelope_id,
        type: message.type ?? '',
        payload: message.payload,
        retried: (message.retry_attempt ?? 0) > 0,
      });
    } catch (err: unknown) {
      this.options.onLog(`[slack] ${message.type ?? 'envelope'} handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

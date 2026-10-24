/**
 * Discord's gateway (v10, JSON) over the WebSocket Node ships: this computer opens the connection,
 * so the bot needs no public address. Heartbeats at the interval Discord names (a missed ack drops
 * the connection), resumes a dropped session where it can, identifies afresh where it cannot, and
 * stops for good on the close codes Discord says never to retry (a wrong token, intents not
 * allowed) so a bad setting does not loop forever.
 *
 * Intents: guilds, guild messages and direct messages — no privileged one. Discord hands a bot the
 * text of DMs and of messages that mention it without the Message Content intent, and those are
 * the only messages this bot answers.
 */
import { openBotWebSocket, type BotWebSocket, type BotWebSocketFactory } from '../botChat/webSocket';

export const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
export const DISCORD_INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

/** Close codes Discord documents as "do not reconnect". */
export const DISCORD_FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** The session cannot be resumed after these: identify again. */
const SESSION_LOST_CLOSE_CODES: ReadonlySet<number> = new Set([4007, 4009]);
/** Any code but 1000/1001 keeps the session resumable on Discord's side. */
const RECONNECT_CLOSE_CODE = 4000;
const MAX_BACKOFF_MS = 60_000;

export type GatewaySocket = BotWebSocket;
export type GatewaySocketFactory = BotWebSocketFactory;

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export interface DiscordGatewayOptions {
  token: string;
  /** Every dispatch (op 0) by its event name. */
  onDispatch: (type: string, data: unknown) => void;
  /** Connected and identified (READY), or resumed (RESUMED). */
  onConnected: (user?: { id: string; username: string; global_name?: string | null }) => void;
  /** A close Discord says never to retry: the gateway is stopped. */
  onFatal: (code: number, reason: string) => void;
  onLog: (message: string) => void;
  socketFactory?: GatewaySocketFactory;
}

export class DiscordGateway {
  private socket: GatewaySocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private firstBeat: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private acked = true;
  private seq: number | null = null;
  private sessionId = '';
  private resumeUrl = '';
  private stopped = true;
  private backoffMs = 1_000;

  constructor(private readonly options: DiscordGatewayOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    // 1000 ends the session on Discord's side too: nothing to resume after an intended stop.
    try {
      socket?.close(1000, 'stopped');
    } catch {
      // Already closed.
    }
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.firstBeat) clearTimeout(this.firstBeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.firstBeat = null;
    this.reconnectTimer = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const resuming = Boolean(this.sessionId && this.resumeUrl);
    const url = resuming ? `${this.resumeUrl.replace(/\/?$/, '/')}?v=10&encoding=json` : DISCORD_GATEWAY_URL;
    const socket = (this.options.socketFactory ?? openBotWebSocket)(url);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handleClose(event.code, event.reason ?? '');
    };
    socket.onerror = () => {
      // The close that follows decides what happens next.
    };
  }

  private send(payload: GatewayPayload): void {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch (err: unknown) {
      this.options.onLog(`[discord] gateway send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private handleMessage(raw: unknown): void {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as GatewayPayload;
    } catch {
      return;
    }
    if (typeof payload.s === 'number') this.seq = payload.s;
    switch (payload.op) {
      case 10:
        this.startHeartbeat(Number((payload.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval ?? 41_250));
        this.identifyOrResume();
        return;
      case 11:
        this.acked = true;
        return;
      case 1:
        this.beat();
        return;
      case 7:
        this.options.onLog('[discord] gateway asked to reconnect');
        this.dropConnection();
        return;
      case 9:
        if (payload.d !== true) this.clearSession();
        this.options.onLog(`[discord] gateway session invalid${payload.d === true ? ' (resumable)' : ''}`);
        this.dropConnection();
        return;
      case 0:
        this.handleDispatch(payload.t ?? '', payload.d);
        return;
      default:
    }
  }

  private handleDispatch(type: string, data: unknown): void {
    if (type === 'READY') {
      const ready = (data ?? {}) as { session_id?: string; resume_gateway_url?: string; user?: { id: string; username: string; global_name?: string | null } };
      this.sessionId = ready.session_id ?? '';
      this.resumeUrl = ready.resume_gateway_url ?? '';
      this.backoffMs = 1_000;
      this.options.onConnected(ready.user);
    } else if (type === 'RESUMED') {
      this.backoffMs = 1_000;
      this.options.onConnected();
    }
    try {
      this.options.onDispatch(type, data);
    } catch (err: unknown) {
      this.options.onLog(`[discord] ${type} handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private identifyOrResume(): void {
    const { token } = this.options;
    if (this.sessionId && this.seq !== null) {
      this.send({ op: 6, d: { token, session_id: this.sessionId, seq: this.seq } });
      return;
    }
    this.send({
      op: 2,
      d: { token, intents: DISCORD_INTENTS, properties: { os: process.platform, browser: 'Yobi', device: 'Yobi' } },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.firstBeat) clearTimeout(this.firstBeat);
    this.acked = true;
    // Discord asks for the first beat after a random part of the interval, so reconnecting bots do not beat in step.
    this.firstBeat = setTimeout(() => {
      this.beat();
      this.heartbeat = setInterval(() => {
        if (!this.acked) {
          this.options.onLog('[discord] no heartbeat ack — reconnecting');
          this.dropConnection();
          return;
        }
        this.beat();
      }, intervalMs);
    }, Math.floor(intervalMs * Math.random()));
  }

  private beat(): void {
    this.acked = false;
    this.send({ op: 1, d: this.seq });
  }

  private clearSession(): void {
    this.sessionId = '';
    this.resumeUrl = '';
    this.seq = null;
  }

  /** Closes this connection in a way that keeps the session resumable; the close reconnects. */
  private dropConnection(): void {
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(RECONNECT_CLOSE_CODE, 'reconnect');
    } catch {
      // Already closed.
    }
    this.handleClose(RECONNECT_CLOSE_CODE, 'reconnect');
  }

  private handleClose(code: number, reason: string): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.firstBeat) clearTimeout(this.firstBeat);
    this.heartbeat = null;
    this.firstBeat = null;
    if (this.stopped) return;
    if (DISCORD_FATAL_CLOSE_CODES.has(code)) {
      this.stopped = true;
      this.clearSession();
      this.options.onFatal(code, reason);
      return;
    }
    if (SESSION_LOST_CLOSE_CODES.has(code)) this.clearSession();
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.options.onLog(`[discord] gateway closed (${code}${reason ? ` ${reason}` : ''}) — reconnecting in ${Math.round(wait / 1_000)}s`);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }
}

import * as http from 'node:http';
import type { webhook } from '@line/bot-sdk';
import { verifyLineSignature } from './signature';
import { parseTextEvents } from './events';
import type { LineTextEvent } from './events';

// Fixed path the user points their tunnel at: https://<tunnel>/line/webhook
export const LINE_WEBHOOK_PATH = '/line/webhook';

// LINE webhook payloads are small; cap the body to guard against abuse of the
// (signature-protected, loopback-only) endpoint.
const MAX_BODY_BYTES = 1_048_576;
const CLOSE_TIMEOUT_MS = 2_000;

export interface LineWebhookServerDeps {
  getChannelSecret: () => string;
  onEvents: (events: LineTextEvent[]) => void;
  onLog: (message: string) => void;
}

function readRawBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        req.destroy();
        reject(new Error('LINE webhook body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// A local HTTP listener bound to loopback only. The tunnel forwards LINE's POSTs
// here; each request is signature-verified against the raw body before parsing.
export class LineWebhookServer {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly deps: LineWebhookServerDeps) {}

  isListening(): boolean {
    return this.server !== null;
  }

  getPort(): number {
    return this.port;
  }

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => { void this.handle(req, res); });
      const onStartupError = (err: Error): void => {
        this.server = null;
        reject(err);
      };
      server.once('error', onStartupError);
      // Bind to 127.0.0.1 only (never 0.0.0.0): defense in depth on top of the
      // signature check, so the endpoint is not reachable from the LAN.
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onStartupError);
        server.on('error', (err: Error) => this.deps.onLog(`[line] server error: ${err.message}`));
        this.server = server;
        this.port = port;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      server.close(() => done());
      // close() waits for in-flight connections to drain; guard so shutdown
      // never hangs on a lingering keep-alive socket.
      setTimeout(done, CLOSE_TIMEOUT_MS).unref();
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== LINE_WEBHOOK_PATH) {
      res.writeHead(404).end();
      return;
    }
    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req, MAX_BODY_BYTES);
    } catch {
      res.writeHead(413).end();
      return;
    }
    const signatureHeader = req.headers['x-line-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!verifyLineSignature(rawBody, this.deps.getChannelSecret(), signature)) {
      res.writeHead(401).end('invalid signature');
      this.deps.onLog('[line] rejected webhook with invalid signature');
      return;
    }
    // ACK immediately: LINE expects a fast 200 and AI tasks are slow, so events
    // are dispatched after the response is sent. The console "Verify" button
    // sends an empty events array — that passes the signature check and 200s.
    res.writeHead(200).end();
    try {
      const body = JSON.parse(rawBody.toString('utf8')) as webhook.CallbackRequest;
      const events = parseTextEvents(body);
      if (events.length > 0) this.deps.onEvents(events);
    } catch (err: unknown) {
      this.deps.onLog(`[line] failed to parse webhook body: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

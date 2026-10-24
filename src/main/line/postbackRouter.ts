/**
 * Taps on LINE postback buttons. A button's data is `<prefix>:<payload>`; each feature registers
 * its own prefix and gets the payload of its buttons, so a new kind of card adds a handler instead
 * of growing a switch. The data comes back from the tapping client as it likes — a handler checks
 * who tapped and what the payload names every time, and anything unrecognised is only logged.
 *
 * A postback carries a reply token: answering through it is free, a push costs the owner's monthly
 * LINE quota, so handlers answer with `replyByToken` and never fall back to a push.
 */
import type { messagingApi } from '@line/bot-sdk';
import type { LineClient } from './client';
import type { LinePostbackEvent } from './events';

/** LINE's limit on a postback action's `data`. */
export const LINE_POSTBACK_DATA_MAX = 300;

const PREFIX_PATTERN = /^[a-z][a-z0-9]{0,7}$/;

/** Handles one tap; `payload` is the data after `<prefix>:`. */
export type LinePostbackHandler = (event: LinePostbackEvent, payload: string) => Promise<void>;

/** A button's data for this prefix; throws for anything LINE would refuse, so no dead button is sent. */
export function linePostbackData(prefix: string, payload: string): string {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error(`Invalid LINE postback prefix: ${prefix}`);
  const data = `${prefix}:${payload}`;
  if (data.length > LINE_POSTBACK_DATA_MAX) throw new Error(`LINE postback data over ${LINE_POSTBACK_DATA_MAX} characters`);
  return data;
}

export interface LinePostbackRouterDeps {
  onLog: (message: string) => void;
  /** Blocked by the owner: their taps are ignored like their messages. */
  isBlocked?: (userId: string) => boolean;
}

export class LinePostbackRouter {
  private readonly handlers = new Map<string, LinePostbackHandler>();

  constructor(private readonly deps: LinePostbackRouterDeps) {}

  register(prefix: string, handler: LinePostbackHandler): void {
    if (!PREFIX_PATTERN.test(prefix)) throw new Error(`Invalid LINE postback prefix: ${prefix}`);
    if (this.handlers.has(prefix)) throw new Error(`LINE postback prefix already registered: ${prefix}`);
    this.handlers.set(prefix, handler);
  }

  async dispatch(events: readonly LinePostbackEvent[]): Promise<void> {
    for (const event of events) {
      if (this.deps.isBlocked?.(event.userId)) {
        this.deps.onLog(`[line] postback from blocked user ${event.userId} — ignored`);
        continue;
      }
      const handled = this.route(event);
      if (!handled) continue;
      try {
        await handled.handler(event, handled.payload);
      } catch (err: unknown) {
        this.deps.onLog(`[line] postback "${handled.prefix}" failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private route(event: LinePostbackEvent): { prefix: string; payload: string; handler: LinePostbackHandler } | null {
    const { data } = event;
    const colon = data.indexOf(':');
    const prefix = colon > 0 ? data.slice(0, colon) : '';
    const handler = prefix ? this.handlers.get(prefix) : undefined;
    if (!handler || data.length > LINE_POSTBACK_DATA_MAX) {
      this.deps.onLog(`[line] postback from ${event.userId} with unrecognised data (${data.length} chars) — ignored`);
      return null;
    }
    return { prefix, payload: data.slice(colon + 1), handler };
  }
}

/**
 * Answers an event through its reply token: a text or a Flex message. Without a token, or when
 * LINE refuses the reply (an expired token), it logs and returns false — it does not push.
 */
export async function replyByToken(
  client: LineClient | null,
  replyToken: string | undefined,
  message: string | messagingApi.FlexMessage,
  onLog: (message: string) => void,
): Promise<boolean> {
  if (!client || !replyToken) {
    onLog(`[line] reply skipped — ${client ? 'no reply token' : 'client not ready'}`);
    return false;
  }
  try {
    if (typeof message === 'string') await client.replyText(replyToken, message);
    else await client.replyFlex(replyToken, message);
    return true;
  } catch (err: unknown) {
    onLog(`[line] reply failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

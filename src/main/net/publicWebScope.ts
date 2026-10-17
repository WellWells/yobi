import { AsyncLocalStorage } from 'node:async_hooks';
import * as net from 'node:net';
import { BlockedAddressError, assertPublicHttpUrl, isBlockedAddress } from './ssrfGuard';

/**
 * Work started by a Telegram/LINE message reads the public web only.
 *
 * A group can grant `web` to everyone in it, unpaired strangers included, so a bot-origin page read
 * must never reach this computer or its local network (the router, a NAS, the LINE webhook and MCP
 * OAuth listeners on 127.0.0.1) and post what it found to the chat. The flag rides the async
 * context of the bot run, so every page load and raw fetch underneath it — the agent's tools,
 * helpers and batches, the pasted-link shortcut — checks it without each caller passing it down.
 * Work started at the desktop never enters the scope and reads what it always read.
 */
const scope = new AsyncLocalStorage<boolean>();

export function withPublicWebOnly<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run(true, fn);
}

/** `fn` inside the scope when `on`, as it is otherwise. */
export function publicWebOnlyIf<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  return on ? withPublicWebOnly(fn) : fn();
}

export function isPublicWebOnly(): boolean {
  return scope.getStore() === true;
}

/** Model-facing: the agent reads it as the tool's observation. */
export const PRIVATE_ADDRESS_REFUSAL =
  'This address is on this computer or a local network, and pages there are never read for a chat-app message. Do not retry it or another local address; tell the user it cannot be read from here.';

export class PrivateAddressRefusedError extends Error {
  constructor(readonly url: string) {
    super(`${PRIVATE_ADDRESS_REFUSAL} (${url})`);
    this.name = 'PrivateAddressRefusedError';
  }
}

/** `assertPublicHttpUrl`, a private destination reported as the refusal. */
export async function assertPublicWebUrl(url: string): Promise<void> {
  try {
    await assertPublicHttpUrl(url);
  } catch (err) {
    if (err instanceof BlockedAddressError) throw new PrivateAddressRefusedError(url);
    throw err;
  }
}

const LOCAL_HOST_NAMES = /(?:^|\.)localhost\.?$/;

/**
 * The synchronous half of the check, for hooks that cannot wait for DNS (`will-redirect`): an
 * address literal in a private range, or a `localhost` name.
 */
export function assertPublicHostLiteral(host: string, url: string): void {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOCAL_HOST_NAMES.test(bare)) throw new PrivateAddressRefusedError(url);
  if (net.isIP(bare) && isBlockedAddress(bare)) throw new PrivateAddressRefusedError(url);
}

const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);
// Schemes that never leave the process: the page's own inline data and blank frames.
const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

/**
 * Whether a page window loaded for a bot message may make this request: every request of the
 * window, the top-level navigation and each of its redirect hops as well as scripts, XHR and
 * WebSockets (a WebSocket is not bound by the same-origin policy, so a hostile page could read a
 * local listener through one and write it into the DOM we serialize). Each host is resolved once
 * per window; a host that does not resolve is refused, since the request would fail anyway.
 */
export function createPublicRequestCheck(): (url: string) => Promise<boolean> {
  const verdicts = new Map<string, Promise<boolean>>();
  return (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return Promise.resolve(false);
    }
    if (LOCAL_SCHEMES.has(parsed.protocol)) return Promise.resolve(true);
    if (!NETWORK_SCHEMES.has(parsed.protocol)) return Promise.resolve(false);
    let verdict = verdicts.get(parsed.host);
    if (!verdict) {
      verdict = assertPublicHttpUrl(`http://${parsed.host}/`).then(() => true, () => false);
      verdicts.set(parsed.host, verdict);
    }
    return verdict;
  };
}

/** One hop of a raw request: the answer, or where the server sent it instead. */
export type RawHop<R> = { response: R } | { redirectTo: string; method: string };

const MAX_PUBLIC_REDIRECTS = 10;

/**
 * Follows a raw request's redirects itself, resolving each hop before it is requested: Electron's
 * `redirect` event must be answered synchronously, which leaves no room for a DNS lookup.
 * `validateRedirectHost` (a caller's own site pin) still sees every hop. `request` gets the method
 * Chromium would use for the hop, so a 303 turns a POST into a GET as it would have.
 */
export async function followPublicRedirects<R>(
  url: string,
  validateRedirectHost: ((host: string) => void) | undefined,
  request: (url: string, method: string) => Promise<RawHop<R>>,
): Promise<{ response: R; finalUrl: string }> {
  let current = url;
  let method = '';
  for (let hop = 0; hop <= MAX_PUBLIC_REDIRECTS; hop++) {
    await assertPublicWebUrl(current);
    const result = await request(current, method);
    if ('response' in result) return { response: result.response, finalUrl: current };
    validateRedirectHost?.(new URL(result.redirectTo).hostname.toLowerCase());
    current = result.redirectTo;
    method = result.method;
  }
  throw new Error('Too many redirects');
}

import { StreamHttpError, StreamRefusedError } from './streamTypes';

/*
 * Every request of a segmented download goes through here: https only, on the hosts the site
 * allows, redirects followed by hand and checked the same way (a CDN's signed redirect may not
 * leave the site's hosts), the site's headers on each request, the step's Stop on each request.
 * The fetch itself is the caller's (Node's `fetch` by default, as the post readers' media
 * downloads use; a site whose media only its session may fetch hands in that session's fetch).
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Whether a host may be asked: exact names and their subdomains, see `hostAllowlist`. */
export type HostAllowlist = (host: string) => boolean;

export interface StreamRequestOptions {
  isAllowedHost: HostAllowlist;
  /** Sent with every request (Referer, a session's cookie header for a locked CDN…). */
  headers?: Readonly<Record<string, string>>;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

/** No answer (headers) in this long: the request is given up. */
export const RESPONSE_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/** `['vimeocdn.com', 'akamaized.net']` → those hosts and any subdomain of them. */
export function hostAllowlist(domains: readonly string[]): HostAllowlist {
  const names = domains.map((d) => d.toLowerCase().replace(/^\.+/, ''));
  return (host) => {
    const h = host.toLowerCase();
    return names.some((name) => h === name || h.endsWith(`.${name}`));
  };
}

/** The URL, checked: https, no credentials, no port of its own, a host the site allows. Throws otherwise. */
export function assertStreamUrl(url: string, isAllowedHost: HostAllowlist): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new StreamRefusedError('Refused a stream URL that does not parse');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new StreamRefusedError(`Refused ${parsed.protocol}//${parsed.host}: not a plain https URL`);
  }
  if (!isAllowedHost(parsed.hostname)) throw new StreamRefusedError(`Refused ${parsed.hostname}: not one of the site's hosts`);
  return parsed;
}

export interface StreamRequestInit {
  method?: 'GET' | 'HEAD';
  /** `Range: bytes=…`; a 206 is then expected. */
  range?: { offset: number; length?: number };
  /** Aborts the request beyond the caller's signal (a stall timer). */
  signal?: AbortSignal;
}

function rangeHeader(range: NonNullable<StreamRequestInit['range']>): string {
  return `bytes=${range.offset}-${range.length !== undefined ? range.offset + range.length - 1 : ''}`;
}

/**
 * One request, its redirects followed by hand and each target checked. Resolves with the final
 * response, which may be an error status (the caller reads it); rejects with `StreamRefusedError`
 * for a refused URL or redirect, `StreamHttpError` (status 0) when nothing answers in time, and
 * with the abort reason on Stop.
 */
export async function streamRequest(url: string, options: StreamRequestOptions, init: StreamRequestInit = {}): Promise<{ response: Response; finalUrl: string }> {
  const fetchFn = options.fetch ?? fetch;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertStreamUrl(current, options.isAllowedHost);
    // The timer covers waiting for the answer only: the body of a large file takes as long as it takes.
    const unanswered = new AbortController();
    const timer = setTimeout(() => unanswered.abort(new StreamHttpError(`No answer within ${RESPONSE_TIMEOUT_MS / 1_000} s`, 0)), RESPONSE_TIMEOUT_MS);
    const signals = [unanswered.signal, ...(options.signal ? [options.signal] : []), ...(init.signal ? [init.signal] : [])];
    let response: Response;
    try {
      response = await fetchFn(current, {
        method: init.method ?? 'GET',
        redirect: 'manual',
        headers: { ...options.headers, ...(init.range ? { Range: rangeHeader(init.range) } : {}) },
        signal: AbortSignal.any(signals),
      });
    } finally {
      clearTimeout(timer);
    }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status > 399 || !location) return { response, finalUrl: current };
    await response.body?.cancel().catch(() => {});
    current = new URL(location, current).toString();
  }
  throw new StreamRefusedError(`More than ${MAX_REDIRECTS} redirects`);
}

/** Reads a playlist or manifest: its text and where it came from (the base for relative URIs). */
export async function fetchStreamText(url: string, options: StreamRequestOptions, maxBytes = 8_000_000): Promise<{ text: string; finalUrl: string }> {
  const { response, finalUrl } = await streamRequest(url, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new StreamHttpError(`HTTP ${response.status} for ${new URL(finalUrl).hostname}`, response.status);
  }
  const length = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new StreamHttpError(`The playlist is over ${maxBytes} bytes`, response.status);
  }
  return { text: await boundedText(response, maxBytes), finalUrl };
}

/** The body as text, read no further than `maxBytes`: a server that names no length may send without end. */
async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    // Leaving the loop cancels the body.
    if (size > maxBytes) throw new StreamHttpError(`The playlist is over ${maxBytes} bytes`, response.status);
    parts.push(chunk);
  }
  // TextDecoder drops a leading BOM, as `Response.text()` does.
  return new TextDecoder().decode(Buffer.concat(parts));
}

/** A file's size from a HEAD's Content-Length; null when the server does not say or refuses. Stop still throws. */
export async function contentLength(url: string, options: StreamRequestOptions): Promise<number | null> {
  try {
    const { response } = await streamRequest(url, options, { method: 'HEAD' });
    await response.body?.cancel().catch(() => {});
    const length = Number(response.headers.get('content-length') ?? '');
    return response.ok && Number.isFinite(length) && length > 0 ? length : null;
  } catch (err) {
    options.signal?.throwIfAborted();
    if (err instanceof StreamRefusedError) throw err;
    return null;
  }
}

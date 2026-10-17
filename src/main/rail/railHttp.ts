/**
 * The one way the rail sources talk to the network. Every source takes a `FetchFn`; the hosts are
 * fixed (TDX, TRA, THSR), never user input.
 */
import { userAgentForUrl } from '../userAgent';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const RAIL_TIMEOUT_MS = 20_000;

/** TDX rejects curl's default headers; all three sites answer a browser's. */
export function browserHeaders(url: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': userAgentForUrl(url),
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    ...extra,
  };
}

export class RailHttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.name = 'RailHttpError';
  }
}

/** A request that gives up after `RAIL_TIMEOUT_MS`, or sooner when `signal` aborts. */
export async function railFetch(fetchFn: FetchFn, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(RAIL_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetchFn(url, { ...init, signal: combined });
}

export async function railText(fetchFn: FetchFn, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<string> {
  const res = await railFetch(fetchFn, url, init, signal);
  if (!res.ok) throw new RailHttpError(res.status, url);
  return res.text();
}

export async function railJson(fetchFn: FetchFn, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
  return JSON.parse(await railText(fetchFn, url, init, signal)) as unknown;
}

/**
 * Requests to TDX (the Transport Data eXchange of Taiwan's MOTC), only with the user's own Client
 * ID/Secret: a bearer token (one day, from the token endpoint, itself limited to 20 calls a minute
 * per IP) is fetched once and reused. Without a key nothing is sent — TDX's visitor allowance (20
 * calls a day per IP, shared by everything on that IP) is never used: the user, 2026-10-22, "太不穩
 * 定了" after that day's probes and self-tests used it up and every TDX step answered 429. Yobi
 * never ships a key of its own either: points may not be passed to anyone else.
 */
import { browserHeaders, railFetch } from './railHttp';
import type { FetchFn } from './railHttp';
import type { TdxQuota } from './quota';

const TDX_API = 'https://tdx.transportdata.tw/api/basic/';
const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TOKEN_MARGIN_MS = 5 * 60_000;

export interface TdxCredentials {
  clientId: string;
  clientSecret: string;
}

export type TdxResult = { status: 200; body: unknown; lastModified?: string } | { status: 304 };

/** Today's TDX allowance is used up (or TDX said 429); the answer falls back to timetables. */
export class TdxQuotaError extends Error {
  constructor() {
    super('TDX daily allowance used up');
    this.name = 'TdxQuotaError';
  }
}

/** No TDX key is set, so TDX is not asked at all; the answer comes from the operators' own sites. */
export class TdxNoKeyError extends Error {
  constructor() {
    super('needs a TDX key (Settings → Connectors → Taiwan Rail); Yobi does not use TDX without one');
    this.name = 'TdxNoKeyError';
  }
}

export function hasTdxKey(credentials: TdxCredentials | null): credentials is TdxCredentials {
  return Boolean(credentials?.clientId && credentials.clientSecret);
}

export interface TdxClientOptions {
  fetchFn: FetchFn;
  credentials: () => TdxCredentials | null;
  quota: TdxQuota;
  now: () => number;
}

export class TdxClient {
  private token: { value: string; expiresAt: number; clientId: string } | null = null;

  constructor(private readonly opts: TdxClientOptions) {}

  /** Whether a key is set now: callers skip TDX entirely, and say so, when it is not. */
  hasKey(): boolean {
    return hasTdxKey(this.opts.credentials());
  }

  private async bearer(signal?: AbortSignal): Promise<string> {
    const creds = this.opts.credentials();
    if (!hasTdxKey(creds)) {
      this.token = null;
      throw new TdxNoKeyError();
    }
    if (this.token && this.token.clientId === creds.clientId && this.token.expiresAt - TOKEN_MARGIN_MS > this.opts.now()) {
      return this.token.value;
    }
    const res = await railFetch(this.opts.fetchFn, TOKEN_URL, {
      method: 'POST',
      headers: browserHeaders(TOKEN_URL, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }).toString(),
    }, signal);
    if (!res.ok) throw new Error(`TDX rejected the key (HTTP ${res.status})`);
    const body = await res.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('TDX token response had no access_token');
    const lifetime = typeof body.expires_in === 'number' ? body.expires_in * 1_000 : 86_400_000;
    this.token = { value: body.access_token, expiresAt: this.opts.now() + lifetime, clientId: creds.clientId };
    return this.token.value;
  }

  /**
   * GET `path` (e.g. `v2/Rail/TRA/LiveTrainDelay`) as JSON; `ifModifiedSince` may answer 304.
   * Throws `TdxNoKeyError` without sending anything when no key is set.
   */
  async get(path: string, opts: { ifModifiedSince?: string; signal?: AbortSignal } = {}): Promise<TdxResult> {
    if (!this.hasKey()) throw new TdxNoKeyError();
    if (this.opts.quota.exhausted()) throw new TdxQuotaError();
    const url = new URL(path, TDX_API);
    url.searchParams.set('$format', 'JSON');
    const token = await this.bearer(opts.signal);
    const headers = browserHeaders(url.toString(), {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.ifModifiedSince ? { 'If-Modified-Since': opts.ifModifiedSince } : {}),
    });
    const res = await railFetch(this.opts.fetchFn, url.toString(), { headers }, opts.signal);
    // A 304 reports a counter of its own, so only other answers say what is left.
    if (res.status === 304) return { status: 304 };
    this.opts.quota.observe(res.headers, res.status);
    if (res.status === 429) throw new TdxQuotaError();
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new Error(`TDX answered HTTP ${res.status} for ${path}`);
    const lastModified = res.headers.get('last-modified') ?? undefined;
    return { status: 200, body: await res.json() as unknown, ...(lastModified ? { lastModified } : {}) };
  }
}

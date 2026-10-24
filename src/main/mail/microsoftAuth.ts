/**
 * Microsoft sign-in for mail: the browser round trip (authorization code with PKCE on a loopback
 * port) and the tokens after it. Yobi is a public client, so there is no secret: the PKCE verifier
 * proves the code was asked for by this run. The refresh token is the mailbox's stored secret (its
 * `password` field, encrypted like every password); access tokens live in memory only.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  MICROSOFT_AUTHORIZE_URL, MICROSOFT_CONSUMER_TENANT, MICROSOFT_MAIL_SCOPES, MICROSOFT_TOKEN_URL,
} from '../../shared/microsoftMail';

/** Long enough to sign in and approve on a phone, short enough that a forgotten tab does not hang. */
export const MICROSOFT_SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** An access token this close to expiry is renewed first: a mail call can take a while to start. */
export const ACCESS_TOKEN_MARGIN_MS = 2 * 60_000;

/** Why a sign-in or a renewal failed, for callers that word it themselves. */
export type MicrosoftAuthProblem = 'cancelled' | 'expired' | 'noAddress' | 'failed';

export class MicrosoftAuthError extends Error {
  constructor(message: string, readonly reason: MicrosoftAuthProblem) {
    super(message);
    this.name = 'MicrosoftAuthError';
  }
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  idToken?: string;
}

export interface MicrosoftIdentity {
  address: string;
  /** Outlook.com / Hotmail / Live, as opposed to a work or school (Microsoft 365) account. */
  personal: boolean;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function authorizeUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
  const url = new URL(MICROSOFT_AUTHORIZE_URL);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', MICROSOFT_MAIL_SCOPES.join(' '));
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Always offer the account chooser: the user may be adding a second mailbox.
  url.searchParams.set('prompt', 'select_account');
  if (args.loginHint) url.searchParams.set('login_hint', args.loginHint);
  return url.toString();
}

/**
 * The address and kind of account from the id token. It came straight from Microsoft's token
 * endpoint over TLS, so it is read, not verified.
 */
export function identityFromIdToken(idToken: string | undefined): MicrosoftIdentity | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const candidates = [claims.email, claims.preferred_username].filter((value): value is string => typeof value === 'string');
    const address = candidates.map((value) => value.trim()).find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    if (!address) return null;
    return { address, personal: claims.tid === MICROSOFT_CONSUMER_TENANT };
  } catch {
    return null;
  }
}

async function tokenRequest(fetch: FetchLike, form: Record<string, string>, now: () => number): Promise<MicrosoftTokens> {
  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== 'string') {
    const code = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    const description = typeof body.error_description === 'string' ? body.error_description.split('\r\n')[0] : '';
    // The refresh token was revoked, expired or the password changed: only signing in again helps.
    const reason: MicrosoftAuthProblem = code === 'invalid_grant' || code === 'interaction_required' ? 'expired' : 'failed';
    throw new MicrosoftAuthError(`Microsoft sign-in: ${code}${description ? ` — ${description}` : ''}`, reason);
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : form.refresh_token ?? '',
    expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3_600) * 1_000,
    ...(typeof body.id_token === 'string' ? { idToken: body.id_token } : {}),
  };
}

export function exchangeCode(fetch: FetchLike, args: { clientId: string; code: string; verifier: string; redirectUri: string }, now: () => number = Date.now): Promise<MicrosoftTokens> {
  return tokenRequest(fetch, {
    client_id: args.clientId,
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
    scope: MICROSOFT_MAIL_SCOPES.join(' '),
  }, now);
}

export function refreshTokens(fetch: FetchLike, args: { clientId: string; refreshToken: string }, now: () => number = Date.now): Promise<MicrosoftTokens> {
  return tokenRequest(fetch, {
    client_id: args.clientId,
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    scope: MICROSOFT_MAIL_SCOPES.join(' '),
  }, now);
}

export interface LoopbackServer {
  redirectUri: string;
  waitForCode(state: string, timeoutMs: number): Promise<string>;
  close(): void;
}

export interface MicrosoftSignInDeps {
  clientId: string;
  /** The loopback server; its redirect URI is rewritten to the registered host. */
  startServer: () => Promise<LoopbackServer>;
  openBrowser: (url: string) => Promise<void>;
  fetch: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** Microsoft registers `http://localhost/...`; the loopback server answers on 127.0.0.1. */
export function registeredRedirect(serverRedirect: string): string {
  const url = new URL(serverRedirect);
  url.hostname = 'localhost';
  return url.toString();
}

/** Opens Microsoft's sign-in page and returns the tokens and the mailbox the user picked. */
export async function signInWithMicrosoft(deps: MicrosoftSignInDeps, loginHint?: string): Promise<{ tokens: MicrosoftTokens; identity: MicrosoftIdentity }> {
  const server = await deps.startServer();
  try {
    const redirectUri = registeredRedirect(server.redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(16));
    const waiting = server.waitForCode(state, deps.timeoutMs ?? MICROSOFT_SIGN_IN_TIMEOUT_MS);
    // If the browser cannot open, `close()` below rejects the wait nobody awaits any more.
    waiting.catch(() => {});
    await deps.openBrowser(authorizeUrl({ clientId: deps.clientId, redirectUri, state, challenge, ...(loginHint ? { loginHint } : {}) }));
    const code = await waiting;
    const tokens = await exchangeCode(deps.fetch, { clientId: deps.clientId, code, verifier, redirectUri }, deps.now);
    if (!tokens.refreshToken) throw new MicrosoftAuthError('Microsoft sign-in: no refresh token was issued', 'failed');
    const identity = identityFromIdToken(tokens.idToken);
    if (!identity) throw new MicrosoftAuthError('Microsoft sign-in: the account has no mail address', 'noAddress');
    return { tokens, identity };
  } finally {
    server.close();
  }
}

export interface TokenSourceDeps {
  clientId: () => string;
  fetch: FetchLike;
  now: () => number;
  /**
   * Stores a rotated refresh token as the mailbox's secret — only while the mailbox still holds
   * `previous`. A renewal takes a round trip; meanwhile the user may have signed in again or turned
   * the mailbox into a password one, and the late answer must not overwrite that.
   */
  saveRefreshToken: (accountId: string, previous: string, refreshToken: string) => void;
  /** `previous` no longer works: forget it (same rule) so the card asks to sign in again. */
  forgetRefreshToken: (accountId: string, previous: string) => void;
}

interface CachedToken {
  /** The refresh token stored for the account when this access token was current. */
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

/**
 * Access tokens per mailbox, renewed from the stored refresh token when close to expiry. Microsoft
 * rotates refresh tokens, so each renewal stores the new one. Calls that arrive together share one
 * renewal (two renewals racing would each rotate, and one stored token would already be spent).
 */
export function createMicrosoftTokenSource(deps: TokenSourceDeps) {
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, Promise<string>>();

  async function renew(accountId: string, address: string, refreshToken: string): Promise<string> {
    try {
      const tokens = await refreshTokens(deps.fetch, { clientId: deps.clientId(), refreshToken }, deps.now);
      if (tokens.refreshToken !== refreshToken) deps.saveRefreshToken(accountId, refreshToken, tokens.refreshToken);
      cache.set(accountId, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof MicrosoftAuthError && err.reason === 'expired') {
        if (cache.get(accountId)?.refreshToken === refreshToken) cache.delete(accountId);
        deps.forgetRefreshToken(accountId, refreshToken);
        throw new MicrosoftAuthError(
          `The Microsoft sign-in for ${address} has expired; the user signs in again in Settings › Connectors › Mail`,
          'expired',
        );
      }
      throw err;
    }
  }

  return {
    async accessToken(account: { id: string; address: string; password: string }): Promise<string> {
      if (!account.password) {
        throw new MicrosoftAuthError(`${account.address} is not signed in to Microsoft; the user signs in in Settings › Connectors › Mail`, 'expired');
      }
      const cached = cache.get(account.id);
      if (cached && cached.refreshToken === account.password && cached.expiresAt - ACCESS_TOKEN_MARGIN_MS > deps.now()) return cached.accessToken;
      // Keyed by the refresh token too: a call made after signing in again must not join the
      // renewal of the token it replaced.
      const key = `${account.id}\n${account.password}`;
      const running = inflight.get(key);
      if (running) return running;
      const next = renew(account.id, account.address, account.password).finally(() => inflight.delete(key));
      inflight.set(key, next);
      return next;
    },
    /** The mailbox was removed or signed in again. */
    forget(accountId: string): void {
      cache.delete(accountId);
    },
  };
}

export type MicrosoftTokenSource = ReturnType<typeof createMicrosoftTokenSource>;

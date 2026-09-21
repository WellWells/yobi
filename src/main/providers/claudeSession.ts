import type { Cookie } from 'electron';
import { isExpiredCookie } from '../helpers';

export const CLAUDE_LOGIN_URL = 'https://claude.ai/login';
export const CLAUDE_LOGIN_REQUIRED = 'CLAUDE_LOGIN_REQUIRED';

/** The signed-in session: `sessionKey` on `.claude.ai`, an `sk-ant-sid…` value, httpOnly. */
const CLAUDE_SESSION_COOKIE = 'sessionKey';

export function isClaudeSessionCookie(cookie: Cookie): boolean {
  return cookie.name === CLAUDE_SESSION_COOKIE && Boolean(cookie.value) && !isExpiredCookie(cookie.expirationDate);
}

/**
 * claude.ai bounces a signed-out visitor from `/new` through `/logout?involuntary=1` to `/login`,
 * so landing on either path means the session is gone even if a stale cookie is still stored.
 */
export function isClaudeSignedOutPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /^\/(login|logout)(\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

export function isClaudeLoginRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes(CLAUDE_LOGIN_REQUIRED);
}

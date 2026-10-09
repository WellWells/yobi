import type { Cookie, Session } from 'electron';
import { isExpiredCookie } from '../helpers';
import { PROVIDER_URLS } from '../../shared/types';

// Signed-in session cookies (legacy and current names); anonymous visitors get neither.
const PERPLEXITY_SESSION_COOKIE_PREFIXES = [
  '__Secure-next-auth.session-token',
  '__Secure-pplx.session.',
] as const;

/** Shared by the account panel and the visitor wipe; they must agree or a signed-in session gets wiped. */
export function isPerplexitySessionCookie(cookie: Cookie): boolean {
  return (
    PERPLEXITY_SESSION_COOKIE_PREFIXES.some((prefix) => cookie.name.startsWith(prefix)) &&
    Boolean(cookie.value) &&
    !isExpiredCookie(cookie.expirationDate)
  );
}

export async function isPerplexitySignedIn(ses: Session): Promise<boolean> {
  const cookies = await ses.cookies.get({ url: PROVIDER_URLS.perplexity });
  return cookies.some(isPerplexitySessionCookie);
}

import { CHATGPT_INPUT_SELECTORS } from './chatgptSendScript';

export interface ChatgptAuthSignals {
  hasSessionCookie: boolean;
  hasLogoutDebugCookie: boolean;
}

export interface ChatgptPageSignals {
  isAuthHost: boolean;
  hasComposer: boolean;
  /** The page's own session endpoint answered, without an access token. */
  sessionSignedOut: boolean;
}

const SESSION_TIMEOUT_MS = 5_000;

/*
 * Read in the page, never from its words (they follow the account's language). Signed out or
 * expired, `/api/auth/session` answers without an `accessToken`; a fetch that fails, an error
 * status or a body that is not JSON says nothing, so a network blip is not "signed out".
 */
export const CHATGPT_PAGE_SIGNALS_JS = `(async () => {
  const host = (location.hostname || '').toLowerCase();
  const isAuthHost = host.includes('auth.openai.com');
  const hasComposer = Boolean(document.querySelector(${JSON.stringify(CHATGPT_INPUT_SELECTORS.join(', '))}));
  let sessionSignedOut = false;
  if (!isAuthHost) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${SESSION_TIMEOUT_MS});
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (res.ok) {
        const session = await res.json();
        sessionSignedOut = !(session && typeof session === 'object' && session.accessToken);
      }
    } catch (e) {
      sessionSignedOut = false;
    } finally {
      clearTimeout(timer);
    }
  }
  return { isAuthHost, hasComposer, sessionSignedOut };
})()`;

export function isLoginRequiredFromSignals(auth: ChatgptAuthSignals, page: ChatgptPageSignals): boolean {
  if (!auth.hasSessionCookie) return true;
  if (page.isAuthHost || page.sessionSignedOut) return true;
  return auth.hasLogoutDebugCookie && !page.hasComposer;
}

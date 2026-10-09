import type { WebContents } from 'electron';
import { sendLog } from '../helpers';
import { loadURLFollowingIdentity } from '../navigationIdentity';

/** Where a ChatGPT sign-in starts: a small same-origin JSON page the sign-in script runs on. */
export const CHATGPT_SIGN_IN_START_URL = 'https://chatgpt.com/api/auth/csrf';

/** chatgpt.com's own login page, for when the direct start fails. */
export const CHATGPT_LOGIN_PAGE_URL = 'https://chatgpt.com/auth/login_with?callback_path=/';

const AUTHORIZE_ORIGIN = 'https://auth.openai.com/';

/** Starts the sign-in from the current page. Resolves true once it is heading to the authorize URL. */
export const CHATGPT_SIGN_IN_JS = `(async () => {
  try {
    const csrf = await (await fetch('/api/auth/csrf', { credentials: 'include' })).json();
    if (!csrf || typeof csrf.csrfToken !== 'string' || !csrf.csrfToken) return false;
    const res = await fetch('/api/auth/signin/openai?prompt=login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ callbackUrl: '/', csrfToken: csrf.csrfToken, json: 'true' }).toString(),
    });
    const data = await res.json();
    const url = data && data.url;
    if (typeof url !== 'string' || url.indexOf(${JSON.stringify(AUTHORIZE_ORIGIN)}) !== 0) return false;
    location.assign(url);
    return true;
  } catch (err) {
    return false;
  }
})()`;

/** Runs on a page already at CHATGPT_SIGN_IN_START_URL; falls back to chatgpt.com's login page. */
export async function startChatgptSignIn(wc: WebContents): Promise<void> {
  let started = false;
  try {
    started = (await wc.executeJavaScript(CHATGPT_SIGN_IN_JS, true)) === true;
  } catch {
  }
  if (started || wc.isDestroyed()) return;
  sendLog("⚠️ ChatGPT sign-in did not start directly — opening chatgpt.com's login page instead");
  try {
    await loadURLFollowingIdentity(wc, CHATGPT_LOGIN_PAGE_URL);
  } catch {
    // The page itself shows what failed; the sign-in window stays open either way.
  }
}

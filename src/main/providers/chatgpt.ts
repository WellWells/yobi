import type { BrowserWindow } from 'electron';
import { sleep, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { ensureOnPage, PAGE_REUSE } from './pageReuse';
import { executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import { isExpiredCookie, sendLog } from '../helpers';
import { showLoginWindowIfNeeded } from '../windows';
import { PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_SUBMIT_JS } from './chatgptSendScript';
import { CHATGPT_READ_JS, cleanChatgptTitle } from './chatgptReadScript';
import { uploadFilesToChatgpt } from './chatgptUpload';
import { syncChatgptModel } from './chatgptModelSync';

const CHATGPT_HOME = PROVIDER_URLS.chatgpt;
export const CHATGPT_LOGIN_URL = 'https://auth.openai.com/log-in-or-create-account';
const CHATGPT_LOGIN_REQUIRED = 'CHATGPT_LOGIN_REQUIRED';
const CHATGPT_SESSION_COOKIE_PREFIX = '__Secure-next-auth.session-token';
const CHATGPT_LOGOUT_DEBUG_COOKIE = 'oai-logout-debug-context';

export function isChatgptLoginRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes(CHATGPT_LOGIN_REQUIRED) ||
    msg.includes('ChatGPT input area not found') ||
    msg.includes('Timeout waiting for: ChatGPT input area') ||
    msg.includes('ChatGPT page indicates logged-out state')
  );
}

async function getChatgptCookies(workerWin: BrowserWindow) {
  const cookieCandidates = await Promise.all([
    workerWin.webContents.session.cookies.get({ url: CHATGPT_HOME }),
    workerWin.webContents.session.cookies.get({ url: CHATGPT_LOGIN_URL }),
    workerWin.webContents.session.cookies.get({ url: 'https://chat.openai.com/' }),
  ]);
  return cookieCandidates.flat();
}

async function getChatgptAuthSignals(workerWin: BrowserWindow): Promise<{
  hasSessionCookie: boolean;
  hasLogoutDebugCookie: boolean;
}> {
  const cookies = await getChatgptCookies(workerWin);
  const hasSessionCookie = cookies.some(
    (cookie) =>
      cookie.name.startsWith(CHATGPT_SESSION_COOKIE_PREFIX) &&
      !isExpiredCookie(cookie.expirationDate),
  );
  const hasLogoutDebugCookie = cookies.some(
    (cookie) =>
      cookie.name === CHATGPT_LOGOUT_DEBUG_COOKIE &&
      !isExpiredCookie(cookie.expirationDate),
  );
  return { hasSessionCookie, hasLogoutDebugCookie };
}

async function getChatgptPageSignals(workerWin: BrowserWindow): Promise<{
  isAuthHost: boolean;
  hasComposer: boolean;
  hasLoginCta: boolean;
  hasExpiredSessionModalHint: boolean;
}> {
  return await workerWin.webContents.executeJavaScript(`
    (() => {
      const host = (location.hostname || '').toLowerCase();
      const isAuthHost = host.includes('auth.openai.com');
      const hasComposer = Boolean(
        document.querySelector('#prompt-textarea[contenteditable="true"]') ||
        document.querySelector('form[data-type="unified-composer"] #prompt-textarea'),
      );
      const ctas = Array.from(document.querySelectorAll('button, a'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
      const hasLoginCta = ctas.some((text) => /^(Log in|Sign in)$/i.test(text));
      const hasExpiredSessionModalHint =
        ctas.some((text) => /expired session/i.test(text)) ||
        document.body.innerText.includes('auth.expired-session-modal');
      return { isAuthHost, hasComposer, hasLoginCta, hasExpiredSessionModalHint };
    })()
  `, false);
}

function isLoginRequiredFromSignals(
  auth: { hasSessionCookie: boolean; hasLogoutDebugCookie: boolean },
  page: { isAuthHost: boolean; hasComposer: boolean; hasLoginCta: boolean; hasExpiredSessionModalHint: boolean },
): boolean {
  if (!auth.hasSessionCookie) return true;
  if (page.isAuthHost || page.hasLoginCta || page.hasExpiredSessionModalHint) return true;
  if (auth.hasLogoutDebugCookie && !page.hasComposer) return true;
  return false;
}

async function waitForChatgptComposerOrTimeout(
  wc: import('electron').WebContents,
  maxWaitMs = 8_000,
): Promise<void> {
  const POLL_MS = 300;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const found = await wc.executeJavaScript(
        `Boolean(
          document.querySelector('#prompt-textarea[contenteditable="true"]') ||
          document.querySelector('form[data-type="unified-composer"] #prompt-textarea')
        )`,
        false,
      ) as boolean;
      if (found) return;
    } catch {
    }
    await sleep(POLL_MS);
  }
}

export async function runChatgptAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = CHATGPT_HOME,
  attachments?: string[],
  _wantTitle = false,
  continuingThread = false,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.chatgpt);

  const landing = await ensureOnPage(wc, targetUrl, PAGE_REUSE.chatgpt, { continuingThread });
  const reused = landing === 'reused';
  if (reused) sendLog('♻️ ChatGPT page kept open — typing straight into it, no reload');

  if (!reused) await waitForChatgptComposerOrTimeout(wc);

  const authSignals = await getChatgptAuthSignals(workerWin);
  const pageSignals = await getChatgptPageSignals(workerWin);
  if (isLoginRequiredFromSignals(authSignals, pageSignals)) {
    await showLoginWindowIfNeeded('ChatGPT', CHATGPT_LOGIN_URL);
    throw new Error(
      `${CHATGPT_LOGIN_REQUIRED}: ChatGPT page indicates logged-out state (session=${authSignals.hasSessionCookie}, logoutDebug=${authSignals.hasLogoutDebugCookie}, composer=${pageSignals.hasComposer})`,
    );
  }

  await syncChatgptModel(wc);

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToChatgpt(wc, attachments, 120_000);
    for (const line of uploadLog) sendLog(`[chatgpt-upload] ${line}`);
  }

  await dispatchFocusEvents(wc);

  // Called for the settling, not the count: the baseline that matters is taken in the page
  // after the composer is filled, because history can still be hydrating out here. A page kept
  // from the previous turn finished hydrating long ago, so it has nothing left to settle.
  if (!reused) await settledElementCount(wc, CHATGPT_ASSISTANT_TURN_SELECTOR);

  const autoScript = buildChatgptAutomationScript(prompt, timeoutMs);
  const result = await executeAutomationWithTimeout<{ response: string; title: string }>(
    wc,
    autoScript,
    timeoutMs,
    'ChatGPT',
  );

  if (!result || !result.response || result.response.trim() === '') {
    throw new Error('ChatGPT returned empty response');
  }

  return {
    response: result.response.trim(),
    title: cleanChatgptTitle(result.title || ''),
  };
}

function buildChatgptAutomationScript(
  prompt: string,
  timeoutMs: number,
): string {
  const escapedPrompt = JSON.stringify(prompt);

  return `
(async function chatgptAutomate() {
  var TIMEOUT  = ${timeoutMs};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${CHATGPT_SUBMIT_JS}
  ${CHATGPT_READ_JS}

  var submitted = await chatgptSubmit(${escapedPrompt});
  return await chatgptWaitAndRead(submitted, { timeoutMs: TIMEOUT });
})()`;
}

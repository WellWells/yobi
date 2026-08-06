import type { BrowserWindow } from 'electron';
import { navigateAndWait, sleep, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import { isExpiredCookie } from '../helpers';
import { showLoginWindowIfNeeded } from '../windows';
import { PROVIDER_URLS } from '../../shared/types';
import { CLEAN_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_SUBMIT_JS } from './chatgptSendScript';

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
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, CLEAN_UA);

  await navigateAndWait(wc, targetUrl);

  await waitForChatgptComposerOrTimeout(wc);

  const authSignals = await getChatgptAuthSignals(workerWin);
  const pageSignals = await getChatgptPageSignals(workerWin);
  if (isLoginRequiredFromSignals(authSignals, pageSignals)) {
    await showLoginWindowIfNeeded('ChatGPT', CHATGPT_LOGIN_URL);
    throw new Error(
      `${CHATGPT_LOGIN_REQUIRED}: ChatGPT page indicates logged-out state (session=${authSignals.hasSessionCookie}, logoutDebug=${authSignals.hasLogoutDebugCookie}, composer=${pageSignals.hasComposer})`,
    );
  }

  await dispatchFocusEvents(wc);

  const baseline = await settledElementCount(wc, CHATGPT_ASSISTANT_TURN_SELECTOR);

  const autoScript = buildChatgptAutomationScript(prompt, baseline, timeoutMs);
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
    title: (result.title || '').trim(),
  };
}

function buildChatgptAutomationScript(
  prompt: string,
  baselineMessageCount: number,
  timeoutMs: number,
): string {
  const escapedPrompt = JSON.stringify(prompt);

  return `
(async function chatgptAutomate() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}

  function getAssistantTurns() {
    return document.querySelectorAll(${JSON.stringify(CHATGPT_ASSISTANT_TURN_SELECTOR)});
  }

  function getLatestAssistantTurn() {
    var turns = getAssistantTurns();
    return turns[turns.length - 1] || null;
  }

  function getTurnText(turn) {
    if (!turn) return '';
    var markdown = turn.querySelector('.markdown.prose, .markdown, [class*="markdown"]');
    if (markdown && (markdown.innerText || '').trim()) {
      return (markdown.innerText || '').trim();
    }
    return (turn.innerText || '').trim();
  }

  // Redesigned: find the copy button for a given assistant turn.
  function findCopyButtonForTurn(turn) {
    if (!turn) return null;
    
    // The action bar lives outside the assistant bubble in recent DOM versions;
    // walk up to the enclosing turn container (.agent-turn or .group/turn-messages).
    var turnContainer = turn.closest('.agent-turn') || turn.closest('.group\\\\/turn-messages') || turn.parentElement.parentElement;
    var searchContext = turnContainer || document;

    // Use exact selectors only — avoids matching code-block copy buttons.
    var selectors = [
      'button[data-testid="copy-turn-action-button"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btns = searchContext.querySelectorAll(selectors[i]);
      if (btns && btns.length > 0) return btns[btns.length - 1]; // last button = latest response
    }
    return null;
  }

  ${INJECTED_INTERCEPT_COPY_JS}

  ${CHATGPT_SUBMIT_JS}

  // chatgptSubmit throws unless a new USER turn appeared, so reaching this line
  // means the question really went in. It also hands back the assistant count as
  // it stood immediately before the send: the Node-side baseline is taken before
  // this script runs, which on a resumed thread is early enough for late history
  // to push past it and make the PREVIOUS answer look like a new one.
  var submitted = await chatgptSubmit(${escapedPrompt});
  BASELINE = submitted.assistantBaseline;

  await waitFor(function() {
    return getAssistantTurns().length > BASELINE;
  }, 'new ChatGPT response', TIMEOUT, 350);

  await waitFor(function() {
    var turn = getLatestAssistantTurn();
    return !!getTurnText(turn);
  }, 'ChatGPT response text', TIMEOUT, 350);

  // Generation is done the moment the turn's action toolbar (its copy button)
  // renders — ChatGPT only adds it after the stream ends, so this is faster and
  // more reliable than waiting for the text to stop changing. The text-stability
  // check stays as a fallback for when the copy button can't be located.
  var stableText = '';
  var stableCount = 0;
  var NO_CHANGE_LIMIT = TIMEOUT;   // idle window = configured response timeout (reset on every text change)
  var chatLastChangeAt = null;
  var copyBtn = null;
  while (true) {
    var turn = getLatestAssistantTurn();
    var text = getTurnText(turn);
    copyBtn = findCopyButtonForTurn(turn);
    if (copyBtn && text) break;
    if (text !== stableText) {
      stableText = text;
      stableCount = 0;
      if (text) chatLastChangeAt = Date.now();
    } else if (text) {
      stableCount += 1;
    }
    if (stableText && stableCount >= 3) break;
    if (chatLastChangeAt !== null && Date.now() - chatLastChangeAt > NO_CHANGE_LIMIT) {
      if (stableText) break;
      throw new Error('ChatGPT automation timed out: response stopped updating');
    }
    await sleep(250);
  }

  var latestTurn = getLatestAssistantTurn();
  if (!latestTurn) throw new Error('ChatGPT response block not found');

  // The copy button is in the DOM even while visually hidden (no hover needed);
  // element.click() fires its handler regardless of pointer-events. Re-find it
  // only if we exited via the text-stability fallback.
  if (!copyBtn) copyBtn = findCopyButtonForTurn(latestTurn);

  var answerText = getTurnText(latestTurn);
  var copiedText = copyBtn ? ((await interceptCopy(copyBtn)) || '').trim() : '';
  
  // Prefer the intercepted clipboard text; fall back to innerText if empty.
  var finalAnswer = copiedText || answerText;
  if (!finalAnswer) throw new Error('ChatGPT response is empty');

  var title = '';
  try {
    title = (document.title || '').replace(/\\s*-\\s*ChatGPT$/i, '').trim();
  } catch (e) {}

  return { response: finalAnswer, title: title };
})()`;
}

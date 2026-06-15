import type { BrowserWindow } from 'electron';
import { navigateAndWait, sleep, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, countElements, dispatchFocusEvents } from './automationExecutor';
import { isExpiredCookie } from '../helpers';
import { PROVIDER_URLS } from '../../shared/types';
import { CLEAN_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';

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
    await navigateAndWait(wc, CHATGPT_LOGIN_URL);
    throw new Error(
      `${CHATGPT_LOGIN_REQUIRED}: ChatGPT page indicates logged-out state (session=${authSignals.hasSessionCookie}, logoutDebug=${authSignals.hasLogoutDebugCookie}, composer=${pageSignals.hasComposer})`,
    );
  }

  await dispatchFocusEvents(wc);

  const baseline = await countElements(wc, '[data-message-author-role="assistant"]');

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
    return document.querySelectorAll('[data-message-author-role="assistant"]');
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
      'button[data-testid="copy-turn-action-button"]',
      'button[aria-label="Copy response"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btns = searchContext.querySelectorAll(selectors[i]);
      if (btns && btns.length > 0) return btns[btns.length - 1]; // last button = latest response
    }
    return null;
  }

  ${INJECTED_INTERCEPT_COPY_JS}

  var INPUT_SELECTORS = [
    '#prompt-textarea[contenteditable="true"]',
    'form[data-type="unified-composer"] #prompt-textarea',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"][role="textbox"][aria-multiline="true"]',
  ];

  var input = null;
  await waitFor(function() {
    for (var i = 0; i < INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(INPUT_SELECTORS[i]);
      if (el) { input = el; return true; }
    }
    return false;
  }, 'ChatGPT input area', 15000, 200);

  if (!input) throw new Error('ChatGPT input area not found');

  input.focus();
  input.textContent = '';
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'deleteContent'
  }));
  await sleep(80);
  var dt = new DataTransfer();
  dt.setData('text/plain', ${escapedPrompt});
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (!(input.innerText || '').trim()) {
    document.execCommand('insertText', false, ${escapedPrompt});
  }
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'insertText'
  }));
  await sleep(250);

  var SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Submit"]',
  ];

  function findEnabledSendBtn() {
    for (var s = 0; s < SEND_SELECTORS.length; s++) {
      var b = document.querySelector(SEND_SELECTORS[s]);
      if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') return b;
    }
    return null;
  }

  // After clicking, poll until the button changes state (disabled / gone → stop
  // button) rather than sleeping a fixed delay. Returns true when confirmed.
  async function verifySendLanded() {
    var deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await sleep(40);
      var btn = document.querySelector('[data-testid="send-button"]');
      // Click registered: button gone, disabled, or aria-disabled
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        return true;
      }
    }
    return false;
  }

  // Wait up to 30 s — handles the delay when ChatGPT converts a long paste to
  // a TXT attachment and the send button stays disabled until upload finishes.
  var sent = false;
  var SEND_DEADLINE = Date.now() + 30000;
  while (!sent && Date.now() < SEND_DEADLINE) {
    var sendBtn = findEnabledSendBtn();
    if (sendBtn) {
      sendBtn.click();
      if (await verifySendLanded()) {
        sent = true;
      }
      // Button still active — click didn't register, retry.
    }
    if (!sent) await sleep(150);
  }

  if (!sent) {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
    }));
    await sleep(40);
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
  }

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
  var NO_CHANGE_LIMIT = 30000;
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
      throw new Error('ChatGPT automation timed out: no response changes for 30 seconds');
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

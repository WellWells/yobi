import type { BrowserWindow } from 'electron';
import { navigateAndWait, sleep, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import { isExpiredCookie, sendLog } from '../helpers';
import { showLoginWindowIfNeeded } from '../windows';
import { PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_SUBMIT_JS } from './chatgptSendScript';
import { uploadFilesToChatgpt } from './chatgptUpload';

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
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.chatgpt);

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

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToChatgpt(wc, attachments, 120_000);
    for (const line of uploadLog) sendLog(`[chatgpt-upload] ${line}`);
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

  function findCopyButtonForTurn(turn) {
    if (!turn) return null;
    
    var turnContainer = turn.closest('.agent-turn') || turn.closest('.group\\\\/turn-messages') || turn.parentElement.parentElement;
    var searchContext = turnContainer || document;

    var selectors = [
      'button[data-testid="copy-turn-action-button"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btns = searchContext.querySelectorAll(selectors[i]);
      if (btns && btns.length > 0) return btns[btns.length - 1]; 
    }
    return null;
  }

  ${INJECTED_INTERCEPT_COPY_JS}

  ${CHATGPT_SUBMIT_JS}

  var submitted = await chatgptSubmit(${escapedPrompt});
  BASELINE = submitted.assistantBaseline;

  await waitFor(function() {
    return getAssistantTurns().length > BASELINE;
  }, 'new ChatGPT response', TIMEOUT, 350);

  await waitFor(function() {
    var turn = getLatestAssistantTurn();
    return !!getTurnText(turn);
  }, 'ChatGPT response text', TIMEOUT, 350);

  var stableText = '';
  var stableCount = 0;
  var NO_CHANGE_LIMIT = TIMEOUT;   
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

  if (!copyBtn) copyBtn = findCopyButtonForTurn(latestTurn);

  var answerText = getTurnText(latestTurn);
  var copiedText = copyBtn ? ((await interceptCopy(copyBtn)) || '').trim() : '';
  
  var finalAnswer = copiedText || answerText;
  if (!finalAnswer) throw new Error('ChatGPT response is empty');

  var title = '';
  try {
    title = (document.title || '').replace(/\\s*-\\s*ChatGPT$/i, '').trim();
  } catch (e) {}

  return { response: finalAnswer, title: title };
})()`;
}

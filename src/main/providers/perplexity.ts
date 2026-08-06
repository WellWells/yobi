import type { BrowserWindow, Cookie, WebContents } from 'electron';
import { navigateAndWait, isCloudflareChallengeActive, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import { INJECTED_PPLX_READ_JS, PPLX_RESPONSE_SELECTOR } from './perplexityReadScript';
import { isExpiredCookie } from '../helpers';
import { showInteractiveWorkerWindow, showLoginWindowIfNeeded } from '../windows';
import { raiseVerificationChallenge, VERIFICATION_CHALLENGE_ERROR_NAME } from './verificationChallenge';
import { PROVIDER_LABELS, PROVIDER_URLS } from '../../shared/types';
import { CLEAN_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';

export const PERPLEXITY_CLOUDFLARE_ERROR_NAME = VERIFICATION_CHALLENGE_ERROR_NAME;

const PERPLEXITY_LOGIN_REQUIRED = 'PERPLEXITY_LOGIN_REQUIRED';

const PERPLEXITY_SESSION_COOKIE_PREFIXES = [
  '__Secure-next-auth.session-token',
  '__Secure-pplx.session.',
] as const;

export function isPerplexitySessionCookie(cookie: Cookie): boolean {
  return (
    PERPLEXITY_SESSION_COOKIE_PREFIXES.some((prefix) => cookie.name.startsWith(prefix)) &&
    Boolean(cookie.value) &&
    !isExpiredCookie(cookie.expirationDate)
  );
}

export function isPerplexityLoginRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes(PERPLEXITY_LOGIN_REQUIRED);
}

async function hasPerplexitySession(workerWin: BrowserWindow): Promise<boolean> {
  const cookies = await workerWin.webContents.session.cookies.get({ url: PROVIDER_URLS.perplexity });
  return cookies.some(isPerplexitySessionCookie);
}

export async function runPerplexityAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.perplexity,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, CLEAN_UA);

  await navigateAndWait(wc, targetUrl);

  if (await isCloudflareChallengeActive(wc)) {
    await showInteractiveWorkerWindow(targetUrl);
    throw raiseVerificationChallenge({
      titleKey: 'cloudflare.notify.title',
      bodyKey: 'cloudflare.notify.body',
      actionKey: 'cloudflare.notify.action.openWorker',
      errorKey: 'cloudflare.error.verificationFailed',
      logMessage: '⚠️ Cloudflare security check detected — task marked as FAILED and removed from queue',
    });
  }

  if (!(await hasPerplexitySession(workerWin))) {
    await showLoginWindowIfNeeded(PROVIDER_LABELS.perplexity, PROVIDER_URLS.perplexity);
    throw new Error(`${PERPLEXITY_LOGIN_REQUIRED}: Perplexity has no active session cookie`);
  }

  await dispatchFocusEvents(wc);

  const baseline = await settledElementCount(wc, PPLX_RESPONSE_SELECTOR);

  type PplxResult = { response: string; title: string; isImageOnly?: boolean };
  let fullyNavigated = false;
  const onFullNavigate = () => { fullyNavigated = true; };
  wc.on('did-navigate', onFullNavigate);

  const autoScript = buildPerplexityAutomationScript(prompt, baseline, timeoutMs);
  let result: PplxResult | null = null;
  try {
    result = await executeAutomationWithTimeout<PplxResult>(wc, autoScript, timeoutMs, 'Perplexity');
  } catch (err) {
    if (!fullyNavigated) throw err;
  } finally {
    wc.off('did-navigate', onFullNavigate);
  }

  if (!result && fullyNavigated) {
    await waitForPageLoad(wc, 30_000);
    /*
     * The pre-send count, not 0. Reading with 0 accepts whatever answer is already rendered,
     * and when targetUrl was a thread being continued the reloaded page still shows the
     * PREVIOUS reply — which the caller then receives as if it were the answer to this prompt.
     * `baseline` is already 0 for a fresh chat, so this is strictly the safer number.
     */
    const readScript = buildPerplexityReadScript(baseline, timeoutMs);
    result = await executeAutomationWithTimeout<PplxResult>(wc, readScript, timeoutMs, 'Perplexity');
  }

  if (!result || typeof result.response !== 'string') {
    throw new Error('Perplexity returned empty response');
  }
  if (result.response.trim() === '' && !result.isImageOnly) {
    throw new Error('Perplexity returned empty response');
  }

  return {
    response: result.response.trim(),
    title: (result.title || '').trim(),
  };
}

async function waitForPageLoad(wc: WebContents, timeoutMs: number): Promise<void> {
  if (!wc.isLoading()) return;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Post-navigation page load timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    wc.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
  });
}

function buildPerplexityReadScript(
  baselineMessageCount: number,
  timeoutMs: number,
): string {
  return `
(async function perplexityRead() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_PPLX_READ_JS}

  return await perplexityWaitAndRead(BASELINE);
})()`;
}

function buildPerplexityAutomationScript(
  prompt: string,
  baselineMessageCount: number,
  timeoutMs: number,
): string {
  const escapedPrompt = JSON.stringify(prompt);

  return `
(async function perplexityAutomate() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_PPLX_READ_JS}

  // ── Locate input ─────────────────────────────────────────────────────────────
  var INPUT_SELECTORS = [
    '#ask-input[contenteditable="true"]',
    'div.chat-input-container #ask-input',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]',
  ];

  var input = null;
  await waitFor(function() {
    for (var i = 0; i < INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(INPUT_SELECTORS[i]);
      if (el) { input = el; return true; }
    }
    return false;
  }, 'Perplexity input area', 15000, 200);

  if (!input) throw new Error('Perplexity input area not found');

  // ── Type prompt ──────────────────────────────────────────────────────────────
  input.focus();
  input.textContent = '';
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'deleteContent'
  }));
  await sleep(80);
  var dt = new DataTransfer();
  dt.setData('text/plain', ${escapedPrompt});
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  // Perplexity uses Lexical editor which processes paste asynchronously;
  // wait for DOM to settle before checking if the fallback is needed.
  await sleep(150);
  if (!(input.innerText || '').trim()) {
    document.execCommand('insertText', false, ${escapedPrompt});
  }
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'insertText'
  }));
  await sleep(250);

  // ── Submit ───────────────────────────────────────────────────────────────────
  // The submit button is the primary (bg-button-bg) button inside the ask-input
  function findSubmitBtn() {
    var container = document.querySelector('[data-ask-input-container="true"]');
    var btn = container ? container.querySelector('button.bg-button-bg') : null;
    if (btn) return btn;
    return document.querySelector('button[data-testid="submit-button"]');
  }

  var sent = false;
  for (var attempt = 0; attempt < 28 && !sent; attempt++) {
    var sendBtn = findSubmitBtn();
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      sent = true;
      break;
    }
    if (!sent) await sleep(120);
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

  return await perplexityWaitAndRead(BASELINE);
})()`;
}

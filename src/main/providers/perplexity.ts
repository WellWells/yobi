import type { BrowserWindow, Cookie, WebContents } from 'electron';
import { navigateAndWait, isCloudflareChallengeActive, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import { INJECTED_PPLX_READ_JS, PPLX_RESPONSE_SELECTOR } from './perplexityReadScript';
import { isExpiredCookie } from '../helpers';
import { showInteractiveWorkerWindow, showLoginWindowIfNeeded } from '../windows';
import { raiseVerificationChallenge, VERIFICATION_CHALLENGE_ERROR_NAME } from './verificationChallenge';
import { PROVIDER_LABELS, PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
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

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.perplexity);

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

  input.focus();
  input.textContent = '';
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'deleteContent'
  }));
  await sleep(80);
  var dt = new DataTransfer();
  dt.setData('text/plain', ${escapedPrompt});
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(150);
  if (!(input.innerText || '').trim()) {
    document.execCommand('insertText', false, ${escapedPrompt});
  }
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'insertText'
  }));
  await sleep(250);

  var SUBMIT_ICONS = ['pplx-icon-arrow-up', 'pplx-icon-arrow-right'];

  function findSubmitBtn() {
    var container = document.querySelector('[data-ask-input-container="true"]');
    if (!container) return null;
    var btn = container.querySelector('button.bg-button-bg');
    if (btn) return btn;
    // The send control is icon-only and its aria-label is localized, so the arrow icon
    // is the stable marker: pointing right on a new thread, up in a follow-up composer.
    var buttons = container.querySelectorAll('button');
    for (var i = buttons.length - 1; i >= 0; i--) {
      if (buttonHasAnyIcon(buttons[i], SUBMIT_ICONS)) return buttons[i];
    }
    return null;
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

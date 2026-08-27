import type { BrowserWindow, WebContents } from 'electron';
import { sleep, navigateAndWait, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, countElements, settledElementCount } from './automationExecutor';
import { PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { sendLog } from '../helpers';
import { showLoginWindowIfNeeded } from '../windows';
import { uploadFilesToGemini } from './geminiUpload';
import {
  GEMINI_COPY_BTN_SELECTOR as COPY_BTN_SELECTOR,
  GEMINI_INPUT_SELECTOR as INPUT_SELECTOR,
  INJECTED_GEMINI_WAIT_AND_READ_JS,
} from './geminiReadScript';

const MAX_BOUNCE_ATTEMPTS = 5;

export async function runGeminiAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.gemini,
  attachments?: string[],
  wantTitle = false,
  continuingThread = false,
): Promise<{ response: string; title: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runGeminiAttempt(workerWin, prompt, timeoutMs, targetUrl, attachments, wantTitle, continuingThread);
    } catch (err) {
      if (err instanceof Error && err.message.includes('GEMINI_BOUNCED') && attempt < MAX_BOUNCE_ATTEMPTS) {
        const where = continuingThread ? 'the same thread' : 'a fresh chat';
        sendLog(`⚠️ Gemini aborted mid-generation and bounced the prompt back to the composer — retrying in ${where} (attempt ${attempt + 1}/${MAX_BOUNCE_ATTEMPTS})`);
        continue;
      }
      throw err;
    }
  }
}

async function runGeminiAttempt(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs: number,
  targetUrl: string,
  attachments?: string[],
  wantTitle = false,
  continuingThread = false,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.gemini);

  await navigateAndWait(wc, targetUrl);
  await waitForInputArea(wc, 15_000);

  await applyVisibilityPatch(wc);

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToGemini(wc, attachments, 120_000);
    for (const line of uploadLog) sendLog(`[gemini-upload] ${line}`);
  }

  const baseline = await settledElementCount(wc, COPY_BTN_SELECTOR);
  const responseBaseline = continuingThread ? await settledElementCount(wc, 'model-response') : 0;

  wc.focus();

  let fullyNavigated = false;
  const onFullNavigate = () => { fullyNavigated = true; };
  wc.on('did-navigate', onFullNavigate);

  const autoScript = buildGeminiAutomationScript(prompt, baseline, timeoutMs, COPY_BTN_SELECTOR, wantTitle, continuingThread);
  let result: { response: string; title: string } | null = null;

  try {
    try {
      result = await executeAutomationWithTimeout<{ response: string; title: string }>(
        wc,
        autoScript,
        timeoutMs,
        'Gemini',
      );
    } catch (err) {
      if (!fullyNavigated) throw err;
    } finally {
      wc.off('did-navigate', onFullNavigate);
    }

    if (!result && fullyNavigated) {
      await waitForPageLoad(wc, 30_000);
      await waitForInputArea(wc, 15_000);
      await applyVisibilityPatch(wc);

      const recoveryBaseline = continuingThread ? baseline : 0;
      const readScript = buildGeminiReadScript(
        recoveryBaseline, timeoutMs, COPY_BTN_SELECTOR, wantTitle, responseBaseline,
      );
      result = await executeAutomationWithTimeout<{ response: string; title: string }>(
        wc,
        readScript,
        timeoutMs,
        'Gemini',
      );
    }

    if (!result || !result.response || result.response.trim() === '') {
      throw new Error('Clipboard interceptor returned empty text');
    }

    return {
      response: result.response.trim(),
      title: (result.title || '').trim(),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('GEMINI_LOGIN_REQUIRED')) {
      await showLoginWindowIfNeeded('Gemini', PROVIDER_URLS.gemini);
    }
    throw err;
  }
}

async function applyVisibilityPatch(wc: WebContents): Promise<void> {
  await wc.executeJavaScript(`
    (function patchVisibility() {
      try {
        Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
      } catch(e) {}
      try {
        document.hasFocus = function() { return true; };
      } catch(e) {}
      document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
      window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      window.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    })();
    void 0;
  `, false);
}

async function waitForInputArea(wc: WebContents, timeoutMs: number): Promise<void> {
  const INTERVAL = 150;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await countElements(wc, INPUT_SELECTOR);
    if (n > 0) return;
    await sleep(INTERVAL);
  }
  throw new Error('Gemini input area not found after navigation');
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

export function buildGeminiAutomationScript(
  prompt: string,
  baselineCopyCount: number,
  timeoutMs: number,
  copyBtnSelector: string,
  wantTitle: boolean,
  continuingThread = false,
): string {
  const escapedPrompt = JSON.stringify(prompt);
  const escapedSelector = JSON.stringify(copyBtnSelector);
  const escapedInputSelector = JSON.stringify(INPUT_SELECTOR);

  return `
(async function geminiAutomate() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineCopyCount};
  var COPY_SEL = ${escapedSelector};
  var INPUT_SEL = ${escapedInputSelector};
  var PROMPT = ${escapedPrompt};
  var WANT_TITLE = ${wantTitle};
  var CONTINUING = ${continuingThread};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_GEMINI_WAIT_AND_READ_JS}

  await waitFor(function() {
    return !!document.querySelector(INPUT_SEL);
  }, 'input area', 15000, 150);

  function getComposer() {
    return document.querySelector(INPUT_SEL);
  }
  function composerText() {
    var el = getComposer();
    return el ? (el.innerText || '').trim() : '';
  }

  if (!getComposer()) throw new Error('Gemini input area not found — is the page logged in?');

  function countResponses() {
    return document.querySelectorAll('model-response').length;
  }
  function generationActive() {
    var c = document.querySelector('[data-test-id="send-button-container"]');
    if (c && c.querySelector('mat-icon[fonticon="stop"]')) return true;
    return !!document.querySelector('[data-test-id="stop-button"]');
  }
  function readySendButton() {
    var container = document.querySelector('[data-test-id="send-button-container"]');
    if (!container) return null;
    var btn = container.querySelector('button');
    if (!btn || btn.disabled) return null;
    var wrap = btn.closest('gem-icon-button');
    if (wrap) {
      if (wrap.getAttribute('aria-disabled') === 'true') return null;
      if (wrap.classList.contains('gem-button-disabled')) return null;
      if (wrap.hasAttribute('inert')) return null;
    }
    return btn;
  }

  if (!CONTINUING && countResponses() > 0) {
    var newChatBtn = document.querySelector('[data-test-id="new-chat-button"]');
    if (newChatBtn) {
      newChatBtn.click();
      try {
        await waitFor(function() { return countResponses() === 0; }, 'new chat ready', 5000, 200);
      } catch(e) {}
    }
  }

  function placeCursorAtEnd(el) {
    try {
      el.focus();
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  function fillViaEvents(el) {
    placeCursorAtEnd(el);
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    el.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, composed: true }));
    document.execCommand('selectAll', false, null);
    var dt = new DataTransfer();
    dt.setData('text/plain', PROMPT);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if (!(el.innerText || '').trim()) {
      document.execCommand('insertText', false, PROMPT);
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText'
    }));
  }

  function fillViaDom(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var lines = PROMPT.split('\\n');
    for (var i = 0; i < lines.length; i++) {
      var p = document.createElement('p');
      if (lines[i]) { p.textContent = lines[i]; } else { p.appendChild(document.createElement('br')); }
      el.appendChild(p);
    }
    el.classList.remove('ql-blank');
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText'
    }));
  }

  async function fillComposer() {
    var deadline = Date.now() + 15000;
    var attempt = 0;
    while (Date.now() < deadline) {
      var el = getComposer();
      if (el) {
        attempt++;
        fillViaEvents(el);
        await sleep(150);
        if (composerText()) return true;
        el = getComposer();
        if (el && attempt >= 2) {
          fillViaDom(el);
          await sleep(150);
          if (composerText()) return true;
        }
      }
      await sleep(250);
    }
    return false;
  }

  async function submitPrompt() {
    var filled = await fillComposer();
    if (!filled) {
      throw new Error('Gemini composer never accepted the prompt text after retries (editor not ready)');
    }

    var sendBtn = null;
    try {
      await waitFor(function() {
        var b = readySendButton();
        if (b) { sendBtn = b; return true; }
        return false;
      }, 'send button clickable', 8000, 100);
    } catch(e) {
      throw new Error('Gemini send button never became clickable within 8s (composer had text but send stayed disabled)');
    }
    sendBtn.click();

    var landed = false;
    try {
      await waitFor(function() {
        return !readySendButton() || !composerText();
      }, 'send landed', 2000, 100);
      landed = true;
    } catch(e) {}

    if (!landed) {
      var enterTarget = getComposer();
      if (enterTarget) {
        enterTarget.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13,
          bubbles: true, cancelable: true
        }));
        await sleep(50);
        enterTarget.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
      }
    }
  }

  if (CONTINUING) {
    try {
      await waitFor(function() { return countResponses() > 0; }, 'thread history', 10000, 200);
    } catch(e) {}
  }

  BASELINE = document.querySelectorAll(COPY_SEL).length;
  var respBaseline = countResponses();
  await submitPrompt();

  var started = false;
  try {
    await waitFor(function() {
      return countResponses() > respBaseline || generationActive();
    }, 'generation started', 12000, 250);
    started = true;
  } catch(e) {}

  if (!started) {
    await submitPrompt();
    try {
      await waitFor(function() {
        return countResponses() > respBaseline || generationActive();
      }, 'generation started (retry)', 12000, 250);
      started = true;
    } catch(e) {}
  }

  if (!started) {
    if (composerText()) {
      throw new Error('GEMINI_BOUNCED: prompt bounced back to the composer without starting a generation');
    }
    throw new Error('Gemini accepted the prompt but never started generating a response (reused conversation or rate limit)');
  }

  return await geminiWaitAndRead(BASELINE, COPY_SEL, {
    idleMs: TIMEOUT, wantTitle: WANT_TITLE, responseBaseline: respBaseline
  });
})()`;
}

function buildGeminiReadScript(
  baselineCopyCount: number,
  timeoutMs: number,
  copyBtnSelector: string,
  wantTitle: boolean,
  responseBaseline = 0,
): string {
  const escapedSelector = JSON.stringify(copyBtnSelector);

  return `
(async function geminiRead() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineCopyCount};
  var RESP_BASELINE = ${responseBaseline};
  var WANT_TITLE = ${wantTitle};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_GEMINI_WAIT_AND_READ_JS}

  return await geminiWaitAndRead(BASELINE, ${escapedSelector}, {
    idleMs: TIMEOUT, wantTitle: WANT_TITLE, responseBaseline: RESP_BASELINE
  });
})()`;
}

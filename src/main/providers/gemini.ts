import type { BrowserWindow, WebContents } from 'electron';
import { sleep, navigateAndWait, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, countElements } from './automationExecutor';
import { PROVIDER_URLS } from '../../shared/types';
import { FIREFOX_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { sendLog } from '../helpers';
import { uploadFilesToGemini } from './geminiUpload';

const COPY_BTN_SELECTOR =
  'copy-button gem-icon-button[data-test-id="copy-button"] button';

const INPUT_SELECTOR =
  'rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]';

export async function runGeminiAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.gemini,
  attachments?: string[],
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, FIREFOX_UA);

  await navigateAndWait(wc, targetUrl);
  await waitForInputArea(wc, 15_000);

  await applyVisibilityPatch(wc);

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToGemini(wc, attachments, 120_000);
    for (const line of uploadLog) sendLog(`[gemini-upload] ${line}`);
  }

  const baseline = await countElements(wc, COPY_BTN_SELECTOR);

  wc.focus();

  let fullyNavigated = false;
  const onFullNavigate = () => { fullyNavigated = true; };
  wc.on('did-navigate', onFullNavigate);

  const autoScript = buildGeminiAutomationScript(prompt, baseline, timeoutMs, COPY_BTN_SELECTOR);
  let result: { response: string; title: string } | null = null;

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

    const readScript = buildGeminiReadScript(0, timeoutMs, COPY_BTN_SELECTOR);
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
}

async function applyVisibilityPatch(wc: WebContents): Promise<void> {
  await wc.executeJavaScript(`
    (function patchVisibility() {
      // 1. Override document.hidden / visibilityState
      try {
        Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
      } catch(e) {}
      // 2. Override document.hasFocus so it always returns true
      try {
        document.hasFocus = function() { return true; };
      } catch(e) {}
      // 3. Suppress visibilitychange + blur events so they can't un-focus the page
      document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
      window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
      // 4. Fire visibility + focus events the browser would send when a tab becomes active
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

function buildGeminiAutomationScript(
  prompt: string,
  baselineCopyCount: number,
  timeoutMs: number,
  copyBtnSelector: string,
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
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_GEMINI_WAIT_AND_READ_JS}

  await waitFor(function() {
    return !!document.querySelector(INPUT_SEL);
  }, 'input area', 15000, 150);

  // Always re-query the composer instead of caching a reference: Angular re-renders
  // (zero-state -> conversation transition, late hydration) can REPLACE the editor
  // node, and every action on a stale detached node silently no-ops.
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
    return !!document.querySelector('button[aria-label*="Stop" i], [data-test-id="stop-button"]');
  }
  // Send button: anchor on the stable data-test-id container; the enabled state
  // lives on the wrapping <gem-icon-button> (aria-disabled / gem-button-disabled
  // / inert), not on the inner native button.
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

  // A reused worker window can reload the PREVIOUS conversation instead of a new
  // chat; sending into it may silently no-op (never generating) and also bleeds
  // earlier context into the answer. Best-effort: when a prior response is on the
  // page, start a fresh chat so this run takes the same reliable new-conversation
  // path (full-frame nav -> recovery) as the very first run.
  if (countResponses() > 0) {
    var newChatBtn = document.querySelector('[data-test-id="new-chat-button"], [aria-label="New chat"], [aria-label*="new chat" i], [aria-label*="新對話"], [aria-label*="新交談"]');
    if (newChatBtn) {
      newChatBtn.click();
      try {
        await waitFor(function() { return countResponses() === 0; }, 'new chat ready', 5000, 200);
      } catch(e) {}
    }
  }

  function placeCursorAtEnd(el) {
    // Element focus + Range/Selection work at the document level, no OS window
    // focus needed, so this also works while the worker window is hidden.
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
    // selectAll before inserting means a retry replaces the previous attempt rather
    // than appending, so re-filling can never duplicate the prompt.
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

  // Quill (the editor behind rich-textarea) watches its own DOM with a
  // MutationObserver and syncs internal state from direct DOM edits (that is how it
  // supports spellcheck/IME). Writing the prompt straight into the DOM therefore
  // works even when the event paths are ignored: Gemini ships Quill 1.x (the hidden
  // .ql-clipboard div next to the editor), whose paste handler relies on the
  // browser's DEFAULT paste action — synthetic ClipboardEvents never trigger default
  // actions, so that path inserts nothing — and execCommand('insertText') needs a
  // live selection that a mid-render page can drop.
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
    // The composer can be in the DOM before its editor is interactive, and Angular
    // can replace the node between attempts — so re-query fresh every round, verify
    // the text actually landed, and escalate to the DOM write after the event-based
    // fill has had two chances. 15s window covers a page still loading its history.
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

    // Poll every 100ms for up to 8s; click the instant the button is clickable.
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

    // Confirm the send registered (button goes disabled / composer clears). If not,
    // fall back to Enter — rich-textarea carries enterkeyhint="send", so it is
    // equivalent; Enter on an empty composer is a no-op, so this cannot double-send.
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

  // Re-derive the copy-button baseline in-page: after a fresh-chat reset the count
  // is 0, and this is the true pre-send state whether or not we reset.
  BASELINE = document.querySelectorAll(COPY_SEL).length;
  var respBaseline = countResponses();
  await submitPrompt();

  // Confirm Gemini actually began generating. On the first message of a new chat
  // the send triggers a full-frame navigation that tears this script down (the
  // Node-side recovery path handles that), so this check only runs to completion
  // on the reused-conversation path — exactly the case that used to stall silently
  // until the outer step timeout.
  var started = false;
  try {
    await waitFor(function() {
      return countResponses() > respBaseline || generationActive();
    }, 'generation started', 12000, 250);
    started = true;
  } catch(e) {}

  if (!started) {
    // The first submit may have cleared the composer without dispatching; re-type
    // and resend once before giving up.
    await submitPrompt();
    try {
      await waitFor(function() {
        return countResponses() > respBaseline || generationActive();
      }, 'generation started (retry)', 12000, 250);
      started = true;
    } catch(e) {}
  }

  if (!started) {
    throw new Error('Gemini accepted the prompt but never started generating a response (reused conversation or rate limit)');
  }

  // No fixed post-send sleep — geminiWaitAndRead polls immediately.
  return await geminiWaitAndRead(BASELINE, COPY_SEL);
})()`;
}

function buildGeminiReadScript(
  baselineCopyCount: number,
  timeoutMs: number,
  copyBtnSelector: string,
): string {
  const escapedSelector = JSON.stringify(copyBtnSelector);

  return `
(async function geminiRead() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineCopyCount};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_GEMINI_WAIT_AND_READ_JS}

  return await geminiWaitAndRead(BASELINE, ${escapedSelector});
})()`;
}

const INJECTED_GEMINI_WAIT_AND_READ_JS = `async function geminiWaitAndRead(baseline, copyBtnSel) {
  var NO_CHANGE_LIMIT = 30000;
  var geminiLastLen = -1;
  var geminiLastChangeAt = null;

  while (true) {
    var copyBtns = document.querySelectorAll(copyBtnSel);
    if (copyBtns.length > baseline) break;
    var respEls = document.querySelectorAll('model-response, message-content');
    var respLen = 0;
    if (respEls.length > 0) {
      respLen = (respEls[respEls.length - 1].innerText || '').length;
    }
    if (respLen === 0) {
      var mainEl = document.querySelector('main');
      respLen = mainEl ? (mainEl.innerText || '').length : (document.body.innerText || '').length;
    }
    if (respLen !== geminiLastLen) {
      geminiLastLen = respLen;
      geminiLastChangeAt = Date.now();
    }
    if (geminiLastChangeAt !== null && Date.now() - geminiLastChangeAt > NO_CHANGE_LIMIT) {
      throw new Error('Timeout: Gemini response had no changes for 30 seconds');
    }
    await sleep(500);
  }

  await sleep(150);

  var title = '';
  try {
    var titleEl = document.querySelector('span[data-test-id="conversation-title"]');
    if (titleEl) title = titleEl.innerText;
  } catch(e) {}

  var allCopyBtns = document.querySelectorAll(copyBtnSel);
  var lastCopyBtn = allCopyBtns[allCopyBtns.length - 1];
  if (!lastCopyBtn) throw new Error('Copy button vanished unexpectedly');

  var response = await interceptCopy(lastCopyBtn);
  if (!response) {
    var lastResp = document.querySelector('model-response:last-of-type message-content div.markdown, .response-container:last-of-type .markdown');
    response = lastResp ? (lastResp.innerText || '').trim() : '';
  }
  if (!response) throw new Error('Clipboard interceptor got nothing after copy click');
  return { response: response, title: title };
}`;

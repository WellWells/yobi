import type { BrowserWindow, WebContents } from 'electron';
import { sleep, waitForPageLoad, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { ensureOnPage, landingMayStillRender, PAGE_REUSE } from './pageReuse';
import { executeAutomationWithTimeout, countElements, anchorCounts } from './automationExecutor';
import { PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { sendLog } from '../helpers';
import { showLoginWindowIfNeeded } from '../windows';
import { uploadFilesToGemini } from './geminiUpload';
import { syncGeminiModel } from './geminiModelSync';
import {
  GEMINI_COPY_BTN_SELECTOR as COPY_BTN_SELECTOR,
  GEMINI_INPUT_SELECTOR as INPUT_SELECTOR,
  GEMINI_NEW_CHAT_SELECTOR,
  GEMINI_STOP_SELECTOR,
  INJECTED_GEMINI_TEMPORARY_JS,
  INJECTED_GEMINI_WAIT_AND_READ_JS,
} from './geminiReadScript';
import { decodePageImages } from './generatedImages';
import type { ProviderRunResult } from './generatedImages';
import { GEMINI_SIGNED_OUT_PROMPT_CAP, geminiPromptCap, noteGeminiComposerCut } from './geminiSignInState';
import { GEMINI_PROMPT_TOO_LONG, geminiPromptTooLongMessage, parseGeminiPromptTooLong } from './geminiPromptTooLong';
import { charsPlusBreaks } from '../../shared/textBudget';

/** What the page script returns: the pictures still base64, checked by `decodePageImages`. */
interface PageRunResult {
  response: string;
  title: string;
  images?: unknown;
}

const MAX_BOUNCE_ATTEMPTS = 5;

export async function runGeminiAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.gemini,
  attachments?: string[],
  wantTitle = false,
  continuingThread = false,
  temporary = false,
): Promise<ProviderRunResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runGeminiAttempt(workerWin, prompt, timeoutMs, targetUrl, attachments, wantTitle, continuingThread, temporary);
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
  temporary = false,
): Promise<ProviderRunResult> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.gemini);

  const landing = await ensureOnPage(wc, targetUrl, PAGE_REUSE.gemini, { continuingThread, temporary });
  const reused = landing === 'reused';
  if (reused) sendLog('♻️ Gemini page kept open — typing straight into it, no reload');
  if (!reused) await waitForInputArea(wc, 15_000);

  await applyVisibilityPatch(wc);
  // First of all: the switch is a fresh conversation, which would drop the model pick and uploads.
  if (temporary && !continuingThread && !(await wc.executeJavaScript(buildGeminiTemporaryChatScript(), true))) {
    sendLog('⚠️ Gemini has no temporary chat on this page — sending as a normal chat');
  }
  // Before anything is typed: the model and thinking switch apply to the next message only.
  await syncGeminiModel(wc);
  // The picker read just now can have shown the page signed out: a prompt sized for the signed-in
  // cap would lose its tail on the page, so it is refused before anything is typed or uploaded.
  const cap = geminiPromptCap();
  const size = charsPlusBreaks(prompt);
  if (size > cap) throw new Error(geminiPromptTooLongMessage(cap, size));

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToGemini(wc, attachments, 120_000);
    for (const line of uploadLog) sendLog(`[gemini-upload] ${line}`);
  }

  // Only a freshly loaded thread can still be rendering earlier answers in: a kept page finished
  // its last turn under this same lane, and a new conversation's landing page has none. Both
  // counts are sampled together, so a thread pays one settle rather than one per selector.
  const [baseline = 0, responseBaseline = 0] = await anchorCounts(
    wc,
    continuingThread ? [COPY_BTN_SELECTOR, 'model-response'] : [COPY_BTN_SELECTOR],
    landingMayStillRender(wc, landing, { continuingThread }),
  );

  wc.focus();

  let fullyNavigated = false;
  const onFullNavigate = () => { fullyNavigated = true; };
  wc.on('did-navigate', onFullNavigate);

  const autoScript = buildGeminiAutomationScript(prompt, baseline, timeoutMs, COPY_BTN_SELECTOR, wantTitle, continuingThread, temporary);
  let result: PageRunResult | null = null;

  try {
    try {
      result = await executeAutomationWithTimeout<PageRunResult>(
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
      result = await executeAutomationWithTimeout<PageRunResult>(
        wc,
        readScript,
        timeoutMs,
        'Gemini',
      );
    }

    const images = decodePageImages(result?.images);
    if (images.length > 0) sendLog(`🖼️ Gemini drew ${images.length} picture(s) for this answer`);
    // A picture with no words is an answer; nothing at all is not.
    if (!result || ((!result.response || result.response.trim() === '') && images.length === 0)) {
      throw new Error('Clipboard interceptor returned empty text');
    }

    return {
      response: (result.response || '').trim(),
      title: (result.title || '').trim(),
      ...(images.length > 0 ? { images } : {}),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('GEMINI_LOGIN_REQUIRED')) {
      await showLoginWindowIfNeeded('Gemini', PROVIDER_URLS.gemini);
    }
    // The page kept less than the whole prompt and nothing was sent. No login window: a scheduled
    // flow or a bot must not open one. Reported in the cap the next prompt is sized for.
    const cut = parseGeminiPromptTooLong(err instanceof Error ? err.message : String(err));
    if (cut) {
      noteGeminiComposerCut(cut.limit);
      sendLog(`⚠️ Gemini's composer kept only ${cut.limit} of ${cut.size} characters — not sent; prompts are now capped at ${geminiPromptCap()}`);
      throw new Error(geminiPromptTooLongMessage(geminiPromptCap(), charsPlusBreaks(prompt)));
    }
    throw err;
  }
}

async function applyVisibilityPatch(wc: WebContents): Promise<void> {
  await wc.executeJavaScript(`
    (function patchVisibility() {
      if (window.__yobiVisibilityPatched) {
        window.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
        document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        return;
      }
      window.__yobiVisibilityPatched = true;
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

/** Resolves true once the page is a temporary chat, false where Gemini offers none. */
export function buildGeminiTemporaryChatScript(): string {
  return `
(async function geminiTemporary() {
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_GEMINI_TEMPORARY_JS}
  return await geminiEnterTemporaryChat();
})()`;
}

export function buildGeminiAutomationScript(
  prompt: string,
  baselineCopyCount: number,
  timeoutMs: number,
  copyBtnSelector: string,
  wantTitle: boolean,
  continuingThread = false,
  temporary = false,
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
  var TEMPORARY = ${temporary && !continuingThread};
  var SAFE_CAP = ${GEMINI_SIGNED_OUT_PROMPT_CAP};
  var TOO_LONG_TAG = ${JSON.stringify(GEMINI_PROMPT_TOO_LONG)};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_GEMINI_WAIT_AND_READ_JS}
  ${INJECTED_GEMINI_TEMPORARY_JS}

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
    return !!document.querySelector(${JSON.stringify(GEMINI_STOP_SELECTOR)});
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
    var newChatBtn = document.querySelector(${JSON.stringify(GEMINI_NEW_CHAT_SELECTOR)});
    if (newChatBtn) {
      newChatBtn.click();
      try {
        await waitFor(function() { return countResponses() === 0; }, 'new chat ready', 5000, 200);
      } catch(e) {}
    }
  }

  // The runner switched before syncing the model and uploading; a new chat started just above
  // can have left that, so check again (a no-op on a page that already is one).
  if (TEMPORARY) await geminiEnterTemporaryChat();

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
    // Keep prompts as text instead of invoking the site's paste-to-file handler.
    document.execCommand('insertText', false, PROMPT);
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

  // Signed out, the composer silently keeps only the first 32,000 characters and the send button
  // stays enabled, so the only check is the composer itself, after filling and before clicking.
  // Lone surrogates may come back as U+FFFD; whitespace (Quill's breaks, nbsp, U+FEFF) is skipped.
  function norm(s) {
    return String(s || '')
      .replace(/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/g, '\\uFFFD')
      .replace(/\\s+/g, '');
  }
  var EXP = PROMPT.replace(/\\r\\n?/g, '\\n');
  var EXP_SQ = norm(EXP);
  var TAIL = EXP_SQ.length > 0 ? EXP_SQ.slice(-200) : '';

  function quillOf(el) {
    var container = el && el.closest ? el.closest('.ql-container') : null;
    var quill = container ? container.__quill : null;
    return quill && typeof quill.getText === 'function' ? quill : null;
  }
  // How much of the prompt, in the page's own unit ('\\n' = 1), the composer text covers: up to the
  // next non-space character after what it holds; 0 when it does not hold the prompt's start.
  function keptOfPrompt(got) {
    if (EXP_SQ.slice(0, got.length) !== got) return 0;
    var seen = 0;
    for (var i = 0; i < EXP.length; i++) {
      if (/\\s/.test(EXP.charAt(i))) continue;
      if (seen === got.length) return i;
      seen++;
    }
    return EXP.length;
  }
  // Quill's model is what Gemini sends; innerText would count every break twice.
  function composerSnapshot(el) {
    var quill = quillOf(el);
    if (quill) {
      var text = quill.getText();
      return { text: text, kept: typeof quill.getLength === 'function' ? quill.getLength() - 1 : keptOfPrompt(norm(text)) };
    }
    var raw = el ? (el.textContent || '') : '';
    return { text: raw, kept: keptOfPrompt(norm(raw)) };
  }
  function judge(snap) {
    var got = norm(snap.text);
    if (got.length < EXP_SQ.length) return 'short';
    return !TAIL || got.slice(-TAIL.length) === TAIL ? 'whole' : 'mismatch';
  }
  function clearComposer(el) {
    if (!el) return;
    var quill = quillOf(el);
    try { if (quill && typeof quill.deleteText === 'function') quill.deleteText(0, quill.getLength(), 'user'); } catch (e) {}
    if (norm(el.textContent).length > 0) {
      try {
        placeCursorAtEnd(el);
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch (e) {}
    }
    if (norm(el.textContent).length > 0) {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.classList.add('ql-blank');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    }
  }
  async function verifyComposerHoldsPrompt(el) {
    var snap = composerSnapshot(el);
    // Only a prompt the signed-out cap can cut waits for the composer to settle; others judge at once.
    if (EXP.length > SAFE_CAP) {
      var last = norm(snap.text).length;
      for (var i = 0; i < 2; i++) {
        await sleep(150);
        snap = composerSnapshot(getComposer() || el);
        var now = norm(snap.text).length;
        if (now === last) break;
        last = now;
      }
    }
    var verdict = judge(snap);
    if (verdict === 'whole') return;
    clearComposer(getComposer() || el);
    // A cap keeps the prompt's start, at least the signed-out 32,000 (measured: never less). Less,
    // or text that is not the prompt's start, is a fill that went wrong, not a cap to remember.
    var head = norm(snap.text);
    if (EXP.length > SAFE_CAP && verdict === 'short' && snap.kept >= SAFE_CAP && EXP_SQ.slice(0, head.length) === head) {
      throw new Error(TOO_LONG_TAG + ': Gemini keeps only ' + snap.kept + ' of ' + EXP.length
        + ' characters; the end of the prompt is missing, so it was not sent');
    }
    throw new Error('Gemini composer never registered the whole prompt, so it was not sent');
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
    await verifyComposerHoldsPrompt(getComposer());
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

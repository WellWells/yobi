import { buildGeminiTitleScript } from './geminiTitleScript';

export const GEMINI_INPUT_SELECTOR =
  'rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]';

export const GEMINI_COPY_BTN_SELECTOR = 'copy-button button';

/** Either half of the send control while a generation is running. */
export const GEMINI_STOP_SELECTOR =
  '[data-test-id="send-button-container"] mat-icon[fonticon="stop"], [data-test-id="stop-button"]';

/**
 * The sidebar's new-chat control. `[data-test-id="new-chat-button"]` on its own is the
 * `<gem-nav-list-item>` wrapper, and it ignores every click: measured against the live page on
 * 2026-09-16, a plain `.click()`, the inner button, `closest('a')` and a full pointer-event
 * sequence all left the thread untouched. The router link inside it clears the conversation in
 * ~145 ms with no page load. Gate: `test/geminiNewChat.test.ts`.
 */
export const GEMINI_NEW_CHAT_SELECTOR = '[data-test-id="new-chat-button"] a[href="/app"]';

export const INJECTED_GEMINI_WAIT_AND_READ_JS = `async function geminiWaitAndRead(baseline, copyBtnSel, opts) {
  opts = opts || {};
  var IDLE_LIMIT = opts.idleMs === undefined ? 300000 : opts.idleMs;
  var STABLE_MS = opts.stableMs === undefined ? 2500 : opts.stableMs;
  var STUCK_MS = opts.stuckMs === undefined ? 60000 : opts.stuckMs;
  var BOUNCE_MS = opts.bounceMs === undefined ? 3000 : opts.bounceMs;
  var POLL_MS = opts.pollMs === undefined ? 400 : opts.pollMs;
  var WANT_TITLE = !!opts.wantTitle;
  var RESP_BASELINE = opts.responseBaseline === undefined ? 0 : opts.responseBaseline;

  function lastResponse() {
    var responses = document.querySelectorAll('model-response');
    if (responses.length <= RESP_BASELINE) return null;
    return responses[responses.length - 1];
  }
  function readAnswerText() {
    var last = lastResponse();
    if (last) {
      var md = last.querySelector('message-content .markdown, .markdown');
      if (md && (md.innerText || '').trim()) return (md.innerText || '').trim();
      var mc = last.querySelector('message-content');
      if (mc && (mc.innerText || '').trim()) return (mc.innerText || '').trim();
      return '';
    }
    if (RESP_BASELINE > 0) return '';
    var allMc = document.querySelectorAll('message-content');
    if (allMc.length > 0) return (allMc[allMc.length - 1].innerText || '').trim();
    return '';
  }
  function isGenerating() {
    var c = document.querySelector('[data-test-id="send-button-container"]');
    if (c && c.querySelector('mat-icon[fonticon="stop"]')) return true;
    return !!document.querySelector('[data-test-id="stop-button"]');
  }
  function turnComplete() {
    var last = lastResponse();
    return !!(last && last.querySelector('message-actions'));
  }
  function copyButton() {
    var last = lastResponse();
    if (last) return last.querySelector(copyBtnSel);
    if (RESP_BASELINE > 0) return null;
    var all = document.querySelectorAll(copyBtnSel);
    return all.length > baseline ? all[all.length - 1] : null;
  }
  function copyButtonReady() {
    return !!copyButton();
  }
  function composerHasText() {
    var el = document.querySelector(${JSON.stringify(GEMINI_INPUT_SELECTOR)});
    return !!el && !!(el.innerText || '').trim();
  }
  function snackbarText() {
    var el = document.querySelector('.mdc-snackbar__label, simple-snack-bar, mat-snack-bar-container');
    return el ? (el.innerText || '').trim() : '';
  }

  var lastLen = -1;
  var lastChangeAt = null;
  var stableSince = null;
  var sawAnswer = false;
  var bounceSince = null;

  while (true) {
    if (copyButtonReady()) break;
    if (composerHasText()) {
      if (bounceSince === null) bounceSince = Date.now();
      if (Date.now() - bounceSince >= BOUNCE_MS) {
        var toast = snackbarText();
        throw new Error('GEMINI_BOUNCED: generation aborted and the prompt returned to the composer' + (toast ? ' — ' + toast : ''));
      }
    } else {
      bounceSince = null;
    }
    var text = readAnswerText();
    if (text.length > 0) sawAnswer = true;
    if (text.length !== lastLen) {
      lastLen = text.length;
      lastChangeAt = Date.now();
      stableSince = null;
    } else if (isGenerating() && !turnComplete() && Date.now() - lastChangeAt < STUCK_MS) {
      stableSince = null;
    } else if (text.length > 0 && !composerHasText()) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= STABLE_MS) break;
    } else {
      stableSince = null;
    }
    if (lastChangeAt !== null && Date.now() - lastChangeAt > IDLE_LIMIT) {
      if (sawAnswer && lastLen > 0) break;
      // A long think renders nothing at all while the stop button is up. Reporting that as a
      // sign-in wall shows a login window to an already signed-in user AND flips the shared
      // worker into interactive mode, which leaves the next task without its stealth preload.
      if (isGenerating()) {
        throw new Error('Gemini is still generating but produced no visible answer before the response timeout');
      }
      throw new Error('GEMINI_LOGIN_REQUIRED: Gemini produced no answer (sign-in required or blocked)');
    }
    await sleep(POLL_MS);
  }

  await sleep(150);

  var title = '';
  if (WANT_TITLE) {
    try {
      title = await ${buildGeminiTitleScript()};
    } catch(e) {}
  }

  var response = '';
  var lastCopyBtn = copyButton();
  if (lastCopyBtn) {
    response = (await interceptCopy(lastCopyBtn)) || '';
  }
  if (!response) response = readAnswerText();
  if (!response) throw new Error('Gemini answer element present but its text was empty');
  return { response: response, title: title };
}`;

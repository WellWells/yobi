import { buildGeminiTitleScript } from './geminiTitleScript';

export const GEMINI_INPUT_SELECTOR =
  'rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]';

/**
 * The response action row's copy control. Gemini used to tag it
 * `data-test-id="copy-button"` and no longer does — only the `<copy-button>`
 * custom element survived the change, so anchoring on the test id matched
 * nothing at all and silently cost every run its primary completion signal AND
 * the Markdown-preserving read path. The element name also keeps the old markup
 * matching, and code blocks render their own copy control without it, so a
 * half-streamed answer cannot satisfy this.
 */
export const GEMINI_COPY_BTN_SELECTOR = 'copy-button button';

export const INJECTED_GEMINI_WAIT_AND_READ_JS = `async function geminiWaitAndRead(baseline, copyBtnSel, opts) {
  opts = opts || {};
  // Give up only after this long with no change at all to the answer text.
  var IDLE_LIMIT = opts.idleMs === undefined ? 300000 : opts.idleMs;
  // Answer text unchanged AND nothing claiming to generate, continuously, this long -> done.
  var STABLE_MS = opts.stableMs === undefined ? 2500 : opts.stableMs;
  // How long a "generating" indicator is believed while the answer does not move.
  var STUCK_MS = opts.stuckMs === undefined ? 60000 : opts.stuckMs;
  // How long text may sit in the composer mid-generation before it counts as a bounce.
  var BOUNCE_MS = opts.bounceMs === undefined ? 3000 : opts.bounceMs;
  var POLL_MS = opts.pollMs === undefined ? 400 : opts.pollMs;
  var WANT_TITLE = !!opts.wantTitle;

  // Newest answer's clean text (no "Gemini said" screen-reader prefix). Selects the LAST
  // model-response in document order — ':last-of-type' would match every per-turn node and
  // return the OLDEST. The markdown node only exists once content renders, so this returns
  // '' until the first token — callers use that to tell "answer present" from "nothing yet".
  function lastResponse() {
    var responses = document.querySelectorAll('model-response');
    return responses.length > 0 ? responses[responses.length - 1] : null;
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
    var allMc = document.querySelectorAll('message-content');
    if (allMc.length > 0) return (allMc[allMc.length - 1].innerText || '').trim();
    return '';
  }
  function isGenerating() {
    var c = document.querySelector('[data-test-id="send-button-container"]');
    if (c && c.querySelector('mat-icon[fonticon="stop"]')) return true;
    return !!document.querySelector('[data-test-id="stop-button"]');
  }
  // Gemini renders the per-response action row (feedback / regenerate / copy) only once
  // the turn has finished streaming, which makes it a statement about THIS answer rather
  // than about the composer. The send button is not: it has been observed still showing
  // "stop" long after a turn completed, with the action row already rendered.
  function turnComplete() {
    var last = lastResponse();
    return !!(last && last.querySelector('message-actions'));
  }
  // Completion belongs to THIS turn, so ask the newest response whether it has grown its
  // action row rather than counting copy buttons across the page. A document-wide count is
  // only a proxy for that, and the recovery read starts from a baseline of 0 — on a page
  // that already carries a finished answer the proxy would be satisfied before this turn
  // wrote a single token, and the previous answer would be copied back as this one's.
  function copyButton() {
    var last = lastResponse();
    if (last) return last.querySelector(copyBtnSel);
    var all = document.querySelectorAll(copyBtnSel);
    return all.length > baseline ? all[all.length - 1] : null;
  }
  function copyButtonReady() {
    return !!copyButton();
  }
  // The composer is empty from the moment a send registers until the answer
  // completes — text reappearing there before completion means Gemini aborted
  // server-side and bounced the prompt back (the worker window takes no user
  // typing). Deliberately independent of the send/stop button state: bounces
  // have been observed both with the stop button stuck on AND with it reset
  // to the send state.
  function composerHasText() {
    var el = document.querySelector(${JSON.stringify(GEMINI_INPUT_SELECTOR)});
    return !!el && !!(el.innerText || '').trim();
  }
  function snackbarText() {
    var el = document.querySelector('.mdc-snackbar__label, simple-snack-bar, mat-snack-bar-container');
    return el ? (el.innerText || '').trim() : '';
  }

  // Completion is signalled by EITHER the copy button appearing (preferred: clicking it
  // yields real Markdown with tables/code intact) OR the answer text staying unchanged while
  // nothing credible claims to still be generating. Neither may be the only way out: both
  // are Gemini's own markup, and both have gone wrong in production — the copy button by
  // being renamed, the stop button by never clearing.
  var lastLen = -1;
  var lastChangeAt = null;
  var stableSince = null;
  var sawAnswer = false;
  var bounceSince = null;

  while (true) {
    if (copyButtonReady()) break;
    // Bounce check before anything else: a bounced generation either keeps the
    // stop button on forever (suppressing the stable-text exit below) or leaves
    // a dead turn with no answer growth — both would otherwise stall until the
    // idle limit. Debounced — right after a send click the composer can take a
    // beat to clear.
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
      // Still generating: only suppress the stable-text completion path so a mid-stream pause
      // isn't mistaken for "done". Do NOT reset the idle timer here — the idle guard below must
      // still fire on a truly frozen page so an answer already in the DOM is returned.
      //
      // The claim is believed only while it stays plausible. Gemini leaves the send button on
      // "stop" after some turns complete, and an indicator that says "generating" while not one
      // character has arrived for STUCK_MS is describing itself, not the answer — believing it
      // to the end left a finished answer unread for the full idle limit.
      stableSince = null;
    } else if (text.length > 0 && !composerHasText()) {
      // Stable-text completion additionally requires an empty composer: a bounce
      // that left partial answer text would otherwise win this exit over the
      // bounce check above and return a truncated answer.
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= STABLE_MS) break;
    } else {
      stableSince = null;
    }
    // Idle timeout: the answer text has not changed for IDLE_LIMIT (reset on every change above),
    // independent of the Stop button — so a page that finished but left its Stop button stuck still
    // returns its answer here rather than hanging. With an answer in hand, return it; with none,
    // surface sign-in required (a login wall streams nothing).
    if (lastChangeAt !== null && Date.now() - lastChangeAt > IDLE_LIMIT) {
      if (sawAnswer && lastLen > 0) break;
      throw new Error('GEMINI_LOGIN_REQUIRED: Gemini produced no answer (sign-in required or blocked)');
    }
    await sleep(POLL_MS);
  }

  await sleep(150);

  // Gemini names the conversation in its sidebar a beat after answering, so this
  // waits for the row belonging to THIS thread. A follow-up finds it on the first
  // poll and costs nothing; a brand-new chat pays the wait once, and an empty
  // result simply falls back to the question (see shared/conversationTitle).
  // Skipped entirely unless the caller wants a title — a flow step, an agent turn
  // or a search synthesis throws it away, and would only be paying for the wait.
  var title = '';
  if (WANT_TITLE) {
    try {
      title = await ${buildGeminiTitleScript()};
    } catch(e) {}
  }

  // Prefer the copy button (keeps Markdown formatting); fall back to the rendered text
  // when it is absent.
  var response = '';
  var lastCopyBtn = copyButton();
  if (lastCopyBtn) {
    response = (await interceptCopy(lastCopyBtn)) || '';
  }
  if (!response) response = readAnswerText();
  if (!response) throw new Error('Gemini answer element present but its text was empty');
  return { response: response, title: title };
}`;

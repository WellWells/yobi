import { buildGeminiTitleScript } from './geminiTitleScript';
import { INJECTED_READ_IMAGES_JS, readImagesCall } from './generatedImages';

/** A picture Gemini drew, inside the answer (2026-10-19, temporary and normal chat). */
export const GEMINI_GENERATED_IMAGE_SELECTOR = 'generated-image img';
/** How long a drawn picture may take to finish loading once the turn is over. */
const IMAGE_LOAD_MS = 30_000;

export const GEMINI_INPUT_SELECTOR =
  'rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]';

export const GEMINI_COPY_BTN_SELECTOR = 'copy-button button';

/** Either half of the send control while a generation is running. */
export const GEMINI_STOP_SELECTOR =
  '[data-test-id="send-button-container"] mat-icon[fonticon="stop"], [data-test-id="stop-button"]';

/** The sidebar's new-chat router link; the wrapper element around it ignores clicks. */
export const GEMINI_NEW_CHAT_SELECTOR = '[data-test-id="new-chat-button"] a[href="/app"]';

/** The side panel's temporary-chat toggle, found by its icon name (the label is localized). */
export const GEMINI_TEMPORARY_CHAT_BUTTON_SELECTOR = 'mat-icon[fonticon="gemini_chat_temp"]';

/** Present while the page is a temporary chat; Gemini has no URL for one. */
export const GEMINI_TEMPORARY_CHAT_ACTIVE_SELECTOR = 'chat-window.is-temporary-chat';

/**
 * Page function (needs `waitFor` in scope): true once the page is a temporary chat. The button
 * is a toggle, so it is pressed only on a normal page; without it (work and school accounts)
 * the answer is false and the send goes on as a normal chat.
 */
export const INJECTED_GEMINI_TEMPORARY_JS = `async function geminiEnterTemporaryChat() {
  function active() {
    return !!document.querySelector(${JSON.stringify(GEMINI_TEMPORARY_CHAT_ACTIVE_SELECTOR)});
  }
  if (active()) return true;
  var icon = document.querySelector(${JSON.stringify(GEMINI_TEMPORARY_CHAT_BUTTON_SELECTOR)});
  var btn = icon && icon.closest('button');
  if (!btn) return false;
  btn.click();
  try {
    await waitFor(active, 'temporary chat', 5000, 150);
  } catch (e) {}
  return active();
}`;

export const INJECTED_GEMINI_WAIT_AND_READ_JS = `async function geminiWaitAndRead(baseline, copyBtnSel, opts) {
  opts = opts || {};
  var IDLE_LIMIT = opts.idleMs === undefined ? 300000 : opts.idleMs;
  var STABLE_MS = opts.stableMs === undefined ? 2500 : opts.stableMs;
  var STUCK_MS = opts.stuckMs === undefined ? 60000 : opts.stuckMs;
  var BOUNCE_MS = opts.bounceMs === undefined ? 3000 : opts.bounceMs;
  var POLL_MS = opts.pollMs === undefined ? 400 : opts.pollMs;
  var WANT_TITLE = !!opts.wantTitle;
  var RESP_BASELINE = opts.responseBaseline === undefined ? 0 : opts.responseBaseline;
  var IMAGE_LOAD_MS = opts.imageLoadMs === undefined ? ${IMAGE_LOAD_MS} : opts.imageLoadMs;
  ${INJECTED_READ_IMAGES_JS}

  // A drawn picture carries its own copy control ("copy image"); only the answer's counts.
  function textCopyButtons(root) {
    var all = root.querySelectorAll(copyBtnSel);
    var own = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].closest('generated-image')) own.push(all[i]);
    }
    return own;
  }
  // count: pictures in the answer; loaded: those fully decoded. A picture is the answer too.
  function pictureState() {
    var last = lastResponse();
    var holders = last ? last.querySelectorAll('generated-image') : [];
    var loaded = 0;
    for (var i = 0; i < holders.length; i++) {
      var img = holders[i].querySelector('img');
      if (img && img.complete && img.naturalWidth > 0) loaded++;
    }
    return { count: holders.length, loaded: loaded };
  }
  function picturesReady(state) {
    return state.count > 0 && state.loaded === state.count;
  }

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
      // A picture's controls are not text: an answer that is only a picture has none.
      if (last.querySelector('generated-image')) return '';
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
    if (last) return textCopyButtons(last)[0] || null;
    if (RESP_BASELINE > 0) return null;
    var all = textCopyButtons(document);
    return all.length > baseline ? all[all.length - 1] : null;
  }
  // A picture still loading is not a finished answer, whatever the copy control says.
  function copyButtonReady() {
    if (!copyButton()) return false;
    var pics = pictureState();
    return pics.count === 0 || picturesReady(pics);
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
  var lastPics = '';
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
    var pics = pictureState();
    var picsKey = pics.count + '/' + pics.loaded;
    if (text.length > 0 || pics.count > 0) sawAnswer = true;
    if (text.length !== lastLen || picsKey !== lastPics) {
      lastLen = text.length;
      lastPics = picsKey;
      lastChangeAt = Date.now();
      stableSince = null;
    } else if (isGenerating() && !turnComplete() && Date.now() - lastChangeAt < STUCK_MS) {
      stableSince = null;
    } else if ((text.length > 0 || picturesReady(pics)) && (pics.count === 0 || picturesReady(pics)) && !composerHasText()) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= STABLE_MS) break;
    } else {
      stableSince = null;
    }
    if (lastChangeAt !== null && Date.now() - lastChangeAt > IDLE_LIMIT) {
      if (sawAnswer && (lastLen > 0 || pics.loaded > 0)) break;
      // Still generating with no visible text is a slow answer, not a sign-in wall.
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

  // Read after the text: the pictures are decoded by now, or given a little longer.
  var images = [];
  var answer = lastResponse();
  if (answer && answer.querySelector('generated-image')) {
    var loadDeadline = Date.now() + IMAGE_LOAD_MS;
    while (!picturesReady(pictureState()) && Date.now() < loadDeadline) await sleep(300);
    images = await ${readImagesCall(`answer.querySelectorAll(${JSON.stringify(GEMINI_GENERATED_IMAGE_SELECTOR)})`)};
  }
  if (!response && images.length === 0) throw new Error('Gemini answer element present but its text was empty');
  return { response: response, title: title, images: images };
}`;

import { PPLX_INPUT_SELECTORS, PPLX_RESPONSE_SELECTOR, PPLX_STOP_ICON_ID } from './perplexityReadScript';

/**
 * Icon ids of Perplexity's send control: pointing right on a new thread, up in a follow-up
 * composer. Matched WHOLE, never as a substring — the autocomplete rows under the landing
 * page composer carry `pplx-icon-arrow-up-right`, and six of them sit in this same
 * container, so a substring match hands back a suggestion instead of the send button.
 */
export const PPLX_SUBMIT_ICON_IDS = ['#pplx-icon-arrow-up', '#pplx-icon-arrow-right'];

/**
 * Putting a prompt into Perplexity's composer and getting it sent.
 *
 * The send control cannot be recognised by styling or position. Measured on the live page
 * (2026-09-17): `button.bg-button-bg` is the SEND button once the editor holds text, and the
 * VOICE MODE button — enabled, and happy to be clicked — when it does not. On a thread page
 * the send button is always present and merely disabled while the composer is empty. So the
 * only honest reading of "ready to send" is a whole-id icon match on an enabled control, and
 * the only honest reading of "it went" is the page acting on the click. Everything here is
 * built to never confuse "not ready yet" with "ready", and to fail out loud rather than hand
 * back a run that quietly waits for an answer nobody asked for.
 */
export const PPLX_SUBMIT_JS = `async function perplexitySubmit(promptText, opts) {
  opts = opts || {};
  var FIND_MS    = opts.findMs    === undefined ? 15000 : opts.findMs;
  var FILL_MS    = opts.fillMs    === undefined ? 15000 : opts.fillMs;
  var SEND_MS    = opts.sendMs    === undefined ? 15000 : opts.sendMs;
  var ACCEPT_MS  = opts.acceptMs  === undefined ? 2500  : opts.acceptMs;
  var CONFIRM_MS = opts.confirmMs === undefined ? 3000  : opts.confirmMs;
  var RETRY_MS   = opts.retryMs   === undefined ? 150   : opts.retryMs;
  var CLICK_TRIES = opts.clickTries === undefined ? 3   : opts.clickTries;

  var INPUT_SELECTORS = ${JSON.stringify(PPLX_INPUT_SELECTORS)};
  var SUBMIT_ICON_IDS = ${JSON.stringify(PPLX_SUBMIT_ICON_IDS)};
  var STOP_ICON_ID = ${JSON.stringify(PPLX_STOP_ICON_ID)};
  // Sampled at the click, not at the top: filling can take seconds, and an answer from the
  // previous turn finishing in that window would otherwise look like proof of this one.
  var answersAtClick = -1;

  function getComposer() {
    for (var i = 0; i < INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(INPUT_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function composerText() {
    var el = getComposer();
    return el ? (el.innerText || '').trim() : '';
  }

  function submitIconHref(useEl) {
    return useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
  }

  function buttonWearsIcon(button, iconIds) {
    var uses = button.querySelectorAll('use');
    for (var i = 0; i < uses.length; i++) {
      var href = submitIconHref(uses[i]);
      for (var k = 0; k < iconIds.length; k++) {
        if (href === iconIds[k]) return true;
      }
    }
    return false;
  }

  function askContainer() {
    return document.querySelector('[data-ask-input-container="true"]');
  }

  /** Perplexity puts a stop control where the send button was for as long as it answers. */
  function isGenerating() {
    var container = askContainer();
    if (!container) return false;
    var buttons = container.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttonWearsIcon(buttons[i], [STOP_ICON_ID])) return true;
    }
    return false;
  }

  function answerCount() {
    return document.querySelectorAll(${JSON.stringify(PPLX_RESPONSE_SELECTOR)}).length;
  }

  /** The send control only when the page says it can be pressed; null is a real answer. */
  function readySubmitControl() {
    var container = askContainer();
    if (!container) return null;
    var buttons = container.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      if (!buttonWearsIcon(button, SUBMIT_ICON_IDS)) continue;
      if (button.disabled) continue;
      if (button.getAttribute('aria-disabled') === 'true') continue;
      return button;
    }
    return null;
  }

  /**
   * Lexical applies edits from \`beforeinput\` and owns the DOM it renders, so assigning
   * \`textContent\` is put straight back and the next paste appends to the leftover draft —
   * which Perplexity restores across reloads. Deleting over a selection that spans the
   * editor is what it actually honours.
   */
  function clearComposer(el) {
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'deleteContentBackward'
    }));
  }

  async function emptyComposer() {
    var el = getComposer();
    if (!el) return false;
    if (!composerText()) return true;
    clearComposer(el);
    try {
      await waitFor(function() { return !composerText(); }, 'Perplexity composer cleared', ACCEPT_MS, 60);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** True once the editor itself holds the prompt — not merely the DOM under it. */
  async function fillOnce() {
    if (!await emptyComposer()) return false;
    var el = getComposer();
    if (!el) return false;

    el.focus();
    var dt = new DataTransfer();
    dt.setData('text/plain', promptText);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    try {
      await waitFor(function() { return !!composerText(); }, 'prompt in Perplexity composer', ACCEPT_MS, 60);
      return true;
    } catch (e) {}

    try { document.execCommand('insertText', false, promptText); } catch (e) {}
    try {
      await waitFor(function() { return !!composerText(); }, 'prompt in Perplexity composer', ACCEPT_MS, 60);
      return true;
    } catch (e) {}
    return false;
  }

  async function fillComposer() {
    var deadline = Date.now() + FILL_MS;
    while (Date.now() < deadline) {
      if (await fillOnce()) return true;
      await sleep(RETRY_MS);
    }
    return false;
  }

  /**
   * Three independent ways of seeing that the prompt went. Emptying the composer is the
   * quickest — measured at ~200ms — but it is not the only one, and treating it as the only
   * one turns a send that landed into a reported failure, or worse, into a second send.
   */
  function sendLanded() {
    if (answersAtClick >= 0 && answerCount() > answersAtClick) return true;
    if (isGenerating()) return true;
    var el = getComposer();
    return !!el && !composerText();
  }

  async function confirmSent() {
    try {
      await waitFor(sendLanded, 'Perplexity accepted the prompt', CONFIRM_MS, 60);
      return true;
    } catch (e) {
      return false;
    }
  }

  await waitFor(function() { return !!getComposer(); }, 'Perplexity input area', FIND_MS, 200);

  if (!await fillComposer()) {
    throw new Error('Perplexity never registered the prompt (the composer would not take it)');
  }

  var sent = false;
  var clicks = 0;
  var deadline = Date.now() + SEND_MS;
  while (!sent && clicks < CLICK_TRIES && Date.now() < deadline) {
    // A click that landed late still landed: re-filling here would send the prompt twice.
    if (clicks > 0 && sendLanded()) { sent = true; break; }
    // The composer can be re-mounted under us between turns, which drops the prompt and
    // leaves the send control disabled forever. Put it back rather than wait on a dead page.
    if (!composerText() && !await fillComposer()) break;
    var button = readySubmitControl();
    if (!button) {
      await sleep(RETRY_MS);
      continue;
    }
    if (clicks === 0) answersAtClick = answerCount();
    button.click();
    clicks += 1;
    sent = await confirmSent();
  }

  if (!sent && composerText() && !isGenerating()) {
    var el = getComposer();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
    }));
    await sleep(40);
    el.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
    sent = await confirmSent();
  }

  if (!sent) {
    throw new Error('Perplexity never accepted the prompt (the send control never took a click)');
  }
}`;

/**
 * chat.deepseek.com, measured signed in (zh-CN UI). Every hook is structural: the
 * page's classes are hashed except its design-system ones (`ds-*`), and its labels follow the
 * account language.
 *
 * - The composer is a plain React `<textarea>`; its value takes the native setter plus `input`.
 * - The send control is the composer's filled primary circle. Idle with an empty composer it is
 *   `ds-button--disabled`; while an answer streams it turns into the stop control and is enabled
 *   with the composer empty.
 * - Every turn is a virtual-list row keyed by its message id: the user's rows are negative, the
 *   answers positive and growing. A long thread unmounts old rows, so a new answer is the one
 *   keyed above every answer seen before the send, never "one more row than before".
 */

export const DEEPSEEK_INPUT_SELECTOR = 'textarea';
export const DEEPSEEK_SEND_SELECTOR = '.ds-button--primary.ds-button--filled.ds-button--circle';
export const DEEPSEEK_TURN_SELECTOR = '[data-virtual-list-item-key]';
export const DEEPSEEK_TURN_KEY_ATTR = 'data-virtual-list-item-key';
export const DEEPSEEK_ANSWER_CONTENT_SELECTOR = '.ds-assistant-message-main-content';
/** The design system's disabled modifier; `aria-disabled` is honoured as well. */
export const DEEPSEEK_DISABLED_CLASS = 'ds-button--disabled';

/** Helpers shared by the send and read scripts (one scope in production, so defined once here). */
export const DEEPSEEK_PAGE_HELPERS_JS = `
  var DS_INPUT = ${JSON.stringify(DEEPSEEK_INPUT_SELECTOR)};
  var DS_SEND = ${JSON.stringify(DEEPSEEK_SEND_SELECTOR)};
  var DS_TURN = ${JSON.stringify(DEEPSEEK_TURN_SELECTOR)};
  var DS_TURN_KEY = ${JSON.stringify(DEEPSEEK_TURN_KEY_ATTR)};
  var DS_DISABLED = ${JSON.stringify(DEEPSEEK_DISABLED_CLASS)};

  function dsComposer() {
    return document.querySelector(DS_INPUT);
  }

  function dsComposerText() {
    var el = dsComposer();
    return el ? String(el.value || '') : '';
  }

  /** The send control that sits with the composer; none on a page without one. */
  function dsSendControl() {
    var el = dsComposer();
    for (var i = 0; el && i < 8; i++) {
      el = el.parentElement;
      if (!el) break;
      var found = el.querySelector(DS_SEND);
      if (found) return found;
    }
    return null;
  }

  function dsIsDisabled(button) {
    if (!button) return true;
    if ((' ' + button.className + ' ').indexOf(' ' + DS_DISABLED + ' ') !== -1) return true;
    return button.getAttribute('aria-disabled') === 'true';
  }

  /** Up from the click until the last token: the send control is the stop control, enabled over an empty composer. */
  function dsIsGenerating() {
    var button = dsSendControl();
    if (!button || dsIsDisabled(button)) return false;
    return dsComposerText().trim() === '';
  }

  function dsTurnKey(row) {
    var n = Number(row.getAttribute(DS_TURN_KEY));
    return isFinite(n) ? n : 0;
  }

  /** The highest answer key on the page; 0 on a new conversation. */
  function dsLatestAnswerKey() {
    var rows = document.querySelectorAll(DS_TURN);
    var max = 0;
    for (var i = 0; i < rows.length; i++) {
      var key = dsTurnKey(rows[i]);
      if (key > max) max = key;
    }
    return max;
  }

  /** The answer row keyed above \`afterKey\`, newest first; null until one exists. */
  function dsAnswerAfter(afterKey) {
    var rows = document.querySelectorAll(DS_TURN);
    var best = null;
    var bestKey = afterKey;
    for (var i = 0; i < rows.length; i++) {
      var key = dsTurnKey(rows[i]);
      if (key > bestKey) { best = rows[i]; bestKey = key; }
    }
    return best;
  }

  /** The user's own turn keyed above \`afterKey\` (user keys are negative). */
  function dsHasUserTurnAfter(afterKey) {
    var rows = document.querySelectorAll(DS_TURN);
    for (var i = 0; i < rows.length; i++) {
      var key = dsTurnKey(rows[i]);
      if (key < 0 && -key > afterKey) return true;
    }
    return false;
  }
`;

/**
 * Fills the composer and presses send once, confirmed by the page. Resolves to the highest answer
 * key seen at the click — the read waits for an answer above it.
 */
export const DEEPSEEK_SUBMIT_JS = `async function deepseekSubmit(promptText, opts) {
  opts = opts || {};
  var FIND_MS    = opts.findMs    === undefined ? 15000 : opts.findMs;
  var FILL_MS    = opts.fillMs    === undefined ? 10000 : opts.fillMs;
  var READY_MS   = opts.readyMs   === undefined ? 10000 : opts.readyMs;
  var CONFIRM_MS = opts.confirmMs === undefined ? 8000  : opts.confirmMs;
  var RETRY_MS   = opts.retryMs   === undefined ? 150   : opts.retryMs;

  await waitFor(function() { return !!dsComposer(); }, 'DeepSeek input area', FIND_MS, 200);

  function fillOnce() {
    var el = dsComposer();
    if (!el) return false;
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, promptText);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  var deadline = Date.now() + FILL_MS;
  var taken = false;
  while (Date.now() < deadline) {
    if (fillOnce()) {
      await sleep(80);
      // React re-renders the controlled value from its own state; a value it did not take snaps back.
      if (dsComposerText() === promptText) { taken = true; break; }
    }
    await sleep(RETRY_MS);
  }
  if (!taken) throw new Error('DeepSeek composer never registered the prompt');

  var button = null;
  try {
    button = await waitFor(function() {
      var b = dsSendControl();
      return b && !dsIsDisabled(b) ? b : null;
    }, 'DeepSeek send button', READY_MS, 100);
  } catch (e) {
    throw new Error('DeepSeek send button is not available');
  }

  var baseline = dsLatestAnswerKey();
  button.click();

  // A new answer or user row, or the composer emptying with the stop control up, proves the send.
  try {
    await waitFor(function() {
      if (dsAnswerAfter(baseline)) return true;
      if (dsHasUserTurnAfter(baseline)) return true;
      return dsComposerText() === '' && dsIsGenerating();
    }, 'DeepSeek accepted the prompt', CONFIRM_MS, 80);
  } catch (e) {
    throw new Error('DeepSeek never accepted the prompt (the send control never took the click)');
  }
  return { baseline: baseline, path: location.pathname };
}`;

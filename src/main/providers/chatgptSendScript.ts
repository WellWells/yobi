export const CHATGPT_USER_TURN_SELECTOR = '[data-message-author-role="user"]';
export const CHATGPT_ASSISTANT_TURN_SELECTOR = '[data-message-author-role="assistant"]';

export const CHATGPT_SUBMIT_JS = `async function chatgptSubmit(promptText, opts) {
  opts = opts || {};
  // 30s: ChatGPT turns a long paste into a TXT attachment and keeps the send
  // button disabled until that upload finishes.
  var SEND_MS = opts.sendMs === undefined ? 30000 : opts.sendMs;
  // 15s: covers a page still loading its conversation history.
  var FILL_MS = opts.fillMs === undefined ? 15000 : opts.fillMs;
  // 5s: how long a click has to turn into a user turn before it is retried.
  var CONFIRM_MS = opts.confirmMs === undefined ? 5000 : opts.confirmMs;
  // 2.5s: how long to give React to register a fill before writing it again.
  var ACCEPT_MS = opts.acceptMs === undefined ? 2500 : opts.acceptMs;
  // 600ms: how long the written text has to show up in the composer at all.
  var WRITE_MS = opts.writeMs === undefined ? 600 : opts.writeMs;
  // 300ms: the composer must be the same node twice this far apart before it is
  // treated as hydrated rather than mid-render.
  var SETTLE_MS = opts.settleMs === undefined ? 300 : opts.settleMs;

  var INPUT_SELECTORS = [
    '#prompt-textarea[contenteditable="true"]',
    'form[data-type="unified-composer"] #prompt-textarea',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"][role="textbox"][aria-multiline="true"]'
  ];

  // Re-query every time rather than caching: React can replace the composer node
  // (zero-state to conversation transition, late hydration) and every action on a
  // detached node silently no-ops.
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
  function countUserTurns() {
    return document.querySelectorAll(${JSON.stringify(CHATGPT_USER_TURN_SELECTOR)}).length;
  }
  function countAssistantTurns() {
    return document.querySelectorAll(${JSON.stringify(CHATGPT_ASSISTANT_TURN_SELECTOR)}).length;
  }
  function readySendButton() {
    var b = document.querySelector('button[data-testid="send-button"]');
    if (!b || b.disabled) return null;
    if (b.getAttribute('aria-disabled') === 'true') return null;
    return b;
  }

  function fillOnce(el) {
    el.focus();
    // selectAll before inserting means a retry REPLACES the previous attempt
    // instead of appending, so re-filling can never duplicate the prompt.
    try { document.execCommand('selectAll', false, null); } catch (e) {}
    var dt = new DataTransfer();
    dt.setData('text/plain', promptText);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if (!(el.innerText || '').trim()) {
      try { document.execCommand('insertText', false, promptText); } catch (e) {}
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText'
    }));
  }

  // "The composer exists" is not "the composer is ready". React puts the
  // contenteditable in the DOM well before its own state is wired to it, and it
  // can still REPLACE the node while hydrating. Filling into that window is the
  // failure this guards: the write lands in the DOM (so any check of our own
  // text passes) while React's composer state stays empty, the send button never
  // enables, and the run spins out having typed into a node nobody is reading.
  //
  // Waiting for the node to stop being swapped is the condition that actually
  // matters — a fixed delay would be a guess at the same thing.
  async function waitForStableComposer() {
    var deadline = Date.now() + FILL_MS;
    while (Date.now() < deadline) {
      var first = getComposer();
      if (first) {
        await sleep(SETTLE_MS);
        if (getComposer() === first) return first;
        continue;
      }
      await sleep(SETTLE_MS);
    }
    return null;
  }

  function clearComposer(el) {
    try { document.execCommand('selectAll', false, null); } catch (e) {}
    while (el.firstChild) el.removeChild(el.firstChild);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'deleteContentBackward'
    }));
  }

  // Acceptance is the SEND BUTTON becoming enabled, not our own text being in the
  // DOM. ChatGPT keeps that button disabled while its state says the composer is
  // empty, so an enabled button is the page telling us it really registered the
  // prompt — the one thing a write React ignored cannot produce.
  async function fillComposer() {
    var deadline = Date.now() + FILL_MS;
    while (Date.now() < deadline) {
      var el = await waitForStableComposer();
      if (!el) break;
      fillOnce(el);

      // Stage one: did the write reach the DOM at all? A composer mid-render can
      // swallow it outright. Retrying is always right here — there is nothing in
      // the page yet that another attempt could duplicate.
      var inDom = false;
      try {
        await waitFor(function() { return !!composerText(); }, 'prompt in composer', WRITE_MS, 50);
        inDom = true;
      } catch (e) {}

      if (inDom) {
        // Stage two: did REACT take it? The send button enabling is the page
        // saying so. The composer emptying on its own counts too — that is a long
        // paste being converted into a TXT attachment, and the send loop waits
        // out the upload rather than writing the prompt in again beside it.
        try {
          await waitFor(function() {
            return !!readySendButton() || !composerText();
          }, 'ChatGPT registered the prompt', ACCEPT_MS, 100);
          return true;
        } catch (e) {}
        // In the composer with the button dead: React never saw the write. Clear
        // it so the next attempt replaces rather than appends.
        var stale = getComposer();
        if (stale) clearComposer(stale);
      }
      await sleep(SETTLE_MS);
    }
    return false;
  }

  if (!await fillComposer()) {
    throw new Error('ChatGPT composer never registered the prompt (page not interactive)');
  }

  // Taken AFTER the composer is loaded and filled — as late as possible, so a
  // conversation still painting its history cannot land turns after it.
  var userBaseline = countUserTurns();
  var assistantBaseline = countAssistantTurns();

  var sent = false;
  var deadline = Date.now() + SEND_MS;
  while (!sent && Date.now() < deadline) {
    if (countUserTurns() > userBaseline) { sent = true; break; }
    var btn = readySendButton();
    if (!btn) {
      // No enabled send button yet. fillComposer already proved the prompt was
      // registered, so this is the page working — most often a long paste still
      // uploading as a TXT attachment. Waiting is right; re-filling here would
      // write the prompt in a second time alongside that attachment.
      await sleep(150);
      continue;
    }
    btn.click();
    // The only proof of a send that an empty composer cannot fake.
    try {
      await waitFor(function() {
        return countUserTurns() > userBaseline;
      }, 'ChatGPT accepted the message', CONFIRM_MS, 100);
      sent = true;
    } catch (e) {}
    if (!sent) await sleep(150);
  }

  if (!sent) {
    // Enter as a last resort, and only with text still in the composer — Enter on
    // an empty composer is a no-op, so this cannot double-send.
    var el = getComposer();
    if (el && composerText()) {
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
      }));
      await sleep(50);
      el.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      try {
        await waitFor(function() {
          return countUserTurns() > userBaseline;
        }, 'ChatGPT accepted the message', CONFIRM_MS, 100);
        sent = true;
      } catch (e) {}
    }
  }

  if (!sent) {
    // Reported rather than swallowed: continuing here is what returned the
    // previous answer as if it were this one.
    throw new Error('ChatGPT never accepted the message (no new user turn appeared)');
  }

  return { assistantBaseline: assistantBaseline };
}`;

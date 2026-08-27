export const CHATGPT_USER_TURN_SELECTOR = '[data-message-author-role="user"]';
export const CHATGPT_ASSISTANT_TURN_SELECTOR = '[data-message-author-role="assistant"]';
export const CHATGPT_ATTACHMENT_TILE_SELECTOR = '[role="group"][aria-label]';

export const CHATGPT_SUBMIT_JS = `async function chatgptSubmit(promptText, opts) {
  opts = opts || {};
  var SEND_MS = opts.sendMs === undefined ? 30000 : opts.sendMs;
  var FILL_MS = opts.fillMs === undefined ? 15000 : opts.fillMs;
  var CONFIRM_MS = opts.confirmMs === undefined ? 5000 : opts.confirmMs;
  var ACCEPT_MS = opts.acceptMs === undefined ? 2500 : opts.acceptMs;
  var WRITE_MS = opts.writeMs === undefined ? 600 : opts.writeMs;
  var SETTLE_MS = opts.settleMs === undefined ? 300 : opts.settleMs;

  var INPUT_SELECTORS = [
    '#prompt-textarea[contenteditable="true"]',
    'form[data-type="unified-composer"] #prompt-textarea',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"][role="textbox"][aria-multiline="true"]'
  ];

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
  function composerTiles() {
    var form = document.querySelector('form[data-type="unified-composer"]');
    return form ? form.querySelectorAll(${JSON.stringify(CHATGPT_ATTACHMENT_TILE_SELECTOR)}).length : 0;
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

  async function fillOnce(el) {
    el.focus();
    try { document.execCommand('selectAll', false, null); } catch (e) {}
    var dt = new DataTransfer();
    dt.setData('text/plain', promptText);
    var tilesBefore = composerTiles();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));

    var landed = false;
    try {
      await waitFor(function() {
        return !!composerText() || composerTiles() > tilesBefore;
      }, 'prompt in composer', WRITE_MS, 50);
      landed = true;
    } catch (e) {}
    if (!landed) {
      try { document.execCommand('insertText', false, promptText); } catch (e) {}
      landed = !!composerText();
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText'
    }));
    return landed;
  }

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

  async function fillComposer() {
    var deadline = Date.now() + FILL_MS;
    while (Date.now() < deadline) {
      var el = await waitForStableComposer();
      if (!el) break;

      var inDom = await fillOnce(el);

      if (inDom) {
        try {
          await waitFor(function() {
            return !!readySendButton() || !composerText();
          }, 'ChatGPT registered the prompt', ACCEPT_MS, 100);
          return true;
        } catch (e) {}
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

  var userBaseline = countUserTurns();
  var assistantBaseline = countAssistantTurns();

  var sent = false;
  var deadline = Date.now() + SEND_MS;
  while (!sent && Date.now() < deadline) {
    if (countUserTurns() > userBaseline) { sent = true; break; }
    var btn = readySendButton();
    if (!btn) {
      await sleep(150);
      continue;
    }
    btn.click();
    try {
      await waitFor(function() {
        return countUserTurns() > userBaseline;
      }, 'ChatGPT accepted the message', CONFIRM_MS, 100);
      sent = true;
    } catch (e) {}
    if (!sent) await sleep(150);
  }

  if (!sent) {
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
    throw new Error('ChatGPT never accepted the message (no new user turn appeared)');
  }

  return { assistantBaseline: assistantBaseline };
}`;

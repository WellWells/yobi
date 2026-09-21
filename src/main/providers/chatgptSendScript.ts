export const CHATGPT_USER_TURN_SELECTOR = '[data-message-author-role="user"]';
export const CHATGPT_ASSISTANT_TURN_SELECTOR = '[data-message-author-role="assistant"]';
export const CHATGPT_ATTACHMENT_TILE_SELECTOR = '[role="group"][aria-label]';

/** Every shape the composer has taken. One source, shared with the page-reuse gate. */
export const CHATGPT_INPUT_SELECTORS = [
  '#prompt-textarea[contenteditable="true"]',
  'form[data-type="unified-composer"] #prompt-textarea',
  'div[contenteditable="true"]#prompt-textarea',
  'div[contenteditable="true"][role="textbox"][aria-multiline="true"]',
];

/** Present only while ChatGPT is streaming an answer. */
export const CHATGPT_STOP_SELECTOR = 'button[data-testid="stop-button"], [data-testid="stop-button"]';

export const CHATGPT_SUBMIT_JS = `async function chatgptSubmit(promptText, opts) {
  opts = opts || {};
  var SEND_MS = opts.sendMs === undefined ? 30000 : opts.sendMs;
  var FILL_MS = opts.fillMs === undefined ? 15000 : opts.fillMs;
  var CONFIRM_MS = opts.confirmMs === undefined ? 5000 : opts.confirmMs;
  var ACCEPT_MS = opts.acceptMs === undefined ? 2500 : opts.acceptMs;
  var WRITE_MS = opts.writeMs === undefined ? 600 : opts.writeMs;
  var SETTLE_MS = opts.settleMs === undefined ? 300 : opts.settleMs;

  var INPUT_SELECTORS = ${JSON.stringify(CHATGPT_INPUT_SELECTORS)};

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

  async function fillOnce(el) {
    el.focus();
    try { document.execCommand('selectAll', false, null); } catch (e) {}
    // Native text insertion bypasses paste handlers that turn long prompts into files.
    try { document.execCommand('insertText', false, promptText); } catch (e) {}
    var landed = false;
    try {
      await waitFor(function() {
        return !!composerText();
      }, 'prompt in composer', WRITE_MS, 50);
      landed = true;
    } catch (e) {}
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
            return !!readySendButton() && !!composerText();
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
  var previousUsers = Array.from(document.querySelectorAll(${JSON.stringify(CHATGPT_USER_TURN_SELECTOR)}));
  var previousUserIds = previousUsers.map(function(turn) { return turn.getAttribute('data-message-id'); }).filter(Boolean);
  function hasAcceptedMessage() {
    var turns = document.querySelectorAll(${JSON.stringify(CHATGPT_USER_TURN_SELECTOR)});
    var latest = turns[turns.length - 1];
    if (!latest) return false;
    var id = latest.getAttribute('data-message-id');
    if (id && previousUserIds.indexOf(id) >= 0) return false;
    if (!id && previousUsers.indexOf(latest) >= 0) return false;
    // A new message ID plus a consumed draft is independent of display formatting.
    if (id && !composerText()) return true;
    // Collapsible turns include localized show-more controls outside the actual body.
    var body = latest.querySelector('[data-testid="collapsible-user-message-content"], .rich-text-user-turn, .whitespace-pre-wrap') || latest;
    var expected = promptText.replace(/\\s+/g, ' ').trim();
    return (body.innerText || '').replace(/\\s+/g, ' ').trim() === expected ||
      (body.textContent || '').replace(/\\s+/g, ' ').trim() === expected;
  }
  var assistantBaseline = countAssistantTurns();
  // Handed to the read loop so it can tell "a new answer arrived" from "the count happens to be
  // the same again" — ChatGPT unmounts an old turn as it mounts a new one once a conversation
  // gets long, and the count alone then never moves.
  var assistantTurns = document.querySelectorAll(${JSON.stringify(CHATGPT_ASSISTANT_TURN_SELECTOR)});
  var lastAssistantTurn = assistantTurns[assistantTurns.length - 1] || null;
  var lastAssistantId = lastAssistantTurn ? (lastAssistantTurn.getAttribute('data-message-id') || null) : null;

  var sent = false;
  var clicked = false;
  var deadline = Date.now() + SEND_MS;
  while (!sent && Date.now() < deadline) {
    if (hasAcceptedMessage()) { sent = true; break; }
    // A click with an uncertain outcome must never become a second submission.
    if (clicked) { await sleep(100); continue; }
    var btn = readySendButton();
    if (!btn) {
      await sleep(150);
      continue;
    }
    clicked = true;
    btn.click();
    try {
      await waitFor(function() {
        return hasAcceptedMessage();
      }, 'ChatGPT accepted the message', CONFIRM_MS, 100);
      sent = true;
    } catch (e) {}
    if (!sent) await sleep(150);
  }

  if (!sent && !clicked) {
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
          return hasAcceptedMessage();
        }, 'ChatGPT accepted the message', CONFIRM_MS, 100);
        sent = true;
      } catch (e) {}
    }
  }

  if (!sent) {
    throw new Error('ChatGPT never accepted the message (no new user turn appeared; clicked=' + clicked + ', users=' + userBaseline + '->' + countUserTurns() + ')');
  }

  return {
    assistantBaseline: assistantBaseline,
    lastAssistantTurn: lastAssistantTurn,
    lastAssistantId: lastAssistantId
  };
}`;

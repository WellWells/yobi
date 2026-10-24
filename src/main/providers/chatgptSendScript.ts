/*
 * Two chatgpt.com page generations are matched: the one with data-testid hooks, and the redesign
 * built on `form[data-chatgpt-composer]` and per-message search units. Neither repeats the other's
 * markers, so every selector below lists both without double counting.
 */
export const CHATGPT_COMPOSER_FORM_SELECTOR = 'form[data-chatgpt-composer], form[data-type="unified-composer"]';
export const CHATGPT_USER_TURN_SELECTOR = '[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]';
/**
 * The pictures ChatGPT drew for an answer (2026-10-19, normal chat). The redesigned page gives
 * such a message no `:assistant` unit — only `data-chatgpt-search-message-ids` around the gallery —
 * so the gallery itself counts as the answer; without it a picture-only answer was never seen.
 */
export const CHATGPT_IMAGE_GALLERY_SELECTOR = '[data-testid="generated-image-gallery"]';
export const CHATGPT_ASSISTANT_TURN_SELECTOR = `[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], ${CHATGPT_IMAGE_GALLERY_SELECTOR}`;
/** One per attached file. Redesigned page: the children of the composer's attachment strip. */
export const CHATGPT_ATTACHMENT_TILE_SELECTOR = '[role="group"][aria-label], [data-composer-attachments] > div > *';
/** Absent while the composer is empty (a voice button takes its place) and while answering. */
export const CHATGPT_SEND_SELECTOR = 'button[data-testid="send-button"], form[data-chatgpt-composer] button[type="submit"]';

/** Every shape the composer has taken. One source, shared with the page-reuse gate. */
export const CHATGPT_INPUT_SELECTORS = [
  'form[data-chatgpt-composer] [contenteditable="true"][role="textbox"]',
  '#prompt-textarea[contenteditable="true"]',
  'form[data-type="unified-composer"] #prompt-textarea',
  'div[contenteditable="true"]#prompt-textarea',
  'div[contenteditable="true"][role="textbox"][aria-multiline="true"]',
];

/**
 * Present only while ChatGPT is answering. The redesigned stop button has no marker but its
 * localized label, so the answer's own turn state stands in for it.
 */
export const CHATGPT_STOP_SELECTOR = 'button[data-testid="stop-button"], [data-testid="stop-button"], [data-talvt-turn-state="in_progress"]';

/** A message's id in either page generation (page script: needs no helpers in scope). */
export const CHATGPT_MESSAGE_ID_JS = `function chatgptMessageId(el) {
  if (!el) return null;
  // A picture gallery is inside its message; the message carries the id.
  if (!el.hasAttribute('data-message-id') && !el.hasAttribute('data-chatgpt-search-message-ids') && el.closest) {
    el = el.closest('[data-message-id], [data-chatgpt-search-message-ids]') || el;
  }
  var id = el.getAttribute('data-message-id');
  if (id) return id;
  var ids = (el.getAttribute('data-chatgpt-search-message-ids') || '').split(' ').filter(Boolean);
  return ids.length ? ids[ids.length - 1] : null;
}`;

export const CHATGPT_SUBMIT_JS = `async function chatgptSubmit(promptText, opts) {
  opts = opts || {};
  var SEND_MS = opts.sendMs === undefined ? 30000 : opts.sendMs;
  var FILL_MS = opts.fillMs === undefined ? 15000 : opts.fillMs;
  var CONFIRM_MS = opts.confirmMs === undefined ? 5000 : opts.confirmMs;
  var ACCEPT_MS = opts.acceptMs === undefined ? 2500 : opts.acceptMs;
  var WRITE_MS = opts.writeMs === undefined ? 600 : opts.writeMs;
  var SETTLE_MS = opts.settleMs === undefined ? 300 : opts.settleMs;

  var INPUT_SELECTORS = ${JSON.stringify(CHATGPT_INPUT_SELECTORS)};
  ${CHATGPT_MESSAGE_ID_JS}

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
    var b = document.querySelector(${JSON.stringify(CHATGPT_SEND_SELECTOR)});
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
  var previousUserIds = previousUsers.map(chatgptMessageId).filter(Boolean);
  function hasAcceptedMessage() {
    var turns = document.querySelectorAll(${JSON.stringify(CHATGPT_USER_TURN_SELECTOR)});
    var latest = turns[turns.length - 1];
    if (!latest) return false;
    var id = chatgptMessageId(latest);
    if (id && previousUserIds.indexOf(id) >= 0) return false;
    if (!id && previousUsers.indexOf(latest) >= 0) return false;
    // A new message ID plus a consumed draft is independent of display formatting.
    if (id && !composerText()) return true;
    // Collapsible turns include localized show-more controls outside the actual body.
    var body = latest.querySelector('[data-testid="collapsible-user-message-content"], .rich-text-user-turn, .whitespace-pre-wrap, [data-user-message-bubble] [dir="auto"]') || latest;
    var expected = promptText.replace(/\\s+/g, ' ').trim();
    return (body.innerText || '').replace(/\\s+/g, ' ').trim() === expected ||
      (body.textContent || '').replace(/\\s+/g, ' ').trim() === expected;
  }
  var assistantBaseline = countAssistantTurns();
  // Handed to the read loop, which tells a new answer by turn identity: the count alone may not grow.
  var assistantTurns = document.querySelectorAll(${JSON.stringify(CHATGPT_ASSISTANT_TURN_SELECTOR)});
  var lastAssistantTurn = assistantTurns[assistantTurns.length - 1] || null;
  var lastAssistantId = chatgptMessageId(lastAssistantTurn);

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

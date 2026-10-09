import { CLAUDE_USAGE_LIMIT_JS } from './claudeUsageLimit';

/*
 * claude.ai's composer, found by `data-testid` (labels are localized). `insertText` keeps long prompts
 * as text rather than a pasted-file attachment. While Claude answers the send button is replaced by
 * a stop button, so "the send button is gone" reads as "generating".
 */
export const CLAUDE_INPUT_SELECTOR = '[data-testid="chat-input"]';
export const CLAUDE_SEND_SELECTOR = '[data-testid="chat-input-send"]';
export const CLAUDE_USER_TURN_SELECTOR = '[data-testid="user-message"]';
export const CLAUDE_ASSISTANT_TURN_SELECTOR = '[data-testid="assistant-message"]';
export const CLAUDE_ATTACHMENT_TILE_SELECTOR = '[data-testid="file-thumbnail"]';

/**
 * Fills the composer, clicks send once, and waits for the page to confirm the message was taken.
 * Needs `sleep` and `waitFor` in scope. Confirmation is a NEW user-message node (not a count: the
 * transcript is virtualized) or an emptied composer with the send button gone; an unclear click is
 * never repeated (a second click is a second question). A rejected send next to a limit signal ends
 * with `CLAUDE_USAGE_LIMIT`.
 *
 * Returns the conversation id the message went into, so the read can tell its own reply apart.
 */
export const CLAUDE_SUBMIT_JS = `async function claudeSubmit(promptText, opts) {
  opts = opts || {};
  var FILL_MS = opts.fillMs === undefined ? 30000 : opts.fillMs;
  var ACCEPT_MS = opts.acceptMs === undefined ? 5000 : opts.acceptMs;
  var CONFIRM_MS = opts.confirmMs === undefined ? 10000 : opts.confirmMs;
  var SETTLE_MS = opts.settleMs === undefined ? 300 : opts.settleMs;
  var CONVERSATION_MS = opts.conversationMs === undefined ? 5000 : opts.conversationMs;

  function composer() { return document.querySelector(${JSON.stringify(CLAUDE_INPUT_SELECTOR)}); }
  function composerText() {
    var el = composer();
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }
  function readySendButton() {
    var b = document.querySelector(${JSON.stringify(CLAUDE_SEND_SELECTOR)});
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return null;
    return b;
  }
  function latest(selector) {
    var all = document.querySelectorAll(selector);
    return all[all.length - 1] || null;
  }
  function conversationId() {
    var path = location.pathname.split('/');
    return path[1] === 'chat' ? (path[2] || '') : '';
  }
  ${CLAUDE_USAGE_LIMIT_JS}

  async function stableComposer() {
    var deadline = Date.now() + FILL_MS;
    while (Date.now() < deadline) {
      var first = composer();
      await sleep(SETTLE_MS);
      if (first && composer() === first) return first;
    }
    return null;
  }

  async function fill() {
    var deadline = Date.now() + FILL_MS;
    while (Date.now() < deadline) {
      var el = await stableComposer();
      if (!el) return false;
      el.focus();
      try { document.execCommand('selectAll', false, null); } catch (e) {}
      try { document.execCommand('insertText', false, promptText); } catch (e) {}
      try {
        await waitFor(function() { return !!composerText() && !!readySendButton(); }, 'Claude registered the prompt', ACCEPT_MS, 100);
        return true;
      } catch (e) {}
      if (claudeLimitShown()) throw claudeLimitError();
      await sleep(SETTLE_MS);
    }
    return false;
  }

  if (!await fill()) {
    throw new Error('Claude composer never registered the prompt (page not interactive)');
  }

  var previousUser = latest(${JSON.stringify(CLAUDE_USER_TURN_SELECTOR)});
  var previousAssistant = latest(${JSON.stringify(CLAUDE_ASSISTANT_TURN_SELECTOR)});
  var previousAssistantText = previousAssistant ? (previousAssistant.textContent || '') : '';

  function accepted() {
    var user = latest(${JSON.stringify(CLAUDE_USER_TURN_SELECTOR)});
    if (user && user !== previousUser) return true;
    return !composerText() && !document.querySelector(${JSON.stringify(CLAUDE_SEND_SELECTOR)});
  }

  // A rejected send still draws the turn for a moment, together with the upgrade dialog; only a
  // dialog this click opened says so, since one left open from an earlier send proves nothing.
  var dialogBefore = claudeUsageLimit().dialog;
  function rejected() { return !dialogBefore && claudeUsageLimit().dialog; }

  var button = readySendButton();
  if (!button) throw new Error('Claude send button is not available');
  button.click();
  try {
    await waitFor(function() { return accepted() || rejected(); }, 'Claude accepted the message', CONFIRM_MS, 100);
  } catch (e) {
    if (claudeLimitShown()) throw claudeLimitError();
    throw new Error('Claude never accepted the message (no new user message appeared after one click)');
  }
  if (rejected()) throw claudeLimitError();

  // Without the id the read simply cannot tell a switched page apart.
  var conversation = conversationId();
  if (!conversation) {
    try { conversation = await waitFor(conversationId, 'Claude opened the conversation', CONVERSATION_MS, 100); } catch (e) { conversation = ''; }
  }

  return { lastAssistant: previousAssistant, lastAssistantText: previousAssistantText, conversation: conversation };
}`;

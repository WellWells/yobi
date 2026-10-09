import { CLAUDE_ASSISTANT_TURN_SELECTOR } from './claudeSendScript';
import { CLAUDE_USAGE_LIMIT_JS } from './claudeUsageLimit';
import { CLAUDE_CONVERSATION_LEAF_JS } from './claudeArtifacts';

/** The reply could not be produced (Claude overloaded): the server ended it with an error. */
export const CLAUDE_BUSY = 'CLAUDE_BUSY';
/** The page moved to another conversation before the reply was read. */
export const CLAUDE_LEFT_CONVERSATION = 'CLAUDE_LEFT_CONVERSATION';

export const CLAUDE_TRANSCRIPT_ROW_SELECTOR = '[data-testid="transcript-row"]';
/** Legacy copy-control test id, still accepted. */
export const CLAUDE_COPY_SELECTOR = '[data-testid="action-bar-copy"]';
export const CLAUDE_MESSAGE_ACTIONS_SELECTOR = '[data-testid="message-actions"]';
/** The copy control: the one action-bar button with neither a test id nor a pressed state. */
export const CLAUDE_UNLABELED_ACTION_SELECTOR = 'button:not([data-testid]):not([aria-pressed])';
/** The rendered Markdown of one reply block. Tool cards (artifacts, searches) sit outside it. */
export const CLAUDE_REPLY_TEXT_SELECTOR = '[data-perf-reply-text]';
/** What Claude's own find-in-page skips: the screen-reader heading and the status cards. */
export const CLAUDE_OMITTED_SELECTOR = '[data-find-omitted], .sr-only';

/**
 * Waits for Claude's answer and reads it back. Runs in the page, so it needs `sleep`, `waitFor`
 * and `interceptCopy` in scope. The transcript is virtualized, so a new answer is a different
 * node, never a higher count. The page alone is not trusted: the read stays on the conversation
 * its send opened, and a server-side error that outlasts `errorGraceMs` is `CLAUDE_BUSY`.
 */
export const CLAUDE_READ_JS = `async function claudeWaitAndRead(submitted, opts) {
  opts = opts || {};
  submitted = submitted || {};
  var seen = submitted.lastAssistant || null;
  var seenText = submitted.lastAssistantText || '';
  var TIMEOUT = opts.timeoutMs === undefined ? 300000 : opts.timeoutMs;
  var STUCK_MS = opts.stuckMs === undefined ? 120000 : opts.stuckMs;
  var QUIET_MS = opts.quietMs === undefined ? 3000 : opts.quietMs;
  var POLL_MS = opts.pollMs === undefined ? 250 : opts.pollMs;
  var WAIT_MS = opts.waitMs === undefined ? 300 : opts.waitMs;
  var SERVER_CHECK_MS = opts.serverCheckMs === undefined ? 5000 : opts.serverCheckMs;
  var ERROR_GRACE_MS = opts.errorGraceMs === undefined ? 60000 : opts.errorGraceMs;
  var conversation = submitted.conversation || '';

  function latestAssistant() {
    var all = document.querySelectorAll(${JSON.stringify(CLAUDE_ASSISTANT_TURN_SELECTOR)});
    return all[all.length - 1] || null;
  }
  function streaming(node) { return node ? node.getAttribute('data-is-streaming') : null; }
  function replyBlocks(node) {
    var all = node ? node.querySelectorAll(${JSON.stringify(CLAUDE_REPLY_TEXT_SELECTOR)}) : [];
    var blocks = [];
    for (var i = 0; i < all.length; i++) {
      var omitted = all[i].closest(${JSON.stringify(CLAUDE_OMITTED_SELECTOR)});
      if (!omitted || !node.contains(omitted)) blocks.push(all[i]);
    }
    return blocks;
  }
  function answerText(node) {
    var blocks = replyBlocks(node);
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var text = (blocks[i].innerText || '').trim();
      if (text) parts.push(text);
    }
    return parts.join('\\n\\n');
  }
  function following(node, el) {
    return !!(node.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function copyButtonFor(node) {
    if (!node || !node.closest) return null;
    // The action bar may sit inside the answer node or beside it in the row.
    var row = node.closest(${JSON.stringify(CLAUDE_TRANSCRIPT_ROW_SELECTOR)}) || node;
    var buttons = row.querySelectorAll(${JSON.stringify(CLAUDE_COPY_SELECTOR)});
    for (var i = buttons.length - 1; i >= 0; i--) {
      if (following(node, buttons[i])) return buttons[i];
    }
    var bars = row.querySelectorAll(${JSON.stringify(CLAUDE_MESSAGE_ACTIONS_SELECTOR)});
    for (var j = bars.length - 1; j >= 0; j--) {
      if (!following(node, bars[j])) continue;
      var left = bars[j].querySelectorAll(${JSON.stringify(CLAUDE_UNLABELED_ACTION_SELECTOR)});
      return left.length === 1 ? left[0] : null;
    }
    return null;
  }
  function hasNewResponse() {
    var node = latestAssistant();
    if (!node || node === seen) return false;
    if (!seen) return true;
    return streaming(node) !== 'false' || (node.textContent || '') !== seenText;
  }
  ${CLAUDE_USAGE_LIMIT_JS}
  ${CLAUDE_CONVERSATION_LEAF_JS}

  function currentConversation() {
    var path = location.pathname.split('/');
    return path[1] === 'chat' ? (path[2] || '') : '';
  }
  // A new chat still on /new has no id yet; only a different id is a different conversation.
  function leftConversation() {
    var now = currentConversation();
    return !!conversation && !!now && now !== conversation;
  }
  function leftError() {
    return new Error(${JSON.stringify(`${CLAUDE_LEFT_CONVERSATION}: the Claude page moved to another conversation before the answer was read`)});
  }
  function busyError() {
    return new Error(${JSON.stringify(`${CLAUDE_BUSY}: Claude ended the answer with an error (over capacity)`)});
  }
  // The reply's server record, or null when it cannot be read; then the page alone decides.
  async function replyRecord() {
    var read = await claudeConversationLeaf(conversation);
    if (!read.ok || !read.leaf || read.leaf.sender !== 'assistant') return null;
    return { uuid: read.leaf.uuid, failed: read.leaf.stop_reason === 'error' };
  }

  await waitFor(function() { return leftConversation() || hasNewResponse(); }, 'new Claude response', TIMEOUT, WAIT_MS);
  if (leftConversation()) throw leftError();

  var started = Date.now();
  var lastText = null;
  var lastChangeAt = Date.now();
  var fresh = latestAssistant();
  var node = fresh;
  var copyBtn = null;
  var lastCheckAt = 0;
  var failedReply = '';
  var failedSince = 0;
  while (true) {
    if (leftConversation()) throw leftError();
    // Follow the newest answer node, but never back onto the previous answer: once a turn the page
    // took back is gone, the latest node is that answer again, finished and copyable. A re-render
    // may swap in an equivalent node for the new answer, which then becomes the one.
    var latest = latestAssistant();
    if (latest && latest !== fresh && hasNewResponse()) fresh = latest;
    if (!fresh.isConnected) {
      if (claudeLimitShown()) throw claudeLimitError();
      if (latest && latest !== seen) fresh = latest;
    }
    node = fresh.isConnected ? fresh : null;
    var state = streaming(node);
    var text = answerText(node);
    if (text !== lastText) {
      lastText = text;
      lastChangeAt = Date.now();
    }
    copyBtn = copyButtonFor(node);
    // While nothing has arrived, ask the server now and then whether the reply already failed.
    // Claude retries on its own; a retry is a new reply, which starts the grace over.
    if (!text && Date.now() - lastCheckAt >= SERVER_CHECK_MS) {
      lastCheckAt = Date.now();
      var record = await replyRecord();
      if (record && record.failed) {
        if (failedReply !== record.uuid) { failedReply = record.uuid; failedSince = Date.now(); }
        else if (Date.now() - failedSince >= ERROR_GRACE_MS) throw busyError();
      } else {
        failedReply = '';
      }
    }
    if (state === 'false' && copyBtn) break;
    var quietFor = Date.now() - lastChangeAt;
    if (state === 'false' && text && quietFor >= QUIET_MS) break;
    if (text && quietFor >= STUCK_MS) break;
    if (Date.now() - started > TIMEOUT) {
      if (text) break;
      throw new Error('Claude automation timed out: no answer text appeared');
    }
    await sleep(POLL_MS);
  }

  // Tool cards (an artifact, a search) render beside the reply blocks, never inside them; any text
  // outside the blocks means the copy may be missing part of the answer. A false alarm only costs
  // one read of the conversation API, which finds no artifact and keeps the copy.
  function hasToolOutput(target) {
    if (!target) return false;
    var rest = target.cloneNode(true);
    // The answer's own blocks, the screen-reader copy and the action bar are not tool output.
    var drop = replyBlocks(rest);
    var chrome = rest.querySelectorAll(${JSON.stringify(`:scope > .sr-only, ${CLAUDE_MESSAGE_ACTIONS_SELECTOR}`)});
    for (var i = 0; i < chrome.length; i++) drop.push(chrome[i]);
    for (var j = 0; j < drop.length; j++) {
      if (drop[j].parentNode) drop[j].parentNode.removeChild(drop[j]);
    }
    return (rest.textContent || '').replace(/\\s+/g, '').length > 0;
  }

  // What the page shows as finished may not be this reply at all; the server says whether it is.
  var final = await replyRecord();
  if (final && final.failed) throw busyError();

  var answer = answerText(node);
  var copied = copyBtn ? ((await interceptCopy(copyBtn)) || '').trim() : '';
  var response = copied || answer;
  if (!response) throw new Error('Claude response is empty');
  return { response: response, title: (document.title || '').trim(), hasToolOutput: hasToolOutput(node) };
}`;

const CLAUDE_TITLE_SUFFIX_RE = /\s*[-–—]\s*Claude\s*$/i;

/**
 * Trims the site name off the tab title. `placeholder` is the title the page showed before the
 * send when it started a new chat — "New chat" in whatever language the account uses — which the
 * page keeps until it has generated a real title, and which must not become the chat's name.
 */
export function cleanClaudeTitle(rawTitle: string, placeholder = ''): string {
  const clean = (value: string): string => (value || '').trim().replace(CLAUDE_TITLE_SUFFIX_RE, '').trim();
  const title = clean(rawTitle);
  if (!title || title.toLowerCase() === 'claude') return '';
  if (placeholder && title === clean(placeholder)) return '';
  return title;
}

import { CLAUDE_ASSISTANT_TURN_SELECTOR } from './claudeSendScript';
import { CLAUDE_USAGE_LIMIT_JS } from './claudeUsageLimit';

export const CLAUDE_TRANSCRIPT_ROW_SELECTOR = '[data-testid="transcript-row"]';
export const CLAUDE_COPY_SELECTOR = '[data-testid="action-bar-copy"]';
/** The rendered Markdown of one reply block. Tool cards (artifacts, searches) sit outside it. */
export const CLAUDE_REPLY_TEXT_SELECTOR = '.font-claude-response [data-perf-reply-text]';

/**
 * Waits for Claude's answer and reads it back. Runs in the page, so it needs `sleep`, `waitFor`
 * and `interceptCopy` in scope. Measured 2026-09-18:
 *
 * - The new assistant node mounts ~170 ms after the send WITHOUT `data-is-streaming`; the attribute
 *   reads "true" while tokens arrive and "false" once the turn is over. Absent means busy.
 * - The copy control (`action-bar-copy`) appears in the turn's transcript row at completion and
 *   writes the reply as Markdown through `clipboard.write`.
 * - The node's own innerText is useless as a fallback: a screen-reader-only copy precedes the
 *   visible text, so the answer comes back twice behind a localized "Claude responded:".
 * - The transcript is virtualized; "a new answer" is a node other than the one the submit saw
 *   last, never a count. A re-render can hand back an equivalent node for that old answer, so a
 *   different node only counts once it is busy or reads differently.
 * - A send rejected for the usage limit draws its turn and then takes it back; a real answer never
 *   disappears, so a vanished answer next to a limit signal is the limit.
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

  function latestAssistant() {
    var all = document.querySelectorAll(${JSON.stringify(CLAUDE_ASSISTANT_TURN_SELECTOR)});
    return all[all.length - 1] || null;
  }
  function streaming(node) { return node ? node.getAttribute('data-is-streaming') : null; }
  function answerText(node) {
    if (!node) return '';
    var blocks = node.querySelectorAll(${JSON.stringify(CLAUDE_REPLY_TEXT_SELECTOR)});
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var text = (blocks[i].innerText || '').trim();
      if (text) parts.push(text);
    }
    return parts.join('\\n\\n');
  }
  function copyButtonFor(node) {
    var row = node && node.closest ? node.closest(${JSON.stringify(CLAUDE_TRANSCRIPT_ROW_SELECTOR)}) : null;
    if (!row) return null;
    var buttons = row.querySelectorAll(${JSON.stringify(CLAUDE_COPY_SELECTOR)});
    for (var i = buttons.length - 1; i >= 0; i--) {
      if (node.compareDocumentPosition(buttons[i]) & Node.DOCUMENT_POSITION_FOLLOWING) return buttons[i];
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

  await waitFor(hasNewResponse, 'new Claude response', TIMEOUT, WAIT_MS);

  var started = Date.now();
  var lastText = null;
  var lastChangeAt = Date.now();
  var fresh = latestAssistant();
  var node = fresh;
  var copyBtn = null;
  while (true) {
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
  // outside the blocks means the copy may be missing part of the answer.
  function hasToolOutput(target) {
    var containers = target ? target.querySelectorAll('.font-claude-response') : [];
    var total = 0;
    for (var i = 0; i < containers.length; i++) total += (containers[i].innerText || '').replace(/\\s+/g, '').length;
    return total > answerText(target).replace(/\\s+/g, '').length;
  }

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

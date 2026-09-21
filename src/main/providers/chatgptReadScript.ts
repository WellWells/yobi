import { CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_STOP_SELECTOR } from './chatgptSendScript';

/**
 * Waits for ChatGPT's answer and reads it back. Runs in the page via `executeJavaScript`, so
 * it needs `sleep`, `waitFor` and `interceptCopy` already in scope.
 *
 * Completion has two signals and they are not equally trustworthy. The per-turn copy control
 * is definitive — ChatGPT renders it only once the turn is finished. "The text stopped
 * changing" is not: this loop used to accept three unchanged polls (about 750 ms) on its own,
 * so any pause in token delivery — a search or tool step, a think between paragraphs, plain
 * network jitter — ended the read early and returned a partial answer as if it were complete,
 * with no error and no copied Markdown. It now has to see that ChatGPT is not still
 * generating, the way the Gemini reader does.
 *
 * If the stop button ever stops matching, `isGenerating()` simply reads false and the loop
 * behaves as it did before — the gate can only ever make it wait longer, never hang, because
 * a stall still breaks out after `stuckMs`.
 *
 * "A new answer arrived" is NOT a turn count. ChatGPT keeps only a window of turns mounted, so
 * once a conversation runs long enough it unmounts an old turn as it mounts the new one and the
 * count never grows. Measured on a live run: the answer streamed in and finished, copy control
 * and all, while \`document.querySelectorAll('[data-message-author-role="assistant"]').length\`
 * sat at 3 — and the read died on "Timeout waiting for: new ChatGPT response" two minutes later
 * with the finished answer on screen. Keeping the page across turns (page reuse) is what made
 * conversations long enough to reach that window. So the gate takes the LAST turn the submit
 * saw and waits for the newest turn to stop being it; the count is kept only as a second way to
 * say yes, never as the only one.
 */
export const CHATGPT_READ_JS = `async function chatgptWaitAndRead(submitted, opts) {
  opts = opts || {};
  submitted = submitted || {};
  var baseline = typeof submitted.assistantBaseline === 'number' ? submitted.assistantBaseline : 0;
  var seenTurn = submitted.lastAssistantTurn || null;
  var seenId = submitted.lastAssistantId || null;
  var TIMEOUT = opts.timeoutMs === undefined ? 300000 : opts.timeoutMs;
  var STUCK_MS = opts.stuckMs === undefined ? 60000 : opts.stuckMs;
  var POLL_MS = opts.pollMs === undefined ? 250 : opts.pollMs;
  var STABLE_POLLS = opts.stablePolls === undefined ? 3 : opts.stablePolls;
  var WAIT_MS = opts.waitMs === undefined ? 350 : opts.waitMs;
  var EMPTY_SETTLE_MS = opts.emptySettleMs === undefined ? 2500 : opts.emptySettleMs;

  function getAssistantTurns() {
    return document.querySelectorAll(${JSON.stringify(CHATGPT_ASSISTANT_TURN_SELECTOR)});
  }

  function getLatestAssistantTurn() {
    var turns = getAssistantTurns();
    return turns[turns.length - 1] || null;
  }

  function getTurnText(turn) {
    if (!turn) return '';
    var markdown = turn.querySelector('.markdown.prose, .markdown, [class*="markdown"]');
    if (markdown && (markdown.innerText || '').trim()) {
      return (markdown.innerText || '').trim();
    }
    return (turn.innerText || '').trim();
  }

  function findCopyButtonForTurn(turn) {
    if (!turn) return null;

    var turnContainer = turn.closest('.agent-turn') || turn.closest('.group\\\\/turn-messages') || turn.parentElement.parentElement;
    var searchContext = turnContainer || document;

    var selectors = [
      'button[data-testid="copy-turn-action-button"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btns = searchContext.querySelectorAll(selectors[i]);
      if (btns && btns.length > 0) return btns[btns.length - 1];
    }
    return null;
  }

  function isGenerating() {
    return !!document.querySelector(${JSON.stringify(CHATGPT_STOP_SELECTOR)});
  }

  function turnId(turn) {
    return turn ? (turn.getAttribute('data-message-id') || null) : null;
  }

  /*
   * Node identity is the signal; the message id is used when the page carries one, because a
   * re-render can hand back an equivalent node for the same message. A drop with no new answer
   * leaves the newest turn exactly as it was, so this stays false and the read keeps waiting.
   */
  function hasNewResponse() {
    var turns = getAssistantTurns();
    if (turns.length > baseline) return true;
    var latest = turns[turns.length - 1] || null;
    if (!latest) return false;
    var latestId = turnId(latest);
    if (seenId && latestId) return latestId !== seenId;
    return latest !== seenTurn;
  }

  /*
   * The copy control that belongs to THIS turn, never one borrowed from the page. The
   * recovery below hands back whatever this button copies, so a button found outside the
   * turn would quietly return the previous answer — worse than the timeout it replaces.
   * Scope therefore narrows to the turn's own container and, failing that, the turn itself;
   * finding nothing means no recovery, which is exactly the old behaviour.
   */
  function ownCopyButton(turn) {
    if (!turn) return null;
    var container = turn.closest('.agent-turn') || turn.closest('.group\\\\/turn-messages') || turn;
    var btns = container.querySelectorAll('button[data-testid="copy-turn-action-button"]');
    return btns.length ? btns[btns.length - 1] : null;
  }

  /*
   * A finished turn whose text never arrives. Measured 2026-09-18 on Free/Instant: the answer
   * "7" left \`<p data-start="0" data-end="7"></p>\` EMPTY in the live DOM with the stop
   * control already gone, and it stayed empty — reloading the conversation showed the text, so
   * the stream ("Wells，7", 7 chars) was rewritten server-side and the rewrite rendered
   * nothing. Reproduced with CDP typing and no Yobi script in play, so it is ChatGPT's
   * renderer. Waiting for text that will never appear burned the entire timeout and failed
   * with the answer sitting on screen.
   *
   * Two conditions gate the escape and both matter: the turn must be FINISHED (its own copy
   * control is up and nothing is generating) and it must have been empty for
   * EMPTY_SETTLE_MS. A turn that is merely slow to paint its first token has no copy control
   * yet, so it still waits the ordinary way — dropping either half would end reads early.
   */
  var emptySince = null;
  function finishedEmpty() {
    var turn = getLatestAssistantTurn();
    if (!turn || getTurnText(turn)) { emptySince = null; return false; }
    if (isGenerating() || !ownCopyButton(turn)) { emptySince = null; return false; }
    if (emptySince === null) emptySince = Date.now();
    return Date.now() - emptySince >= EMPTY_SETTLE_MS;
  }

  await waitFor(hasNewResponse, 'new ChatGPT response', TIMEOUT, WAIT_MS);

  await waitFor(function() {
    return !!getTurnText(getLatestAssistantTurn()) || finishedEmpty();
  }, 'ChatGPT response text', TIMEOUT, WAIT_MS);

  var stableText = '';
  var stableCount = 0;
  var lastChangeAt = null;
  var copyBtn = null;
  while (true) {
    var turn = getLatestAssistantTurn();
    var text = getTurnText(turn);
    copyBtn = findCopyButtonForTurn(turn);
    if (copyBtn && text) break;
    // Same escape as the wait above: without it this loop spins out the timeout instead.
    if (!text && finishedEmpty()) { copyBtn = ownCopyButton(turn); break; }
    if (text !== stableText) {
      stableText = text;
      stableCount = 0;
      if (text) lastChangeAt = Date.now();
    } else if (text) {
      stableCount += 1;
    }
    var stalled = lastChangeAt !== null && Date.now() - lastChangeAt > STUCK_MS;
    if (stableText && stableCount >= STABLE_POLLS && (!isGenerating() || stalled)) break;
    if (lastChangeAt !== null && Date.now() - lastChangeAt > TIMEOUT) {
      if (stableText) break;
      throw new Error('ChatGPT automation timed out: response stopped updating');
    }
    await sleep(POLL_MS);
  }

  var latestTurn = getLatestAssistantTurn();
  if (!latestTurn) throw new Error('ChatGPT response block not found');

  if (!copyBtn) copyBtn = findCopyButtonForTurn(latestTurn);

  var answerText = getTurnText(latestTurn);
  var copiedText = copyBtn ? ((await interceptCopy(copyBtn)) || '').trim() : '';

  var finalAnswer = copiedText || answerText;
  if (!finalAnswer) throw new Error('ChatGPT response is empty');

  return { response: finalAnswer, title: (document.title || '').trim() };
}`;

const CHATGPT_TITLE_SUFFIX_RE = /\s*[-–—]\s*ChatGPT\s*$/i;
const CHATGPT_SITE_TITLES = new Set(['chatgpt', 'chatgpt.com', 'new chat']);

/**
 * Trims the site name off a ChatGPT conversation title.
 *
 * Kept on this side of the boundary on purpose: a regex literal written inside a backtick
 * template loses its own escapes before the page runs it, which is exactly how Duck.ai's
 * equivalent ended up matching nothing at all for months.
 */
export function cleanChatgptTitle(rawTitle: string): string {
  const trimmed = (rawTitle || '').trim();
  if (CHATGPT_SITE_TITLES.has(trimmed.toLowerCase())) return '';
  return trimmed.replace(CHATGPT_TITLE_SUFFIX_RE, '').trim();
}

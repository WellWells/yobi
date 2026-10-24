import {
  CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_IMAGE_GALLERY_SELECTOR, CHATGPT_MESSAGE_ID_JS, CHATGPT_STOP_SELECTOR,
} from './chatgptSendScript';
import { INJECTED_READ_IMAGES_JS, readImagesCall } from './generatedImages';

/** A drawn picture can still be loading after the turn says it is done. */
const IMAGE_LOAD_MS = 60_000;

/**
 * Waits for ChatGPT's answer and reads it back. Runs in the page via `executeJavaScript`, so
 * it needs `sleep`, `waitFor` and `interceptCopy` already in scope.
 *
 * Done means the turn's own copy control is up, or the text is stable while nothing is
 * generating. A new answer is detected by the last turn's identity, not by the turn count alone.
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
  var IMAGE_LOAD_MS = opts.imageLoadMs === undefined ? ${IMAGE_LOAD_MS} : opts.imageLoadMs;
  var GALLERY_SEL = ${JSON.stringify(CHATGPT_IMAGE_GALLERY_SELECTOR)};
  ${CHATGPT_MESSAGE_ID_JS}
  ${INJECTED_READ_IMAGES_JS}

  function isPictureTurn(turn) {
    return !!turn && turn.matches(GALLERY_SEL);
  }
  function exchangeOf(turn) {
    return (turn && (turn.closest('[data-turn-key]') || turn.closest('article'))) || turn;
  }
  // The text message of a picture's exchange, or null when the pictures came without words.
  function textTurnOf(turn) {
    if (!isPictureTurn(turn)) return turn;
    var exchange = exchangeOf(turn);
    var texts = exchange ? exchange.querySelectorAll('[data-chatgpt-search-unit-key$=":assistant"], [data-message-author-role="assistant"]') : [];
    return texts.length ? texts[texts.length - 1] : null;
  }
  function turnPictures(turn) {
    var exchange = exchangeOf(turn);
    return exchange ? exchange.querySelectorAll(GALLERY_SEL + ' img') : [];
  }
  // Drawn and final: ChatGPT shows blurred previews while it is still drawing.
  function picturesDone(turn) {
    var imgs = turnPictures(turn);
    if (!imgs.length || isGenerating()) return false;
    var exchange = exchangeOf(turn);
    if (exchange && exchange.querySelector('[data-talvt-turn-state="in_progress"]')) return false;
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete || !imgs[i].naturalWidth) return false;
    }
    return true;
  }

  function getAssistantTurns() {
    return document.querySelectorAll(${JSON.stringify(CHATGPT_ASSISTANT_TURN_SELECTOR)});
  }

  function getLatestAssistantTurn() {
    var turns = getAssistantTurns();
    return turns[turns.length - 1] || null;
  }

  // A turn can also hold a localized "ChatGPT said:" heading, so the body is read from the
  // message's own copy region, never from the whole turn.
  function getTurnText(turn) {
    turn = textTurnOf(turn);
    if (!turn) return '';
    var bodies = turn.querySelectorAll('[data-markdown-copy="contents"]');
    var markdown = bodies.length
      ? bodies[bodies.length - 1]
      : turn.querySelector('.markdown.prose, .markdown, [class*="markdown"]');
    if (markdown && (markdown.innerText || '').trim()) {
      return (markdown.innerText || '').trim();
    }
    if (turn.hasAttribute('data-chatgpt-search-unit-key')) return '';
    return (turn.innerText || '').trim();
  }

  // Where the copy control has no marker, it is the first button after the answer inside the same
  // exchange ([data-turn-key]), and only if that button carries no ARIA menu/pressed state. Not
  // offered while the exchange is still answering: a copy taken then is a partial answer.
  function redesignedCopyButton(turn) {
    var exchange = turn.closest('[data-turn-key]');
    if (!exchange || exchange.querySelector('[data-talvt-turn-state="in_progress"]')) return null;
    var btns = exchange.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (turn.contains(b)) continue;
      if (!(turn.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      // A drawn picture's own buttons open or edit it; none of them copies the answer.
      if (b.closest(GALLERY_SEL)) continue;
      if (b.hasAttribute('aria-haspopup') || b.hasAttribute('aria-pressed')) return null;
      return b;
    }
    return null;
  }

  function findCopyButtonForTurn(turn) {
    turn = textTurnOf(turn);
    if (!turn) return null;
    if (turn.hasAttribute('data-chatgpt-search-unit-key')) return redesignedCopyButton(turn);

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
    return chatgptMessageId(turn);
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

  // The copy control inside THIS turn only: one found elsewhere would copy the previous answer.
  function ownCopyButton(turn) {
    turn = textTurnOf(turn);
    if (!turn) return null;
    if (turn.hasAttribute('data-chatgpt-search-unit-key')) return redesignedCopyButton(turn);
    var container = turn.closest('.agent-turn') || turn.closest('.group\\\\/turn-messages') || turn;
    var btns = container.querySelectorAll('button[data-testid="copy-turn-action-button"]');
    return btns.length ? btns[btns.length - 1] : null;
  }

  // A finished turn (own copy control up, nothing generating) that stays empty for
  // EMPTY_SETTLE_MS is read through its copy control instead of waiting out the timeout.
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
    var latest = getLatestAssistantTurn();
    return !!getTurnText(latest) || finishedEmpty() || picturesDone(latest);
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
    // Pictures with no words: nothing to copy.
    if (!text && picturesDone(turn)) break;
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
  var copiedText = copyBtn && textTurnOf(latestTurn) ? ((await interceptCopy(copyBtn)) || '').trim() : '';

  // Words may finish before the pictures do; read those once they are final.
  var images = [];
  if (turnPictures(latestTurn).length) {
    var loadDeadline = Date.now() + IMAGE_LOAD_MS;
    while (!picturesDone(latestTurn) && Date.now() < loadDeadline) await sleep(POLL_MS);
    images = await ${readImagesCall('turnPictures(latestTurn)')};
  }

  var finalAnswer = copiedText || answerText;
  if (!finalAnswer && images.length === 0) throw new Error('ChatGPT response is empty');

  return { response: finalAnswer, title: (document.title || '').trim(), images: images };
}`;

const CHATGPT_TITLE_SUFFIX_RE = /\s*[-–—]\s*ChatGPT\s*$/i;
const CHATGPT_SITE_TITLES = new Set(['chatgpt', 'chatgpt.com', 'new chat']);

/**
 * Trims the site name off a ChatGPT conversation title. Kept outside the injected script: a
 * regex literal inside a template string loses its escapes.
 */
export function cleanChatgptTitle(rawTitle: string): string {
  const trimmed = (rawTitle || '').trim();
  if (CHATGPT_SITE_TITLES.has(trimmed.toLowerCase())) return '';
  return trimmed.replace(CHATGPT_TITLE_SUFFIX_RE, '').trim();
}

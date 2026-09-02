/**
 * Anchor for one answer turn. Perplexity dropped the `markdown-content-N` ids, so the
 * current renderer is matched by the answer's own prose block, which appears with the
 * first streamed token exactly like the old anchor did. The old id stays in the union
 * because already-open threads and A/B variants can still serve it.
 */
export const PPLX_RESPONSE_SELECTOR = '[id^="markdown-content-"], .prose[data-renderer="lm"]';

/** Wrapper Perplexity adds around an answer only once it has finished streaming. */
export const PPLX_FINAL_TEXT_SELECTOR = '[data-workflow-final-text]';

const ANCHOR = JSON.stringify(PPLX_RESPONSE_SELECTOR);
const FINAL_TEXT = JSON.stringify(PPLX_FINAL_TEXT_SELECTOR);

export const INJECTED_PPLX_READ_JS = `
  var PPLX_REGENERATE_ICONS = ['pplx-icon-repeat', 'pplx-icon-arrow-fork'];

  function getResponseNodes() {
    return document.querySelectorAll(${ANCHOR});
  }

  function getLatestResponseAnchor() {
    var nodes = getResponseNodes();
    return nodes.length ? nodes[nodes.length - 1] : null;
  }

  function pickNearestProse(proses, anchor) {
    var preceding = null;
    var following = null;
    for (var i = 0; i < proses.length; i++) {
      var prose = proses[i];
      if (prose.contains(anchor) || anchor.contains(prose)) return prose;
      var position = anchor.compareDocumentPosition(prose);
      if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) preceding = prose;
      else if (following === null) following = prose;
    }
    return preceding || following || proses[0];
  }

  function getAnswerNode(anchor) {
    if (!anchor) return null;
    if ((anchor.innerText || '').trim() || hasGeneratedImageAsset(anchor)) return anchor;
    var el = anchor.parentElement;
    var imageHost = null;
    for (var i = 0; i < 12 && el && el !== document.body; i++) {
      if (el.querySelectorAll(${ANCHOR}).length > 1) break;
      var proses = el.querySelectorAll('.prose');
      if (proses.length) return pickNearestProse(proses, anchor);
      if (imageHost === null && hasGeneratedImageAsset(el)) imageHost = el;
      el = el.parentElement;
    }
    return imageHost || anchor;
  }

  function getLatestAnswerNode() {
    return getAnswerNode(getLatestResponseAnchor());
  }

  function getUseHref(useEl) {
    if (!useEl) return '';
    return useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
  }

  function buttonHasIcon(button, iconName) {
    if (!button || !iconName) return false;
    var uses = button.querySelectorAll('use');
    for (var i = 0; i < uses.length; i++) {
      var href = getUseHref(uses[i]);
      if (href && href.indexOf(iconName) !== -1) return true;
    }
    return false;
  }

  function buttonHasAnyIcon(button, iconNames) {
    for (var i = 0; i < iconNames.length; i++) {
      if (buttonHasIcon(button, iconNames[i])) return true;
    }
    return false;
  }

  function collectCopyIconButtons(root) {
    if (!root) return [];
    var allButtons = root.querySelectorAll('button');
    var matches = [];
    for (var i = 0; i < allButtons.length; i++) {
      if (buttonHasIcon(allButtons[i], 'pplx-icon-copy')) matches.push(allButtons[i]);
    }
    return matches;
  }

  function isNodeAfterResponse(node, responseEl) {
    if (!node || !responseEl) return false;
    if (responseEl.contains(node)) return false;
    return (responseEl.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  function findCopyButtonFor(responseEl) {
    var el = responseEl;
    for (var i = 0; i < 12 && el && el !== document.body; i++) {
      var copyButtons = collectCopyIconButtons(el);
      for (var b = 0; b < copyButtons.length; b++) {
        var candidate = copyButtons[b];
        if (responseEl.contains(candidate)) continue;
        var container = candidate.parentElement;
        for (var depth = 0; depth < 6 && container && container !== document.body; depth++) {
          var hasCopy = false;
          var hasShare = false;
          var hasDownload = false;
          var hasRewrite = false;
          var toolbarButtons = container.querySelectorAll('button');
          for (var k = 0; k < toolbarButtons.length; k++) {
            if (buttonHasIcon(toolbarButtons[k], 'pplx-icon-copy')) hasCopy = true;
            if (buttonHasIcon(toolbarButtons[k], 'pplx-icon-share')) hasShare = true;
            if (buttonHasIcon(toolbarButtons[k], 'pplx-icon-download')) hasDownload = true;
            if (buttonHasAnyIcon(toolbarButtons[k], PPLX_REGENERATE_ICONS)) hasRewrite = true;
          }
          if (hasCopy && (hasShare || hasDownload || hasRewrite) && isNodeAfterResponse(container, responseEl)) {
            return candidate;
          }
          container = container.parentElement;
        }
      }
      for (var c = 0; c < copyButtons.length; c++) {
        if (!responseEl.contains(copyButtons[c]) && isNodeAfterResponse(copyButtons[c], responseEl)) {
          return copyButtons[c];
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function findImageActionToolbarFor(responseEl) {
    if (!responseEl) return null;
    var el = responseEl.parentElement;
    for (var i = 0; i < 12 && el && el !== document.body; i++) {
      if (el.querySelectorAll(${ANCHOR}).length > 1) break;
      var buttons = el.querySelectorAll('button');
      var hasDownload = false;
      var hasRegenerate = false;
      for (var k = 0; k < buttons.length; k++) {
        if (!isNodeAfterResponse(buttons[k], responseEl)) continue;
        if (buttonHasIcon(buttons[k], 'pplx-icon-download')) hasDownload = true;
        if (buttonHasAnyIcon(buttons[k], PPLX_REGENERATE_ICONS)) hasRegenerate = true;
      }
      if (hasDownload && hasRegenerate) return el;
      el = el.parentElement;
    }
    return null;
  }

  function hasGeneratedImageAsset(responseEl) {
    if (!responseEl) return false;
    var images = responseEl.querySelectorAll('img[src]');
    for (var i = 0; i < images.length; i++) {
      var src = (images[i].getAttribute('src') || '').toLowerCase();
      if (!src) continue;
      if (src.indexOf('user-gen-media-assets') !== -1 || src.indexOf('gemini_images') !== -1) {
        return true;
      }
    }
    return false;
  }

  function hasAnswerContent(anchor) {
    var content = getAnswerNode(anchor);
    if (!content) return false;
    return (content.innerText || '').trim().length > 0 ||
      hasGeneratedImageAsset(content) || hasGeneratedImageAsset(anchor);
  }

  /** Perplexity wraps a turn in the final-text marker only after its last token lands,
   *  so it settles the answer even when the action row renders no copy control. */
  function isAnswerSettled(anchor) {
    if (!anchor) return false;
    var wrapper = anchor.closest ? anchor.closest(${FINAL_TEXT}) : null;
    // A wrapper holding more than this one answer would belong to an earlier turn, and
    // trusting it would report a still-streaming follow-up as finished.
    if (wrapper && wrapper.querySelectorAll(${ANCHOR}).length <= 1) return true;
    return findCopyButtonFor(anchor) !== null || findImageActionToolbarFor(anchor) !== null;
  }

  /** Thread title. The heading element is gone from the current renderer, which leaves
   *  the document title — Perplexity sets it to the thread's opening query. */
  function readThreadTitle() {
    var queryEl = document.querySelector('[role="heading"][aria-level="1"] span.select-text, [role="heading"][aria-level="1"] span, h1 span');
    var queryText = queryEl ? (queryEl.innerText || '').trim() : '';
    if (queryText) return queryText;
    var docTitle = (document.title || '').trim();
    return docTitle === 'Perplexity' ? '' : docTitle;
  }

  async function perplexityWaitAndRead(baseline) {
    await waitFor(function() {
      return getResponseNodes().length > baseline;
    }, 'new Perplexity response node', TIMEOUT, 350);

    await waitFor(function() {
      return hasAnswerContent(getLatestResponseAnchor());
    }, 'Perplexity AI response content', TIMEOUT, 350);

    var NO_CHANGE_LIMIT = TIMEOUT;
    var pplxLastLen = -1;
    var pplxLastChangeAt = null;
    while (true) {
      var anchor = getLatestResponseAnchor();
      if (isAnswerSettled(anchor)) break;
      var content = getAnswerNode(anchor);
      var curLen = content ? (content.innerText || '').length : 0;
      if (content && hasGeneratedImageAsset(content)) curLen += 1;
      if (curLen !== pplxLastLen) {
        pplxLastLen = curLen;
        pplxLastChangeAt = Date.now();
      }
      if (pplxLastChangeAt !== null && Date.now() - pplxLastChangeAt > NO_CHANGE_LIMIT) {
        throw new Error('Timeout: Perplexity response stopped updating');
      }
      await sleep(400);
    }

    await sleep(300);

    var targetAnchor = getLatestResponseAnchor();
    var targetResponse = getAnswerNode(targetAnchor);
    if (!targetResponse) throw new Error('Perplexity response block not found');

    var copyBtn = findCopyButtonFor(targetAnchor);
    var hasGeneratedImage = hasGeneratedImageAsset(targetResponse) || hasGeneratedImageAsset(targetAnchor);
    var hasImageToolbar = findImageActionToolbarFor(targetAnchor) !== null;
    var isImageOnly = hasGeneratedImage && !copyBtn && hasImageToolbar;
    var copiedText = copyBtn ? ((await interceptCopy(copyBtn)) || '').trim() : '';
    var answerText = (targetResponse.innerText || '').trim();
    var finalAnswer = isImageOnly ? '' : (copiedText || answerText);

    if (!finalAnswer && !isImageOnly) throw new Error('Perplexity response is empty');

    return { response: finalAnswer, title: readThreadTitle(), isImageOnly: isImageOnly };
  }`;

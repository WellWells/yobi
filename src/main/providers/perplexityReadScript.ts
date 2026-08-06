/**
 * Browser-side read loop for Perplexity, injected via executeJavaScript.
 * Kept out of the automation flow so the test suite can run it against a real DOM.
 */

/** Per-answer anchor. The Node side counts with this too, so both stay in step. */
export const PPLX_RESPONSE_SELECTOR = '[id^="markdown-content-"]';

const ANCHOR = JSON.stringify(PPLX_RESPONSE_SELECTOR);

export const INJECTED_PPLX_READ_JS = `
  // Perplexity renders one anchor per answer as div[id^="markdown-content-"], NOT
  // article. Matching any element (tag-agnostic) is required.
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

  // The anchor is an empty placeholder in Perplexity's current renderer: answer text
  // streams into a .prose block several levels away in a sibling subtree of the same
  // answer card. Older threads still render the text inside the anchor, so resolve
  // both shapes. Only the text is read from here — the toolbar lookups below stay on
  // the anchor, which sits directly before the action row.
  function getAnswerNode(anchor) {
    if (!anchor) return null;
    if ((anchor.innerText || '').trim() || hasGeneratedImageAsset(anchor)) return anchor;
    var el = anchor.parentElement;
    var imageHost = null;
    for (var i = 0; i < 12 && el && el !== document.body; i++) {
      // A second anchor means the walk left this answer's card, and any .prose from
      // here on belongs to another turn.
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

  // Prefer copy buttons that belong to the response action toolbar
  // (same cluster as share/download/rewrite icons), then fall back
  // to any copy-icon button rendered after the response block.
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
            if (buttonHasIcon(toolbarButtons[k], 'pplx-icon-repeat')) hasRewrite = true;
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

  // An image answer renders no copy button, so its action row is the only completion
  // signal. The row is a sibling of the anchor, so this walks up — but never past this
  // answer's card, and never counts a previous turn's row, or a turn still streaming
  // would be read as finished.
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
        if (buttonHasIcon(buttons[k], 'pplx-icon-repeat')) hasRegenerate = true;
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

  // Waits for the latest response to finish generating, then extracts its text.
  async function perplexityWaitAndRead(baseline) {
    await waitFor(function() {
      return getResponseNodes().length > baseline;
    }, 'new Perplexity response node', TIMEOUT, 350);

    await waitFor(function() {
      return hasAnswerContent(getLatestResponseAnchor());
    }, 'Perplexity AI response content', TIMEOUT, 350);

    // Generation complete = the action toolbar (copy / image actions) appeared.
    // Idle timeout only starts after response content stops changing; window = the configured
    // response timeout (reset on every content change).
    var NO_CHANGE_LIMIT = TIMEOUT;
    var pplxLastLen = -1;
    var pplxLastChangeAt = null;
    while (true) {
      var anchor = getLatestResponseAnchor();
      if (anchor && (findCopyButtonFor(anchor) !== null || findImageActionToolbarFor(anchor) !== null)) break;
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

    // Brief settle delay for any trailing DOM updates
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

    // User query title lives in a [role="heading"][aria-level="1"] block (not an <h1>).
    var queryEl = document.querySelector('[role="heading"][aria-level="1"] span.select-text, [role="heading"][aria-level="1"] span, h1 span');
    var queryText = queryEl ? (queryEl.innerText || '').trim() : '';

    return { response: finalAnswer, title: queryText, isImageOnly: isImageOnly };
  }`;

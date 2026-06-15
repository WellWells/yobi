import type { BrowserWindow, WebContents } from 'electron';
import { navigateAndWait, isCloudflareChallengeActive, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { executeAutomationWithTimeout, countElements, dispatchFocusEvents } from './automationExecutor';
import { showInteractiveWorkerWindow } from '../windows';
import { raiseVerificationChallenge, VERIFICATION_CHALLENGE_ERROR_NAME } from './verificationChallenge';
import { PROVIDER_URLS } from '../../shared/types';
import { CLEAN_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';

// Backward-compatible alias: consumers (taskProcessor, flow executor) still import
// this name; it now points at the shared, provider-neutral verification-challenge marker.
export const PERPLEXITY_CLOUDFLARE_ERROR_NAME = VERIFICATION_CHALLENGE_ERROR_NAME;

export async function runPerplexityAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.perplexity,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, CLEAN_UA);

  await navigateAndWait(wc, targetUrl);

  if (await isCloudflareChallengeActive(wc)) {
    // Cloudflare re-challenges on a fresh load, so reloading into the interactive
    // window reliably re-shows the challenge for the user to solve.
    await showInteractiveWorkerWindow(targetUrl);
    throw raiseVerificationChallenge({
      titleKey: 'cloudflare.notify.title',
      bodyKey: 'cloudflare.notify.body',
      actionKey: 'cloudflare.notify.action.openWorker',
      errorKey: 'cloudflare.error.verificationFailed',
      logMessage: '⚠️ Cloudflare security check detected — task marked as FAILED and removed from queue',
    });
  }

  await dispatchFocusEvents(wc);

  const baseline = await countElements(wc, '[id^="markdown-content-"]');

  type PplxResult = { response: string; title: string; isImageOnly?: boolean };
  let fullyNavigated = false;
  const onFullNavigate = () => { fullyNavigated = true; };
  wc.on('did-navigate', onFullNavigate);

  const autoScript = buildPerplexityAutomationScript(prompt, baseline, timeoutMs);
  let result: PplxResult | null = null;
  try {
    result = await executeAutomationWithTimeout<PplxResult>(wc, autoScript, timeoutMs, 'Perplexity');
  } catch (err) {
    if (!fullyNavigated) throw err;
  } finally {
    wc.off('did-navigate', onFullNavigate);
  }

  if (!result && fullyNavigated) {
    await waitForPageLoad(wc, 30_000);
    const readScript = buildPerplexityReadScript(0, timeoutMs);
    result = await executeAutomationWithTimeout<PplxResult>(wc, readScript, timeoutMs, 'Perplexity');
  }

  if (!result || typeof result.response !== 'string') {
    throw new Error('Perplexity returned empty response');
  }
  if (result.response.trim() === '' && !result.isImageOnly) {
    throw new Error('Perplexity returned empty response');
  }

  return {
    response: result.response.trim(),
    title: (result.title || '').trim(),
  };
}

async function waitForPageLoad(wc: WebContents, timeoutMs: number): Promise<void> {
  if (!wc.isLoading()) return;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Post-navigation page load timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    wc.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
  });
}

const INJECTED_PPLX_READ_JS = `
  // Perplexity renders response blocks as div[id^="markdown-content-"], NOT article.
  // Matching any element (tag-agnostic) is required.
  function getResponseNodes() {
    return document.querySelectorAll('[id^="markdown-content-"]');
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

  function hasButtonIcon(root, iconName) {
    if (!root) return false;
    var buttons = root.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttonHasIcon(buttons[i], iconName)) return true;
    }
    return false;
  }

  function findImageActionToolbarFor(responseEl) {
    var el = responseEl;
    for (var i = 0; i < 12 && el && el !== document.body; i++) {
      var hasDownload = hasButtonIcon(el, 'pplx-icon-download');
      var hasRegenerate = hasButtonIcon(el, 'pplx-icon-repeat');
      if (hasDownload && hasRegenerate && isNodeAfterResponse(el, responseEl)) return el;
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

  // Waits for the latest response to finish generating, then extracts its text.
  async function perplexityWaitAndRead(baseline) {
    await waitFor(function() {
      return getResponseNodes().length > baseline;
    }, 'new Perplexity response node', TIMEOUT, 350);

    await waitFor(function() {
      var nodes = getResponseNodes();
      var el = nodes[nodes.length - 1];
      return el && ((el.innerText || '').trim().length > 0 || hasGeneratedImageAsset(el));
    }, 'Perplexity AI response content', TIMEOUT, 350);

    // Generation complete = the action toolbar (copy / image actions) appeared.
    // Timeout only starts after response content stops changing (30 s inactivity).
    var NO_CHANGE_LIMIT = 30000;
    var pplxLastLen = -1;
    var pplxLastChangeAt = null;
    while (true) {
      var nodes = getResponseNodes();
      var el = nodes[nodes.length - 1];
      if (el && (findCopyButtonFor(el) !== null || findImageActionToolbarFor(el) !== null)) break;
      var curLen = el ? (el.innerText || '').length : 0;
      if (el && hasGeneratedImageAsset(el)) curLen += 1;
      if (curLen !== pplxLastLen) {
        pplxLastLen = curLen;
        pplxLastChangeAt = Date.now();
      }
      if (pplxLastChangeAt !== null && Date.now() - pplxLastChangeAt > NO_CHANGE_LIMIT) {
        throw new Error('Timeout: Perplexity response had no changes for 30 seconds');
      }
      await sleep(400);
    }

    // Brief settle delay for any trailing DOM updates
    await sleep(300);

    var allResponses = getResponseNodes();
    var targetResponse = allResponses[allResponses.length - 1];
    if (!targetResponse) throw new Error('Perplexity response block not found');

    var copyBtn = findCopyButtonFor(targetResponse);
    var hasGeneratedImage = hasGeneratedImageAsset(targetResponse);
    var hasImageToolbar = findImageActionToolbarFor(targetResponse) !== null;
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

function buildPerplexityReadScript(
  baselineMessageCount: number,
  timeoutMs: number,
): string {
  return `
(async function perplexityRead() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_PPLX_READ_JS}

  return await perplexityWaitAndRead(BASELINE);
})()`;
}

function buildPerplexityAutomationScript(
  prompt: string,
  baselineMessageCount: number,
  timeoutMs: number,
): string {
  const escapedPrompt = JSON.stringify(prompt);

  return `
(async function perplexityAutomate() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${INJECTED_PPLX_READ_JS}

  // ── Locate input ─────────────────────────────────────────────────────────────
  var INPUT_SELECTORS = [
    '#ask-input[contenteditable="true"]',
    'div.chat-input-container #ask-input',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]',
  ];

  var input = null;
  await waitFor(function() {
    for (var i = 0; i < INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(INPUT_SELECTORS[i]);
      if (el) { input = el; return true; }
    }
    return false;
  }, 'Perplexity input area', 15000, 200);

  if (!input) throw new Error('Perplexity input area not found');

  // ── Type prompt ──────────────────────────────────────────────────────────────
  input.focus();
  input.textContent = '';
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'deleteContent'
  }));
  await sleep(80);
  var dt = new DataTransfer();
  dt.setData('text/plain', ${escapedPrompt});
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  // Perplexity uses Lexical editor which processes paste asynchronously;
  // wait for DOM to settle before checking if the fallback is needed.
  await sleep(150);
  if (!(input.innerText || '').trim()) {
    document.execCommand('insertText', false, ${escapedPrompt});
  }
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'insertText'
  }));
  await sleep(250);

  // ── Submit ───────────────────────────────────────────────────────────────────
  // The submit button is the primary (bg-button-bg) button inside the ask-input
  // container; the English aria-label selectors are kept only as a fallback.
  function findSubmitBtn() {
    var container = document.querySelector('[data-ask-input-container="true"]');
    var btn = container ? container.querySelector('button.bg-button-bg') : null;
    if (btn) return btn;
    var SEND_SELECTORS = ['button[aria-label="Submit"]', 'button[aria-label="Send"]', 'button[data-testid="submit-button"]'];
    for (var s = 0; s < SEND_SELECTORS.length; s++) {
      var b = document.querySelector(SEND_SELECTORS[s]);
      if (b) return b;
    }
    return null;
  }

  var sent = false;
  for (var attempt = 0; attempt < 28 && !sent; attempt++) {
    var sendBtn = findSubmitBtn();
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      sent = true;
      break;
    }
    if (!sent) await sleep(120);
  }

  if (!sent) {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
    }));
    await sleep(40);
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
  }

  return await perplexityWaitAndRead(BASELINE);
})()`;
}

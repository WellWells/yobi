// src/main/providers/perplexity.ts — Electron DOM-injection automation for Perplexity web
import type { BrowserWindow } from 'electron';
import { navigateAndWait, isCloudflareChallengeActive, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { sendLog, sendWebNotification } from '../helpers';
import { showInteractiveWorkerWindow } from '../windows';
import { getLangCache, t } from '../i18n';
import { PROVIDER_URLS } from '../../shared/types';

export const PERPLEXITY_CLOUDFLARE_ERROR_NAME = 'PerplexityCloudflareChallengeError';

export async function runPerplexityAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.perplexity,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  await navigateAndWait(wc, targetUrl);

  // Detect a Cloudflare challenge and fail immediately — do not block the queue waiting for resolution.
  if (await isCloudflareChallengeActive(wc)) {
    const strings = getLangCache();
    await showInteractiveWorkerWindow(targetUrl);
    sendWebNotification(
      t(strings, 'cloudflare.notify.title'),
      t(strings, 'cloudflare.notify.body'),
      'error',
      {
        id: 'open-worker-window',
        label: t(strings, 'cloudflare.notify.action.openWorker'),
      },
    );
    sendLog('⚠️ Cloudflare security check detected — task marked as FAILED and removed from queue');
    const error = new Error(t(strings, 'cloudflare.error.verificationFailed'));
    error.name = PERPLEXITY_CLOUDFLARE_ERROR_NAME;
    throw error;
  }

  await wc.executeJavaScript(`
    window.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  `, false);

  // Baseline: count existing response nodes before sending
  let baseline = 0;
  try {
    baseline = await wc.executeJavaScript(
      `document.querySelectorAll('[id^="markdown-content-"]').length`,
      false,
    );
  } catch {
    baseline = 0;
  }

  const autoScript = buildPerplexityAutomationScript(prompt, baseline, timeoutMs);

  let nodeTimeoutId!: ReturnType<typeof setTimeout>;
  const nodeTimeout = new Promise<never>((_, reject) => {
    nodeTimeoutId = setTimeout(
      () => reject(new Error('Perplexity automation timed out (Node side)')),
      Math.max(timeoutMs * 5, 300_000),
    );
  });

  let result: { response: string; title: string; isImageOnly?: boolean };
  try {
    result = await Promise.race([wc.executeJavaScript(autoScript, true), nodeTimeout]);
  } catch (err: unknown) {
    throw new Error(`Perplexity automation failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(nodeTimeoutId);
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
  var startedAt = Date.now();
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}

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
  var SEND_SELECTORS = [
    'button[aria-label="Submit"]',
    'button[aria-label="Send"]',
    'button[data-testid="submit-button"]',
  ];

  var sent = false;
  for (var attempt = 0; attempt < 28 && !sent; attempt++) {
    for (var s = 0; s < SEND_SELECTORS.length; s++) {
      var sendBtn = document.querySelector(SEND_SELECTORS[s]);
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        sent = true;
        break;
      }
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

  // ── Wait for new response node ────────────────────────────────────────────────
  await waitFor(function() {
    return getResponseNodes().length > BASELINE;
  }, 'new Perplexity response node', TIMEOUT, 350);

  await waitFor(function() {
    var nodes = getResponseNodes();
    var el = nodes[nodes.length - 1];
    return el && ((el.innerText || '').trim().length > 0 || hasGeneratedImageAsset(el));
  }, 'Perplexity AI response content', TIMEOUT, 350);

  // ── Wait for generation complete ───────────────────────────────────────────────
  // Timeout only starts after response content stops changing (30 s of inactivity).
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

  // ── Extract response ──────────────────────────────────────────────────────────
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

  // Extract query title: look for the user-query h1 in the whole page
  var queryEl  = document.querySelector('h1 span.select-text, h1 span[class*="min-w-0"], h1 span');
  var queryText = queryEl ? (queryEl.innerText || '').trim() : '';

  return { response: finalAnswer, title: queryText, isImageOnly: isImageOnly };
})()`;
}

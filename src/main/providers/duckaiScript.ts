import type { WebContents } from 'electron';
import { INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS } from './common';

const DUCKAI_MAX_PROMPT_CHARS = 16_000;

// DuckDuckGo shows a human-verification "anomaly" overlay ("select all squares with
// ducks") when it flags automated / idle-then-burst traffic. It is identified by these
// language-independent selectors — DuckDuckGo's own testids plus the /assets/anomaly/
// asset path — so detection never depends on the user's locale. None of these appear on
// a normal duck.ai page. Single calibration point; consumed both in-page
// (buildDuckaiAutomationScript) and Node-side (isDuckaiChallengeActive).
export const DUCKAI_CHALLENGE_SELECTOR =
  '[data-testid^="anomaly-modal-"], img[src*="assets/anomaly"], [style*="assets/anomaly"]';

export function injectDuckaiLocalStorage(wc: WebContents): Promise<void> {
  return wc
    .executeJavaScript(
      `try{` +
        `localStorage.setItem('duckaiHasAgreedToTerms','true');` +
        `localStorage.setItem('isRecentChatsOn','1');` +
        `}catch(e){}`,
      false,
    )
    .then(() => undefined)
    .catch(() => undefined);
}

export function setupDuckaiLocalStorageOnDomReady(wc: WebContents): Promise<void> {
  return new Promise<void>((resolve) => {
    wc.once('dom-ready', () => {
      injectDuckaiLocalStorage(wc).then(resolve).catch(resolve);
    });
  });
}

export function buildDuckaiAutomationScript(
  prompt: string,
  baselineMessageCount: number,
  timeoutMs: number,
  modelId: string,
): string {
  const clippedPrompt = prompt.length > DUCKAI_MAX_PROMPT_CHARS
    ? prompt.slice(0, DUCKAI_MAX_PROMPT_CHARS)
    : prompt;
  const escapedPrompt = JSON.stringify(clippedPrompt);

  return `
(async function duckaiAutomate() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  var TARGET_MODEL = ${JSON.stringify(modelId)};
  var CHALLENGE_SELECTOR = ${JSON.stringify(DUCKAI_CHALLENGE_SELECTOR)};

  console.debug('[DuckAI Automate] 🚀 Script started', { TIMEOUT: TIMEOUT, BASELINE: BASELINE, TARGET_MODEL: TARGET_MODEL });

  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}

  // Detects DuckDuckGo's human-verification overlay (appears right after submit
  // when traffic is flagged); the Node side reveals the worker window and notifies.
  function isDuckaiChallenge() {
    return !!document.querySelector(CHALLENGE_SELECTOR);
  }

  // ── Fallback: dismiss onboarding modal if localStorage injection was too late ──
  var onboardBtn = document.querySelector('button[data-testid="DUCKAI_ONBOARDING_AGREE"]');
  if (onboardBtn) {
    console.debug('[DuckAI Automate] 🛡️ Onboarding modal detected, attempting to close...');
    onboardBtn.click();
    await sleep(600);
  }

  // ── Switch model via the picker menu (if a specific model was requested) ───────
  if (TARGET_MODEL) {
    console.debug('[DuckAI Automate] 🔄 Switching model to:', TARGET_MODEL);
    // 1. Wait for the model-picker button, then open its menu.
    var modelPickerBtn = null;
    var msWaited = 0;
    while (!modelPickerBtn && msWaited < 10000) {
      modelPickerBtn = document.querySelector('[data-testid="model-picker-button"]');
      if (!modelPickerBtn) {
        await sleep(200);
        msWaited += 200;
      }
    }
    if (!modelPickerBtn) throw new Error('Duck AI error: model picker button not found');

    if (modelPickerBtn.getAttribute('aria-expanded') !== 'true') {
      console.debug('[DuckAI Automate] 🖱️ Opening model picker menu...');
      modelPickerBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      modelPickerBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      modelPickerBtn.click();
      await sleep(500);
    }

    // 2. Click the target model row; selection applies immediately and auto-closes the menu.
    var safeTargetModel = TARGET_MODEL.replace(/"/g, '\\"');
    var targetRow = document.querySelector('[data-testid="model-picker-row-' + safeTargetModel + '"]');
    if (!targetRow) throw new Error('Duck AI error: target model ID not found in picker - ' + TARGET_MODEL);

    console.debug('[DuckAI Automate] 🖱️ Selecting target model row...');
    targetRow.scrollIntoView({ block: 'center' });
    await sleep(100);
    var events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    events.forEach(function(ev) {
      targetRow.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
    });

    console.debug('[DuckAI Automate] ⏳ Waiting for picker menu to close...');
    var dcWaited = 0;
    while (document.querySelector('[role="menu"]') && dcWaited < 5000) {
      await sleep(100);
      dcWaited += 100;
    }
    await sleep(400);
  }

  // ── Locate textarea ───────────────────────────────────────────────────────────
  console.debug('[DuckAI Automate] 🔍 Looking for input area...');
  var input = null;
  await waitFor(function() {
    var el = document.querySelector('textarea[name="user-prompt"]');
    if (el) { input = el; return true; }
    return false;
  }, 'Duck AI input area', 15000, 300);

  if (!input) throw new Error('Duck AI input area not found');
  console.debug('[DuckAI Automate] ✅ Input area found, preparing to write prompt...');

  // ── Type prompt ───────────────────────────────────────────────────────────────
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(80);

  var dt = new DataTransfer();
  dt.setData('text/plain', ${escapedPrompt});
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(150);

  if (!(input.value || '').trim()) {
    console.debug('[DuckAI Automate] ⚠️ Clipboard paste failed, falling back to native setter...');
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(input, ${escapedPrompt});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(200);

  // ── Submit ────────────────────────────────────────────────────────────────────
  console.debug('[DuckAI Automate] 🔍 Looking for submit button...');
  var submitBtn = null;
  await waitFor(function() {
    var btn = document.querySelector('button[type="submit"]');
    if (btn && !btn.disabled) { submitBtn = btn; return true; }
    return false;
  }, 'Duck AI submit button', 10000, 150);

  if (!submitBtn) throw new Error('Duck AI submit button not available');
  console.debug('[DuckAI Automate] 🚀 Submitting prompt...');
  submitBtn.click();

  // ── Wait for response block to appear (or a human-verification overlay) ────────
  console.debug('[DuckAI Automate] ⏳ Waiting for response block to appear (beyond BASELINE)...');
  var respWaited = 0;
  var gotResponse = false;
  while (respWaited < TIMEOUT) {
    // Check the challenge FIRST: on submit DuckDuckGo inserts a "generating"
    // assistant-message placeholder at the same time as the anomaly modal, so a
    // response-first check would mistake that placeholder for a real answer.
    if (isDuckaiChallenge()) throw new Error('Duck AI human-verification challenge detected');
    if (document.querySelectorAll('div[id*="assistant-message"]').length > BASELINE) { gotResponse = true; break; }
    await sleep(350);
    respWaited += 350;
  }
  if (!gotResponse) throw new Error('Timeout waiting for: Duck AI response block');

  // ── Wait for generation to complete ───────────────────────────────────────────
  console.debug('[DuckAI Automate] ⏳ Response block detected, waiting for generation to complete...');
  var STOP_BTN_SELECTOR =
    'button[aria-label="Stop generating"],' +
    'button[aria-label="\u505c\u6b62\u7522\u751f"]';
  var seenStopBtn = false;
  var stableText = '';
  var stableCount = 0;
  var NO_CHANGE_LIMIT = 30000;
  var lastChangeAt = null;
  var loopCount = 0;

  while (true) {
    // The overlay can also appear during generation (or a hair after the response
    // placeholder), so keep polling for it here — otherwise a challenge-blocked
    // generation would hang until the Node-side hard timeout (~5 min).
    if (isDuckaiChallenge()) throw new Error('Duck AI human-verification challenge detected');

    var stopBtn = document.querySelector(STOP_BTN_SELECTOR);
    if (stopBtn) seenStopBtn = true;

    var promptArea = document.querySelector('textarea[name="user-prompt"]');
    var isInputReady = !!(promptArea && !promptArea.disabled);

    var allBlocks = document.querySelectorAll('div[id*="assistant-message"]');
    var lastBlock = allBlocks.length > 0 ? allBlocks[allBlocks.length - 1] : null;
    var currentText = lastBlock ? (lastBlock.innerText || '') : '';

    loopCount++;
    if (loopCount % 10 === 0) {
      console.debug('[DuckAI Automate] 🔄 Polling generation... current length:', currentText.length, 'InputReady:', isInputReady, 'StopBtn:', !!stopBtn);
    }

    if (seenStopBtn && !stopBtn && isInputReady && currentText.trim()) {
      console.debug('[DuckAI Automate] ✅ Generation completed (primary signal: stop button gone and input re-enabled)');
      break;
    }

    if (currentText !== stableText) {
      stableText = currentText;
      stableCount = 0;
      if (currentText) lastChangeAt = Date.now();
    } else if (currentText) {
      stableCount += 1;
    }

    if (stableCount >= 12 && stableText.trim() && isInputReady) {
      console.debug('[DuckAI Automate] ✅ Generation completed (fallback signal: content stable for 1.2s and input re-enabled)');
      break;
    }

    if (lastChangeAt !== null && Date.now() - lastChangeAt > NO_CHANGE_LIMIT) {
      console.debug('[DuckAI Automate] ❌ Generation timeout: no content change for 30 seconds');
      throw new Error('Duck AI automation timed out: no response changes for 30 seconds');
    }

    await sleep(100);
  }

  // ── Extract response ──────────────────────────────────────────────────────────
  console.debug('[DuckAI Automate] 🔍 Extracting response content...');
  var responseHeaders = document.querySelectorAll('div[id*="assistant-message"]');
  var latestHeader = responseHeaders.length > 0 ? responseHeaders[responseHeaders.length - 1] : null;
  if (!latestHeader) throw new Error('Duck AI error: response header block not found after generation');

  var contentBlock = latestHeader.nextElementSibling;
  var actionBlock = contentBlock ? contentBlock.nextElementSibling : null;

  console.debug('[DuckAI Automate] 🖱️ Simulating hover to trigger React render for copy button...');
  var hoverTarget = actionBlock || contentBlock || latestHeader;
  hoverTarget.scrollIntoView({ block: 'center' });
  await sleep(100);
  hoverTarget.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, composed: true }));
  hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
  hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }));
  await sleep(300);

  // Poll up to 3 s for the copy button to render after hover events.
  var copyBtn = null;
  for (var cbWait = 0; cbWait < 15; cbWait++) {
    if (actionBlock) {
      copyBtn = actionBlock.querySelector('button[data-copyairesponse="true"]');
    }
    if (!copyBtn) {
      var allCopyBtns = document.querySelectorAll('button[data-copyairesponse="true"]');
      copyBtn = allCopyBtns.length > 0 ? allCopyBtns[allCopyBtns.length - 1] : null;
    }
    if (copyBtn) break;
    await sleep(200);
  }

  var copiedText = '';
  if (copyBtn) {
    // Mock navigator.clipboard.writeText BEFORE dispatching click events.
    // The real writeText throws NotAllowedError in an unfocused worker window,
    // so we shadow it with an own property on navigator that captures the text
    // and returns Promise.resolve() to keep React's handler happy.
    var origClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: function(text) {
          copiedText = text;
          return Promise.resolve();
        }
      },
      configurable: true
    });
    try {
      var btnEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      for (var i = 0; i < btnEvents.length; i++) {
        copyBtn.dispatchEvent(new MouseEvent(btnEvents[i], { bubbles: true, cancelable: true, view: window }));
      }
      // Allow React's async writeText handler to resolve.
      await sleep(300);
    } finally {
      if (origClipboardDesc) {
        Object.defineProperty(navigator, 'clipboard', origClipboardDesc);
      } else {
        try { delete navigator.clipboard; } catch (e) {}
      }
    }
    copiedText = copiedText.trim();
  }

  var fallbackText = '';
  if (!copiedText) {
    var textContainer = null;
    if (contentBlock) {
      textContainer = contentBlock.querySelector('.whitespace-normal') || 
                      contentBlock.querySelector('[class*="space-y-4"]') || 
                      contentBlock;
    }
    if (!textContainer) {
      var allTextContainers = document.querySelectorAll('.whitespace-normal, [class*="space-y-4"]');
      textContainer = allTextContainers.length > 0 ? allTextContainers[allTextContainers.length - 1] : latestHeader;
    }
    fallbackText = (textContainer.innerText || '').trim();
    console.debug('[DuckAI Automate] 📋 Fallback DOM extraction complete, length:', fallbackText.length);
  }

  var finalAnswer = copiedText || fallbackText;
  if (!finalAnswer) throw new Error('Duck AI error: extracted response content is empty');
  
  // ── Extract AI-generated chat title ──────────────────────────────────────────
  console.debug('[DuckAI Automate] 📝 Extracting chat title...');
  var chatTitle = '';
  var titleWaited = 0;
  while (titleWaited < 500) {
    var rawTitle = (document.title || '').trim();
    if (rawTitle && rawTitle !== 'Duck.ai' && rawTitle !== 'duck.ai' && rawTitle !== 'DuckDuckGo') {
      chatTitle = rawTitle
        .replace(/\s*[|]\s*Duck\.ai\s*$/i, '')
        .replace(/\s*[-]\s*Duck\.ai\s*$/i, '')
        .trim();
      break;
    }
    await sleep(100);
    titleWaited += 100;
  }

  if (!chatTitle) {
    console.debug('[DuckAI Automate] ⚠️ Document title did not change, attempting sidebar extraction...');
    var firstChatItem = document.querySelector('[data-testid="RecentChatsList"] div[title]');
    if (firstChatItem) {
      chatTitle = firstChatItem.getAttribute('title') || '';
    }
  }

  console.debug('[DuckAI Automate] 🎉 Script finished successfully', { title: chatTitle, responseLength: finalAnswer.length });
  return { response: finalAnswer, title: chatTitle };
})()`;
}

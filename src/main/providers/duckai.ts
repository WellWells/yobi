// src/main/providers/duckai.ts — Electron DOM-injection automation for Duck AI web
import type { BrowserWindow, WebContents } from 'electron';
import {
  navigateAndWait,
  sleep,
  INJECTED_SLEEP_JS,
  INJECTED_WAIT_FOR_JS,
} from './common';
import { PROVIDER_URLS } from '../../shared/types';
import type { DuckaiModelInfo } from '../../shared/types';

const DUCKAI_HOME = PROVIDER_URLS.duckai;
const DUCKAI_MAX_PROMPT_CHARS = 16_000;

// ── Onboarding prevention helpers ────────────────────────────────────────────

/**
 * Writes the localStorage keys that suppress duck.ai's first-visit onboarding
 * modal. Must be called while the webContents is already on the duck.ai origin.
 */
function injectDuckaiLocalStorage(wc: WebContents): Promise<void> {
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

/**
 * Registers a one-shot `dom-ready` listener that injects localStorage keys
 * BEFORE React mounts, preventing the onboarding modal from ever rendering.
 * Must be called BEFORE starting navigation (i.e., before navigateAndWait).
 */
function setupDuckaiLocalStorageOnDomReady(wc: WebContents): Promise<void> {
  return new Promise<void>((resolve) => {
    wc.once('dom-ready', () => {
      injectDuckaiLocalStorage(wc).then(resolve).catch(resolve);
    });
  });
}

export type { DuckaiModelInfo };

/**
 * Fetches the list of models available on duck.ai by reading the model
 * selector radio inputs from the DOM. Opens and immediately closes the
 * model picker dialog if it is not already open.
 *
 * Navigation is skipped when the worker window is already on the duck.ai
 * origin (e.g., ensureWorkerWindow already loaded it as the initial URL).
 * Navigating twice in quick succession doubles the /duckchat/v1/status calls
 * and triggers 429 rate-limit errors from duck.ai.
 */
export async function fetchDuckaiModels(workerWin: BrowserWindow): Promise<DuckaiModelInfo[]> {
  const wc = workerWin.webContents;

  const alreadyOnDuckAi = wc.getURL().includes('duck.ai');

  if (!alreadyOnDuckAi) {
    // Worker is on a different URL — navigate cleanly.
    // setupDuckaiLocalStorageOnDomReady must be registered BEFORE loadURL fires.
    const lsReady = setupDuckaiLocalStorageOnDomReady(wc);
    await navigateAndWait(wc, DUCKAI_HOME);
    await lsReady;
    await sleep(1_500);
  } else {
    // Worker was already navigated to duck.ai (e.g., by ensureWorkerWindow).
    // If still loading, wait for it to settle; otherwise just inject LS.
    if (wc.isLoading()) {
      await new Promise<void>((resolve) => { wc.once('did-finish-load', () => resolve()); });
    }
    await injectDuckaiLocalStorage(wc);
    // Give React time to mount after the existing navigation completes.
    await sleep(1_000);
  }

  return wc.executeJavaScript(`
    (async function() {
        // Wait for either model inputs (dialog open) or the model-select button
        // to appear, giving React up to 15 seconds to finish rendering.
        let menuBtn = null;
        let inputs = document.querySelectorAll('input[name="model"]');
        let waited = 0;
        while (inputs.length === 0 && !menuBtn && waited < 15000) {
            await new Promise(function(r) { setTimeout(r, 300); });
            waited += 300;
            inputs = document.querySelectorAll('input[name="model"]');
            menuBtn = document.querySelector('[data-testid="model-select-button"]');
        }
        let wasClosedByScript = false;
        if (inputs.length === 0) {
            if (!menuBtn) throw new Error("Cannot find model interface after waiting");
            menuBtn.click();
            wasClosedByScript = true;
            await new Promise(function(r) { setTimeout(r, 300); });
            inputs = document.querySelectorAll('input[name="model"]');
        }
        if (inputs.length === 0) throw new Error("Cannot fetch model list");
        const modelList = Array.from(inputs).map(function(input) {
            const label = document.querySelector('label[for="' + input.id + '"]');
            const nameNode = label ? label.querySelector('.J58ouJfofMIxA2Ukt6lA') : null;
            const mainName = nameNode && nameNode.childNodes[0] ? nameNode.childNodes[0].textContent.trim() : "Unknown";
            const variantSpan = nameNode ? nameNode.querySelector('span') : null;
            const variant = variantSpan ? variantSpan.textContent.trim() : "";
            return {
                id: input.value,
                label: (mainName + " " + variant).trim(),
                isActive: input.checked || input.getAttribute('aria-checked') === 'true'
            };
        });
        if (wasClosedByScript) {
            const closeBtn = document.querySelector('button[aria-label="close dialog"]');
            if (closeBtn) closeBtn.click();
        }
        return modelList;
    })()
  `, false);
}

/**
 * Runs the full Duck AI automation: injects the prompt, waits for the
 * response to complete, and returns the extracted text.
 *
 * Model selection is passed via the `targetUrl` query param as an internal
 * encoding (`?model=<id>`). The ID is extracted, stripped from the URL before
 * navigation, then applied via DOM: open the model picker dialog, select the
 * matching radio input, and click "Start New Chat".
 */
export async function runDuckaiAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = DUCKAI_HOME,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  // Extract model ID from ?model= query param; empty string = use current selection.
  let modelId = '';
  let navigateUrl: string = DUCKAI_HOME;
  try {
    const parsed = new URL(targetUrl);
    modelId = parsed.searchParams.get('model') ?? '';

    modelId = modelId.replace(/\/$/, '').trim();

    parsed.searchParams.delete('model');
    navigateUrl = parsed.toString();
  } catch {
    navigateUrl = DUCKAI_HOME;
  }

  // Inject localStorage at dom-ready so the onboarding modal never mounts.
  const lsReady = setupDuckaiLocalStorageOnDomReady(wc);
  await navigateAndWait(wc, navigateUrl);
  await lsReady;

  // Dispatch focus events so duck.ai doesn't throttle the hidden worker window.
  await wc.executeJavaScript(`
    window.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  `, false);

  let baseline = 0;
  try {
    baseline = await wc.executeJavaScript(
      `document.querySelectorAll('div[id*="assistant-message"]').length`,
      false,
    );
  } catch {
    baseline = 0;
  }

  const autoScript = buildDuckaiAutomationScript(prompt, baseline, timeoutMs, modelId);

  let nodeTimeoutId!: ReturnType<typeof setTimeout>;
  const nodeTimeout = new Promise<never>((_, reject) => {
    nodeTimeoutId = setTimeout(
      () => reject(new Error('Duck AI automation timed out (Node side)')),
      Math.max(timeoutMs * 5, 300_000),
    );
  });

  let result: { response: string; title: string };
  try {
    result = await Promise.race([wc.executeJavaScript(autoScript, true), nodeTimeout]);
  } catch (err: unknown) {
    throw new Error(`Duck AI automation failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(nodeTimeoutId);
  }

  if (!result || !result.response || result.response.trim() === '') {
    throw new Error('Duck AI returned empty response');
  }

  return {
    response: result.response.trim(),
    title: (result.title || '').trim(),
  };
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

  // Rules for the IIFE body: no backticks, no ?. optional chaining — plain ES2017.
  return `
(async function duckaiAutomate() {
  var TIMEOUT  = ${timeoutMs};
  var BASELINE = ${baselineMessageCount};
  var TARGET_MODEL = ${JSON.stringify(modelId)};
  
  console.debug('[DuckAI Automate] 🚀 Script started', { TIMEOUT: TIMEOUT, BASELINE: BASELINE, TARGET_MODEL: TARGET_MODEL });
  
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}

  // ── Fallback: dismiss onboarding modal if localStorage injection was too late ──
  var onboardBtn = document.querySelector('button[data-testid="DUCKAI_ONBOARDING_AGREE"]');
  if (onboardBtn) {
    console.debug('[DuckAI Automate] 🛡️ Onboarding modal detected, attempting to close...');
    onboardBtn.click();
    await sleep(600);
  }

  // ── Switch model via DOM dialog (if a specific model was requested) ────────────
  if (TARGET_MODEL) {
    console.debug('[DuckAI Automate] 🔄 Switching model to:', TARGET_MODEL);
    // 1. Wait for and click the model selector button (opens dialog)
    var modelSelectBtn = null;
    var msWaited = 0;
    while (!modelSelectBtn && msWaited < 10000) {
      modelSelectBtn = document.querySelector('[data-testid="model-select-button"]');
      if (!modelSelectBtn) {
        await sleep(200);
        msWaited += 200;
      }
    }
    if (!modelSelectBtn) throw new Error('Duck AI error: model selector button not found');

    console.debug('[DuckAI Automate] 🖱️ Clicking model selector button to open dialog...');
    modelSelectBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    modelSelectBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    modelSelectBtn.click();
    
    await sleep(600); 

    // 2. Find the target model radio and label
    var safeTargetModel = TARGET_MODEL.replace(/"/g, '\\"');
    var targetRadio = document.querySelector('input[name="model"][value="' + safeTargetModel + '"]');

    if (targetRadio) {
      console.debug('[DuckAI Automate] ✅ Target model radio input found');
      var targetLabel = document.querySelector('label[for="' + targetRadio.id + '"]');

      if (targetLabel) {
        console.debug('[DuckAI Automate] 🖱️ Simulating click on model label...');
        targetLabel.scrollIntoView({ block: 'center' });
        await sleep(100);

        var events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        events.forEach(function(ev) {
          targetLabel.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
        });
      }
      await sleep(150);

      console.debug('[DuckAI Automate] ⚙️ Triggering native input setter to ensure state update...');
      var nativeCheckedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
      if (nativeCheckedSetter) {
        nativeCheckedSetter.call(targetRadio, true);
        targetRadio.dispatchEvent(new Event('input', { bubbles: true }));
        targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await sleep(300);
    } else {
      throw new Error('Duck AI error: target model ID not found in selector - ' + TARGET_MODEL);
    }

    // 4. Click the "Start a new chat" button inside the dialog
    var startBtn = document.querySelector('[role="dialog"] button[type="submit"]');
    if (startBtn) {
      console.debug('[DuckAI Automate] 🖱️ Clicking "Start a new chat" button...');
      if (startBtn.disabled) await sleep(300);
      
      var btnEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      btnEvents.forEach(function(ev) {
        startBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
      });

      console.debug('[DuckAI Automate] ⏳ Waiting for dialog to close...');
      var dcWaited = 0;
      while (document.querySelector('[role="dialog"]') && dcWaited < 5000) {
        await sleep(100);
        dcWaited += 100;
      }
      await sleep(500); 
    } else {
      throw new Error('Duck AI error: could not find confirmation button for "Start a new chat"');
    }
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

  // ── Wait for response block to appear ─────────────────────────────────────────
  console.debug('[DuckAI Automate] ⏳ Waiting for response block to appear (beyond BASELINE)...');
  await waitFor(function() {
    return document.querySelectorAll('div[id*="assistant-message"]').length > BASELINE;
  }, 'Duck AI response block', TIMEOUT, 350);

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

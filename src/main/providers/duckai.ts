import type { BrowserWindow, WebContents } from 'electron';
import { navigateAndWait, sleep } from './common';
import { executeAutomationWithTimeout, countElements, dispatchFocusEvents } from './automationExecutor';
import {
  buildDuckaiAutomationScript,
  injectDuckaiLocalStorage,
  setupDuckaiLocalStorageOnDomReady,
  DUCKAI_CHALLENGE_SELECTOR,
} from './duckaiScript';
import { clearProviderSession } from './authStatus';
import { VERIFICATION_CHALLENGE_ERROR_NAME } from './verificationChallenge';
import { sendLog, sendWebNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import { PROVIDER_URLS } from '../../shared/types';
import type { DuckaiModelInfo } from '../../shared/types';
import { FIREFOX_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';

const DUCKAI_HOME = PROVIDER_URLS.duckai;

export type { DuckaiModelInfo };

// True when DuckDuckGo's human-verification overlay ("select all squares with
// ducks") is showing on the worker page — detected via language-independent
// selectors (its own testids / asset path), so it works in any locale.
export async function isDuckaiChallengeActive(wc: WebContents): Promise<boolean> {
  try {
    return (await wc.executeJavaScript(
      `!!document.querySelector(${JSON.stringify(DUCKAI_CHALLENGE_SELECTOR)})`,
      false,
    )) as boolean;
  } catch {
    return false;
  }
}

// If the verification overlay is up, wipe duck.ai's cookies / session / localStorage
// so the next attempt starts from a clean session (the anomaly challenge is tied to
// the flagged session; paired with the Firefox persona this looks like a fresh real
// browser), notify the user to retry, and throw the shared verification-challenge
// error so the task fails without retry. Returns normally when no challenge is present.
async function raiseIfDuckaiChallenge(wc: WebContents): Promise<void> {
  if (!(await isDuckaiChallengeActive(wc))) return;
  await clearProviderSession('duckai');
  const strings = getLangCache();
  sendWebNotification(
    t(strings, 'duckai.verify.notify.title'),
    t(strings, 'duckai.verify.notify.body'),
    'error',
  );
  sendLog('⚠️ DuckDuckGo human-verification detected — cleared Duck AI session/cookies; task marked as FAILED, please retry');
  const error = new Error(t(strings, 'duckai.verify.error.verificationFailed'));
  error.name = VERIFICATION_CHALLENGE_ERROR_NAME;
  throw error;
}

export async function fetchDuckaiModels(workerWin: BrowserWindow): Promise<DuckaiModelInfo[]> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, FIREFOX_UA);

  const alreadyOnDuckAi = wc.getURL().includes('duck.ai');

  if (!alreadyOnDuckAi) {
    const lsReady = setupDuckaiLocalStorageOnDomReady(wc);
    await navigateAndWait(wc, DUCKAI_HOME);
    await lsReady;
    await sleep(1_500);
  } else {
    if (wc.isLoading()) {
      await new Promise<void>((resolve) => { wc.once('did-finish-load', () => resolve()); });
    }
    await injectDuckaiLocalStorage(wc);
    await sleep(1_000);
  }

  return wc.executeJavaScript(`
    (async function() {
        // Wait for the model-picker button to render, giving React up to 15s.
        let btn = null;
        let waited = 0;
        while (!btn && waited < 15000) {
            btn = document.querySelector('[data-testid="model-picker-button"]');
            if (btn) break;
            await new Promise(function(r) { setTimeout(r, 300); });
            waited += 300;
        }
        if (!btn) throw new Error("Cannot find model interface after waiting");

        // Open the picker menu if it is not already expanded.
        let wasOpenedByScript = false;
        if (btn.getAttribute('aria-expanded') !== 'true') {
            btn.click();
            wasOpenedByScript = true;
        }

        // Wait for the menu rows to appear.
        let rows = [];
        let rowWaited = 0;
        while (rows.length === 0 && rowWaited < 5000) {
            rows = Array.prototype.slice.call(document.querySelectorAll('[data-testid^="model-picker-row-"]'));
            if (rows.length > 0) break;
            await new Promise(function(r) { setTimeout(r, 200); });
            rowWaited += 200;
        }
        if (rows.length === 0) throw new Error("Cannot fetch model list");

        const modelList = rows.map(function(row) {
            const id = (row.getAttribute('data-testid') || '').replace('model-picker-row-', '');
            // Content wrapper is the last span child (the first child is the icon);
            // its first child span holds the model name (a second span, if any, is a description).
            const spanKids = Array.prototype.slice.call(row.children).filter(function(c) { return c.tagName === 'SPAN'; });
            const content = spanKids.length > 0 ? spanKids[spanKids.length - 1] : null;
            const nameNode = content && content.children.length > 0 ? content.children[0] : null;
            const label = nameNode
                ? (nameNode.innerText || '').replace(/\\s+/g, ' ').trim()
                : (row.innerText || '').replace(/\\s+/g, ' ').trim();
            return {
                id: id,
                label: label || "Unknown",
                isActive: row.getAttribute('aria-checked') === 'true'
            };
        });

        // Close the menu we opened so the worker window is left clean.
        if (wasOpenedByScript) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
        }
        return modelList;
    })()
  `, false);
}

export async function runDuckaiAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = DUCKAI_HOME,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  // Present Duck AI as a real Firefox browser (same persona as Gemini): a coherent
  // Firefox UA with the Chromium Sec-CH-UA* client hints stripped, which looks less
  // like an automated Electron/Chromium client to DuckDuckGo's anti-bot checks.
  applyWorkerUserAgent(wc, FIREFOX_UA);

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

  const lsReady = setupDuckaiLocalStorageOnDomReady(wc);
  await navigateAndWait(wc, navigateUrl);
  await lsReady;

  // A challenge can already be up on load if traffic is flagged.
  await raiseIfDuckaiChallenge(wc);

  await dispatchFocusEvents(wc);

  const baseline = await countElements(wc, 'div[id*="assistant-message"]');

  const autoScript = buildDuckaiAutomationScript(prompt, baseline, timeoutMs, modelId);
  let result: { response: string; title: string } | null;
  try {
    result = await executeAutomationWithTimeout<{ response: string; title: string }>(
      wc,
      autoScript,
      timeoutMs,
      'Duck AI',
    );
  } catch (err) {
    // The overlay usually appears right after submit; convert the resulting
    // failure/timeout into the verification flow instead of a generic error.
    await raiseIfDuckaiChallenge(wc);
    throw err;
  }

  if (!result || !result.response || result.response.trim() === '') {
    await raiseIfDuckaiChallenge(wc);
    throw new Error('Duck AI returned empty response');
  }

  return {
    response: result.response.trim(),
    title: (result.title || '').trim(),
  };
}

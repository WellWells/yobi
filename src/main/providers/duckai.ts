import type { BrowserWindow, WebContents } from 'electron';
import { navigateAndWait, sleep } from './common';
import { executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import {
  buildDuckaiAutomationScript,
  buildDuckaiResetScript,
  injectDuckaiLocalStorage,
  setupDuckaiLocalStorageOnDomReady,
  DUCKAI_CHALLENGE_SELECTOR,
} from './duckaiScript';
import { raiseVerificationChallenge } from './verificationChallenge';
import { revealWorkerWindow } from '../windows';
import { PROVIDER_URLS } from '../../shared/types';
import type { DuckaiModelInfo } from '../../shared/types';
import { FIREFOX_UA } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { sendLog } from '../helpers';

const DUCKAI_HOME = PROVIDER_URLS.duckai;

export type { DuckaiModelInfo };

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

async function raiseIfDuckaiChallenge(wc: WebContents): Promise<void> {
  if (!(await isDuckaiChallengeActive(wc))) return;
  revealWorkerWindow();
  throw raiseVerificationChallenge({
    titleKey: 'duckai.verify.notify.title',
    bodyKey: 'duckai.verify.notify.body',
    actionKey: 'duckai.verify.notify.action.openWorker',
    errorKey: 'duckai.verify.error.verificationFailed',
    logMessage: '⚠️ DuckDuckGo human-verification detected — worker window opened for manual solve; task marked as FAILED (retry after solving)',
  });
}

async function waitForWorkerIdle(wc: WebContents, timeoutMs: number): Promise<void> {
  if (!wc.isLoading()) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => {
      clearTimeout(timer);
      wc.removeListener('did-stop-loading', done);
      wc.removeListener('did-finish-load', done);
      resolve();
    };
    timer = setTimeout(done, timeoutMs);
    wc.once('did-stop-loading', done);
    wc.once('did-finish-load', done);
  });
}

async function navigateToDuckaiWithRetry(wc: WebContents): Promise<void> {
  const MAX_ATTEMPTS = 2;
  let lsInjected: Promise<void> | null = null;
  const onDomReady = (): void => { lsInjected = injectDuckaiLocalStorage(wc).catch(() => {}); };
  wc.once('dom-ready', onDomReady);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await navigateAndWait(wc, DUCKAI_HOME);
        if (lsInjected) await lsInjected;
        return;
      } catch (err) {
        if (wc.getURL().includes('duck.ai')) {
          await injectDuckaiLocalStorage(wc).catch(() => {});
          return;
        }
        const aborted = err instanceof Error && /ERR_ABORTED|\(-3\)/.test(err.message);
        if (!aborted || attempt === MAX_ATTEMPTS) throw err;
        await sleep(1_500);
        await waitForWorkerIdle(wc, 8_000);
      }
    }
  } finally {
    wc.removeListener('dom-ready', onDomReady);
  }
}

export async function fetchDuckaiModels(workerWin: BrowserWindow): Promise<DuckaiModelInfo[]> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, FIREFOX_UA);

  await waitForWorkerIdle(wc, 8_000);

  if (wc.getURL().includes('duck.ai')) {
    await injectDuckaiLocalStorage(wc);
    await sleep(1_000);
  } else {
    await navigateToDuckaiWithRetry(wc);
    await sleep(1_500);
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

async function resetDuckaiConversation(wc: WebContents, navigateUrl: string): Promise<void> {
  try {
    await wc.executeJavaScript(buildDuckaiResetScript(), false);
  } catch {
    return;
  }
  const lsReady = setupDuckaiLocalStorageOnDomReady(wc);
  await navigateAndWait(wc, navigateUrl);
  await lsReady;
}

export async function runDuckaiAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = DUCKAI_HOME,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

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

  await resetDuckaiConversation(wc, navigateUrl);

  await raiseIfDuckaiChallenge(wc);

  await dispatchFocusEvents(wc);

  const baseline = await settledElementCount(wc, 'div[id*="assistant-message"]');
  if (baseline > 0) {
    sendLog(`⚠️ Duck AI still shows ${baseline} earlier message(s) after the conversation reset`);
  }

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

import type { BrowserWindow } from 'electron';
import { isCloudflareChallengeActive, waitForPageLoad, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { ensureOnPage, PAGE_REUSE } from './pageReuse';
import { countElements, executeAutomationWithTimeout, dispatchFocusEvents, settledElementCount } from './automationExecutor';
import { INJECTED_PPLX_READ_JS, PPLX_RESPONSE_SELECTOR } from './perplexityReadScript';
import { PPLX_SUBMIT_JS } from './perplexitySendScript';
import { forgetPerplexityVisitor, isPerplexitySignInWall, PERPLEXITY_SIGN_IN_WALL_ERROR } from './perplexityVisitor';
import { isPerplexitySignedIn } from './perplexitySession';
import { sendLog } from '../helpers';
import { showInteractiveWorkerWindow } from '../windows';
import { isSignInWindowOpen } from '../signInWindow';
import { raiseVerificationChallenge, VERIFICATION_CHALLENGE_ERROR_NAME } from './verificationChallenge';
import { PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';

export { isPerplexitySessionCookie } from './perplexitySession';

export const PERPLEXITY_CLOUDFLARE_ERROR_NAME = VERIFICATION_CHALLENGE_ERROR_NAME;

export async function runPerplexityAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.perplexity,
  _attachments?: string[],
  _wantTitle = false,
  continuingThread = false,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.perplexity);

  // Reset only for a new conversation (a follow-up would lose its thread), and never while a
  // sign-in window shares this partition.
  const freshVisitor = !continuingThread && !isSignInWindowOpen();
  if (freshVisitor && (await forgetPerplexityVisitor(wc.session, wc))) {
    sendLog('🧹 Perplexity (signed out): new conversation starts as a fresh visitor');
  }

  const result = await askPerplexity(workerWin, prompt, timeoutMs, targetUrl, continuingThread);
  if (!isPerplexitySignInWall(result.response)) return result;

  // Never handed over as the answer. A new conversation tries once more as another fresh visitor;
  // a walled follow-up cannot change visitor without leaving its thread.
  if (freshVisitor && !(await isPerplexitySignedIn(wc.session))) {
    sendLog('🔐 Perplexity asked this visitor to sign in — retrying once as another fresh visitor');
    await forgetPerplexityVisitor(wc.session, wc);
    const retry = await askPerplexity(workerWin, prompt, timeoutMs, targetUrl, false);
    if (!isPerplexitySignInWall(retry.response)) return retry;
  }
  throw new Error(PERPLEXITY_SIGN_IN_WALL_ERROR);
}

async function askPerplexity(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs: number,
  targetUrl: string,
  continuingThread: boolean,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  const landing = await ensureOnPage(wc, targetUrl, PAGE_REUSE.perplexity, { continuingThread });
  const reused = landing === 'reused';
  if (reused) sendLog('♻️ Perplexity page kept open — typing straight into it, no reload');

  if (await isCloudflareChallengeActive(wc)) {
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

  // A kept page settled its counts on the previous turn; only a fresh load can still hydrate.
  const baseline = reused
    ? await countElements(wc, PPLX_RESPONSE_SELECTOR)
    : await settledElementCount(wc, PPLX_RESPONSE_SELECTOR);

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
    const readScript = buildPerplexityReadScript(baseline, timeoutMs);
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

  ${PPLX_SUBMIT_JS}

  // Taken before the send: in a thread long enough to unmount old answers the count never moves.
  var seen = snapshotLatestAnswer();
  await perplexitySubmit(${escapedPrompt});

  return await perplexityWaitAndRead(BASELINE, { seen: seen });
})()`;
}

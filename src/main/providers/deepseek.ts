import type { BrowserWindow, WebContents } from 'electron';
import { isCloudflareChallengeActive, sleep, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS } from './common';
import { ensureOnPage, PAGE_REUSE, waitForThreadSettled } from './pageReuse';
import { executeAutomationWithTimeout, dispatchFocusEvents } from './automationExecutor';
import { sendLog } from '../helpers';
import { showInteractiveWorkerWindow, showLoginWindowIfNeeded } from '../windows';
import { raiseVerificationChallenge } from './verificationChallenge';
import { PROVIDER_LABELS, PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { DEEPSEEK_INPUT_SELECTOR, DEEPSEEK_PAGE_HELPERS_JS, DEEPSEEK_SUBMIT_JS } from './deepseekSendScript';
import { DEEPSEEK_LEFT_CONVERSATION, DEEPSEEK_READ_JS } from './deepseekReadScript';
import { deepseekConversationId, discardDeepseekConversation } from './deepseekDiscard';
import { uploadFilesToDeepseek } from './deepseekUpload';
import type { ProviderRunResult } from './generatedImages';
import {
  DEEPSEEK_LOGIN_REQUIRED,
  DEEPSEEK_SIGN_IN_URL,
  isDeepseekSignedOutPath,
  noteDeepseekSignedIn,
  readDeepseekTokenIn,
} from './deepseekSession';

const COMPOSER_WAIT_MS = 10_000;
/** Upload plus the server reading the file (a long PDF takes a while); separate from the answer's timeout. */
const UPLOAD_TIMEOUT_MS = 180_000;

interface DeepseekReadResult {
  response: string;
  title: string;
}

/** The app is client-rendered: at `load` there is no composer yet, and a signed-out visit is sent to /sign_in. */
async function waitForComposer(wc: WebContents): Promise<void> {
  const deadline = Date.now() + COMPOSER_WAIT_MS;
  while (Date.now() < deadline) {
    if (isDeepseekSignedOutPath(wc.getURL())) return;
    try {
      const found = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(DEEPSEEK_INPUT_SELECTOR)})`, false);
      if (found) return;
    } catch {
      // Mid-navigation; the next poll answers.
    }
    await sleep(250);
  }
}

async function hasToken(wc: WebContents): Promise<boolean> {
  try {
    return await readDeepseekTokenIn(wc);
  } catch {
    return false;
  }
}

export async function runDeepseekAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.deepseek,
  attachments?: string[],
  _wantTitle = false,
  continuingThread = false,
  /** DeepSeek always deletes new conversations after reading, including ordinary chat and agents. */
  _temporary = false,
): Promise<ProviderRunResult> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.deepseek);

  const landing = await ensureOnPage(wc, targetUrl, PAGE_REUSE.deepseek, { continuingThread });
  const reused = landing === 'reused';
  if (reused) sendLog('♻️ DeepSeek page kept open — typing straight into it, no reload');
  else await waitForComposer(wc);

  if (await isCloudflareChallengeActive(wc, DEEPSEEK_INPUT_SELECTOR)) {
    await showInteractiveWorkerWindow(targetUrl);
    throw raiseVerificationChallenge({
      titleKey: 'cloudflare.notify.title',
      bodyKey: 'cloudflare.notify.body',
      actionKey: 'cloudflare.notify.action.openWorker',
      errorKey: 'cloudflare.error.verificationFailed',
      logMessage: '⚠️ Security check detected on DeepSeek — task marked as FAILED and removed from queue',
    });
  }

  if (isDeepseekSignedOutPath(wc.getURL()) || !(await hasToken(wc))) {
    noteDeepseekSignedIn(false);
    await showLoginWindowIfNeeded(PROVIDER_LABELS.deepseek, DEEPSEEK_SIGN_IN_URL);
    throw new Error(`${DEEPSEEK_LOGIN_REQUIRED}: DeepSeek has no signed-in session`);
  }
  noteDeepseekSignedIn(true);

  // runAutomation validated the thread already; a reload here needs the same proof, or a thread
  // that just died (DeepSeek sends it to the home page) would take the prompt into a fresh chat.
  if (continuingThread && !reused && (await waitForThreadSettled(wc, targetUrl, PAGE_REUSE.deepseek)) === 'left') {
    throw new Error('DeepSeek conversation is no longer available');
  }

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToDeepseek(wc, attachments, UPLOAD_TIMEOUT_MS);
    for (const line of uploadLog) sendLog(`[deepseek-upload] ${line}`);
  }

  await dispatchFocusEvents(wc);

  let result: DeepseekReadResult;
  try {
    result = await executeAutomationWithTimeout<DeepseekReadResult>(
      wc,
      buildDeepseekAutomationScript(prompt, timeoutMs),
      timeoutMs,
      'DeepSeek',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes(DEEPSEEK_LEFT_CONVERSATION)) sendLog('⚠️ DeepSeek page moved to another conversation before the answer was read');
    throw err;
  }

  if (!result || typeof result.response !== 'string' || result.response.trim() === '') {
    throw new Error('DeepSeek returned empty response');
  }
  const answer = { response: result.response.trim(), title: (result.title || '').trim() };
  // Delete only a conversation this send opened. Follow-ups replay Yobi's local context.
  if (!continuingThread && !deepseekConversationId(targetUrl) && (await discardDeepseekConversation(wc))) {
    return { ...answer, discarded: true };
  }
  return answer;
}

function buildDeepseekAutomationScript(prompt: string, timeoutMs: number): string {
  return `
(async function deepseekAutomate() {
  var TIMEOUT = ${timeoutMs};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${DEEPSEEK_PAGE_HELPERS_JS}
  ${DEEPSEEK_SUBMIT_JS}
  ${DEEPSEEK_READ_JS}

  var submitted = await deepseekSubmit(${JSON.stringify(prompt)});
  return await deepseekWaitAndRead(submitted);
})()`;
}

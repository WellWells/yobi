import type { BrowserWindow, WebContents } from 'electron';
import { isCloudflareChallengeActive, sleep, INJECTED_SLEEP_JS, INJECTED_WAIT_FOR_JS, INJECTED_INTERCEPT_COPY_JS } from './common';
import { ensureOnPage, PAGE_REUSE, waitForThreadSettled } from './pageReuse';
import { executeAutomationWithTimeout, dispatchFocusEvents } from './automationExecutor';
import { sendLog } from '../helpers';
import { showInteractiveWorkerWindow, showLoginWindowIfNeeded } from '../windows';
import { raiseVerificationChallenge } from './verificationChallenge';
import { PROVIDER_LABELS, PROVIDER_URLS } from '../../shared/types';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { CLAUDE_INPUT_SELECTOR, CLAUDE_SUBMIT_JS } from './claudeSendScript';
import { CLAUDE_READ_JS, cleanClaudeTitle } from './claudeReadScript';
import { CLAUDE_FETCH_LEAF_JS, composeClaudeAnswer } from './claudeArtifacts';
import type { ClaudeLeafFetch } from './claudeArtifacts';
import { uploadFilesToClaude } from './claudeUpload';
import { syncClaudeModel } from './claudeModelSync';
import { CLAUDE_LOGIN_REQUIRED, CLAUDE_LOGIN_URL, isClaudeSessionCookie, isClaudeSignedOutPath } from './claudeSession';
import {
  CLAUDE_READ_USAGE_LIMIT_JS,
  claudeLimitBlocksSend,
  claudeUsageLimitError,
  formatResetTime,
  isClaudeUsageLimitError,
} from './claudeUsageLimit';
import type { ClaudeUsageLimitState } from './claudeUsageLimit';

const COMPOSER_WAIT_MS = 10_000;

interface ClaudeReadResult {
  response: string;
  title: string;
  hasToolOutput: boolean;
}

async function hasClaudeSession(wc: WebContents): Promise<boolean> {
  const cookies = await wc.session.cookies.get({ url: PROVIDER_URLS.claude });
  return cookies.some(isClaudeSessionCookie);
}

/** A fresh load hydrates for a moment before the composer exists; a signed-out one never grows it. */
async function waitForComposer(wc: WebContents): Promise<void> {
  const deadline = Date.now() + COMPOSER_WAIT_MS;
  while (Date.now() < deadline) {
    if (isClaudeSignedOutPath(wc.getURL())) return;
    try {
      const found = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(CLAUDE_INPUT_SELECTOR)})`, false);
      if (found) return;
    } catch {
    }
    await sleep(250);
  }
}

async function readUsageLimit(wc: WebContents): Promise<ClaudeUsageLimitState | null> {
  try {
    return (await wc.executeJavaScript(CLAUDE_READ_USAGE_LIMIT_JS, false)) as ClaudeUsageLimitState;
  } catch {
    return null;
  }
}

function usageLimitReached(state: Pick<ClaudeUsageLimitState, 'resetsAt' | 'noticeText'>): Error {
  const reset = state.resetsAt === null ? 'unknown' : formatResetTime(state.resetsAt);
  sendLog(`⛔ Claude usage limit reached — resets ${reset}`);
  return claudeUsageLimitError(state);
}

async function readTitle(wc: WebContents): Promise<string> {
  try {
    return String(await wc.executeJavaScript('document.title', false) ?? '');
  } catch {
    return '';
  }
}

/** Rebuilds a reply that published an artifact; the copied chat text stands when that fails. */
async function withArtifacts(wc: WebContents, copied: string): Promise<string> {
  try {
    const leaf = (await wc.executeJavaScript(CLAUDE_FETCH_LEAF_JS, false)) as ClaudeLeafFetch;
    if (!leaf.ok) {
      sendLog(`⚠️ Could not read the rest of Claude's answer (${leaf.reason}) — keeping the chat text`);
      return copied;
    }
    const composed = composeClaudeAnswer(leaf.content);
    if (!composed) return copied;
    sendLog('📄 Claude answered with an artifact — its full text is included');
    return composed;
  } catch (err) {
    sendLog(`⚠️ Could not read the rest of Claude's answer (${err instanceof Error ? err.message : String(err)}) — keeping the chat text`);
    return copied;
  }
}

export async function runClaudeAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs = 60_000,
  targetUrl: string = PROVIDER_URLS.claude,
  attachments?: string[],
  _wantTitle = false,
  continuingThread = false,
): Promise<{ response: string; title: string }> {
  const wc = workerWin.webContents;

  applyWorkerUserAgent(wc, WORKER_USER_AGENTS.claude);

  const landing = await ensureOnPage(wc, targetUrl, PAGE_REUSE.claude, { continuingThread });
  const reused = landing === 'reused';
  if (reused) sendLog('♻️ Claude page kept open — typing straight into it, no reload');
  else await waitForComposer(wc);

  if (await isCloudflareChallengeActive(wc)) {
    await showInteractiveWorkerWindow(targetUrl);
    throw raiseVerificationChallenge({
      titleKey: 'cloudflare.notify.title',
      bodyKey: 'cloudflare.notify.body',
      actionKey: 'cloudflare.notify.action.openWorker',
      errorKey: 'cloudflare.error.verificationFailed',
      logMessage: '⚠️ Cloudflare security check detected on Claude — task marked as FAILED and removed from queue',
    });
  }

  if (isClaudeSignedOutPath(wc.getURL()) || !(await hasClaudeSession(wc))) {
    await showLoginWindowIfNeeded(PROVIDER_LABELS.claude, CLAUDE_LOGIN_URL);
    throw new Error(`${CLAUDE_LOGIN_REQUIRED}: Claude has no signed-in session`);
  }

  // runAutomation validated the thread already; a reload here needs the same proof, or a thread
  // that just died would take the prompt into a fresh chat with none of its history.
  if (continuingThread && !reused && (await waitForThreadSettled(wc, targetUrl, PAGE_REUSE.claude)) === 'left') {
    throw new Error('Claude conversation is no longer available');
  }

  const limit = await readUsageLimit(wc);
  if (limit && claudeLimitBlocksSend(limit)) throw usageLimitReached(limit);

  await syncClaudeModel(wc);

  if (attachments && attachments.length > 0) {
    const uploadLog = await uploadFilesToClaude(wc, attachments, 120_000);
    for (const line of uploadLog) sendLog(`[claude-upload] ${line}`);
  }

  await dispatchFocusEvents(wc);

  // A new chat shows a placeholder title ("New chat", localized) until Claude names it.
  const placeholder = continuingThread ? '' : await readTitle(wc);

  let result: ClaudeReadResult;
  try {
    result = await executeAutomationWithTimeout<ClaudeReadResult>(
      wc,
      buildClaudeAutomationScript(prompt, timeoutMs),
      timeoutMs,
      'Claude',
    );
  } catch (err) {
    if (!isClaudeUsageLimitError(err)) throw err;
    throw usageLimitReached(await readUsageLimit(wc) ?? { resetsAt: null, noticeText: '' });
  }

  if (!result || typeof result.response !== 'string' || result.response.trim() === '') {
    throw new Error('Claude returned empty response');
  }

  const copied = result.response.trim();
  const response = result.hasToolOutput ? await withArtifacts(wc, copied) : copied;
  return { response, title: cleanClaudeTitle(result.title, placeholder) };
}

function buildClaudeAutomationScript(prompt: string, timeoutMs: number): string {
  return `
(async function claudeAutomate() {
  var TIMEOUT = ${timeoutMs};
  ${INJECTED_SLEEP_JS}
  ${INJECTED_WAIT_FOR_JS}
  ${INJECTED_INTERCEPT_COPY_JS}
  ${CLAUDE_SUBMIT_JS}
  ${CLAUDE_READ_JS}

  var submitted = await claudeSubmit(${JSON.stringify(prompt)});
  return await claudeWaitAndRead(submitted, { timeoutMs: TIMEOUT });
})()`;
}

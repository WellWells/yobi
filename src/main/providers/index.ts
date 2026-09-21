import type { BrowserWindow } from 'electron';
import { runGeminiAutomation } from './gemini';
import { isPerplexityLoginRequiredError, runPerplexityAutomation } from './perplexity';
import { isChatgptLoginRequiredError, runChatgptAutomation } from './chatgpt';
import { runClaudeAutomation } from './claude';
import { isClaudeLoginRequiredError } from './claudeSession';
import { getByokLabel } from './byokClient';
import { ensureOnPage, isSamePage, PAGE_REUSE, pageIdentity, parseHttpUrl, waitForThreadSettled } from './pageReuse';
import { meterText } from '../tokenMeter';
import { meterLlmRequest } from '../llmMeter';
import { PROVIDER_LABELS, isByokTargetUrl, migrateRemovedTargetUrl, providerFromUrl } from '../../shared/types';
import type { Provider } from '../../shared/types';
import { utf8Len, truncateToBytes, charsPlusBreaks, truncateToCharsPlusBreaks } from '../../shared/textBudget';

export type { Provider };

const PROVIDER_RUNNER: Record<
  Provider,
  (
    workerWin: BrowserWindow,
    prompt: string,
    timeoutMs: number,
    targetUrl: string,
    attachments?: string[],
    wantTitle?: boolean,
    continuingThread?: boolean,
  ) => Promise<{ response: string; title: string }>
> = {
  gemini: runGeminiAutomation,
  perplexity: runPerplexityAutomation,
  chatgpt: runChatgptAutomation,
  claude: runClaudeAutomation,
};

export interface ProviderPromptPolicy {
  maxBytes: number | null;
  maxCharsPlusBreaks: number | null;
}

export const PROVIDER_PROMPT_POLICIES: Record<Provider, ProviderPromptPolicy> = {
  chatgpt: { maxBytes: 65_535, maxCharsPlusBreaks: null },
  claude: { maxBytes: 100_000, maxCharsPlusBreaks: null },
  perplexity: { maxBytes: 40_000, maxCharsPlusBreaks: null },
  gemini: { maxBytes: null, maxCharsPlusBreaks: 33_499 },
};

export interface PreparedPromptInfo {
  provider: Provider;
  prompt: string;
  originalLength: number;
  finalLength: number;
  capLabel: string | null;
  removedBlankLines: boolean;
  truncated: boolean;
}

function removeBlankLines(input: string): { text: string; removed: boolean } {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const filtered = lines.filter((line) => line.trim().length > 0);
  return {
    text: filtered.join('\n'),
    removed: filtered.length !== lines.length,
  };
}

export function detectProvider(url: string): Provider {
  return providerFromUrl(url);
}

export function getProviderLabel(url: string): string {
  if (isByokTargetUrl(url)) return getByokLabel(url);
  return PROVIDER_LABELS[detectProvider(url)];
}

export function preparePromptForProvider(prompt: string, targetUrl: string): PreparedPromptInfo {
  const provider = detectProvider(targetUrl);
  const policy = PROVIDER_PROMPT_POLICIES[provider];
  const originalLength = prompt.length;

  const removed = removeBlankLines(prompt);
  let nextPrompt = removed.text;
  const removedBlankLines = removed.removed;

  let truncated = false;
  let capLabel: string | null = null;
  if (typeof policy.maxBytes === 'number' && policy.maxBytes > 0 && utf8Len(nextPrompt) > policy.maxBytes) {
    nextPrompt = truncateToBytes(nextPrompt, policy.maxBytes);
    truncated = true;
    capLabel = `${policy.maxBytes} bytes`;
  }
  if (
    typeof policy.maxCharsPlusBreaks === 'number' && policy.maxCharsPlusBreaks > 0
    && charsPlusBreaks(nextPrompt) > policy.maxCharsPlusBreaks
  ) {
    nextPrompt = truncateToCharsPlusBreaks(nextPrompt, policy.maxCharsPlusBreaks);
    truncated = true;
    capLabel = `${policy.maxCharsPlusBreaks} chars+line-breaks`;
  }

  return {
    provider,
    prompt: nextPrompt,
    originalLength,
    finalLength: nextPrompt.length,
    capLabel,
    removedBlankLines,
    truncated,
  };
}

const THREAD_PATH_PATTERNS: Record<Provider, RegExp> = {
  gemini: /^\/app\/[^/]+\/?$/,
  chatgpt: /^\/c\/[^/]+\/?$/,
  claude: /^\/chat\/[^/]+\/?$/,
  perplexity: /^\/search\/[^/]+\/?$/,
};

export function extractThreadUrl(provider: Provider, url: string): string | null {
  const pattern = THREAD_PATH_PATTERNS[provider];
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  if (detectProvider(parsed.href) !== provider) return null;
  if (!pattern.test(parsed.pathname)) return null;
  return pageIdentity(parsed);
}

/** A thread is one page, so telling two threads apart is telling two pages apart. */
export function isSameThread(a: string, b: string): boolean {
  return isSamePage(a, b);
}

export interface AutomationResult {
  response: string;
  title: string;
  threadUrl: string | null;
  threadLost?: true;
}

function currentUrl(workerWin: BrowserWindow): string {
  try {
    return workerWin.isDestroyed() ? '' : workerWin.webContents.getURL();
  } catch {
    return '';
  }
}

export async function runAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs: number,
  targetUrl: string,
  attachments?: string[],
  expectThreadUrl?: string,
  wantTitle = false,
): Promise<AutomationResult> {
  if (isByokTargetUrl(targetUrl)) {
    throw new Error('BYOK targets must not reach browser automation');
  }
  const provider = detectProvider(targetUrl);

  if (expectThreadUrl) {
    try {
      // Reuse rather than reload when the worker is still parked on the thread: the runner
      // asks for the very same page next, and that ask is then free as well.
      await ensureOnPage(
        workerWin.webContents, expectThreadUrl, PAGE_REUSE[provider], { continuingThread: true },
      );
    } catch {
      return { response: '', title: '', threadUrl: null, threadLost: true };
    }
    if (!isSameThread(currentUrl(workerWin), expectThreadUrl)) {
      return { response: '', title: '', threadUrl: null, threadLost: true };
    }
    // Still on the thread at `load` is not proof for every provider: Claude shows a dead thread's
    // shell first and leaves for its landing page a moment later.
    if ((await waitForThreadSettled(workerWin.webContents, expectThreadUrl, PAGE_REUSE[provider])) === 'left') {
      return { response: '', title: '', threadUrl: null, threadLost: true };
    }
  }

  const navigationTarget = expectThreadUrl ?? migrateRemovedTargetUrl(targetUrl);
  // Only the send itself is a model request; a lost thread never reached the provider.
  const result = await meterLlmRequest(() => PROVIDER_RUNNER[provider](
    workerWin, prompt, timeoutMs, navigationTarget, attachments, wantTitle, Boolean(expectThreadUrl),
  ));
  meterText(prompt, result.response);
  return { ...result, threadUrl: extractThreadUrl(provider, currentUrl(workerWin)) };
}

export function isLoginRequiredError(targetUrl: string, err: unknown): boolean {
  const provider = detectProvider(targetUrl);
  if (provider === 'chatgpt') {
    return isChatgptLoginRequiredError(err);
  }
  if (provider === 'claude') {
    return isClaudeLoginRequiredError(err);
  }
  if (provider === 'gemini') {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return msg.includes('GEMINI_LOGIN_REQUIRED');
  }
  if (provider === 'perplexity') {
    return isPerplexityLoginRequiredError(err);
  }
  return false;
}

import type { BrowserWindow } from 'electron';
import { runGeminiAutomation } from './gemini';
import { isPerplexityLoginRequiredError, runPerplexityAutomation } from './perplexity';
import { isChatgptLoginRequiredError, runChatgptAutomation } from './chatgpt';
import { runDuckaiAutomation } from './duckai';
import { getByokLabel } from './byokClient';
import { navigateAndWait } from './common';
import { meterText } from '../tokenMeter';
import { PROVIDER_LABELS, isByokTargetUrl } from '../../shared/types';
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
    /**
     * The caller navigated to an existing thread to continue it, so the page's own history
     * is the point of the run. Only the caller can know this — the page looks the same as a
     * reused window that reloaded a stale conversation.
     */
    continuingThread?: boolean,
  ) => Promise<{ response: string; title: string }>
> = {
  gemini: runGeminiAutomation,
  perplexity: runPerplexityAutomation,
  chatgpt: runChatgptAutomation,
  duckai: runDuckaiAutomation,
};

export interface ProviderPromptPolicy {
  maxBytes: number | null;
  maxCharsPlusBreaks: number | null;
}

export const PROVIDER_PROMPT_POLICIES: Record<Provider, ProviderPromptPolicy> = {
  chatgpt: { maxBytes: 65_535, maxCharsPlusBreaks: null },
  perplexity: { maxBytes: 40_000, maxCharsPlusBreaks: null },
  gemini: { maxBytes: null, maxCharsPlusBreaks: 33_499 },
  duckai: { maxBytes: 12_000, maxCharsPlusBreaks: null },
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
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('perplexity.ai')) return 'perplexity';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('duck.ai')) return 'duckai';
  } catch {
  }
  return 'gemini';
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

const THREAD_PATH_PATTERNS: Record<Provider, RegExp | null> = {
  gemini: /^\/app\/[^/]+\/?$/,
  chatgpt: /^\/c\/[^/]+\/?$/,
  perplexity: /^\/search\/[^/]+\/?$/,
  duckai: null,
};

function parseUrlOrNull(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function threadIdentity(parsed: URL): string {
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

export function extractThreadUrl(provider: Provider, url: string): string | null {
  const pattern = THREAD_PATH_PATTERNS[provider];
  if (!pattern) return null;
  const parsed = parseUrlOrNull(url);
  if (!parsed) return null;
  if (detectProvider(parsed.href) !== provider) return null;
  if (!pattern.test(parsed.pathname)) return null;
  return threadIdentity(parsed);
}

export function isSameThread(a: string, b: string): boolean {
  const left = parseUrlOrNull(a);
  const right = parseUrlOrNull(b);
  if (!left || !right) return false;
  return threadIdentity(left) === threadIdentity(right);
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
      await navigateAndWait(workerWin.webContents, expectThreadUrl);
    } catch {
      return { response: '', title: '', threadUrl: null, threadLost: true };
    }
    if (!isSameThread(currentUrl(workerWin), expectThreadUrl)) {
      return { response: '', title: '', threadUrl: null, threadLost: true };
    }
  }

  const navigationTarget = expectThreadUrl ?? targetUrl;
  const result = await PROVIDER_RUNNER[provider](
    workerWin, prompt, timeoutMs, navigationTarget, attachments, wantTitle, Boolean(expectThreadUrl),
  );
  meterText(prompt, result.response);
  return { ...result, threadUrl: extractThreadUrl(provider, currentUrl(workerWin)) };
}

export function isLoginRequiredError(targetUrl: string, err: unknown): boolean {
  const provider = detectProvider(targetUrl);
  if (provider === 'chatgpt') {
    return isChatgptLoginRequiredError(err);
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

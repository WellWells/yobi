import type { BrowserWindow } from 'electron';
import { runGeminiAutomation } from './gemini';
import { runPerplexityAutomation } from './perplexity';
import { CHATGPT_LOGIN_URL, isChatgptLoginRequiredError, runChatgptAutomation } from './chatgpt';
import { runDuckaiAutomation } from './duckai';
import { PROVIDER_LABELS } from '../../shared/types';
import type { Provider } from '../../shared/types';

export type { Provider };

const PROVIDER_RUNNER: Record<
  Provider,
  (workerWin: BrowserWindow, prompt: string, timeoutMs: number, targetUrl: string, attachments?: string[]) => Promise<{ response: string; title: string }>
> = {
  gemini: runGeminiAutomation,
  perplexity: runPerplexityAutomation,
  chatgpt: runChatgptAutomation,
  duckai: runDuckaiAutomation,
};

interface ProviderPromptPolicy {
  maxChars: number | null;
}

const PROVIDER_PROMPT_POLICIES: Record<Provider, ProviderPromptPolicy> = {
  chatgpt: { maxChars: 65_535 },
  perplexity: { maxChars: 40_000 },
  gemini: { maxChars: 200_000 },
  duckai: { maxChars: 16_000 },
};

export interface PreparedPromptInfo {
  provider: Provider;
  prompt: string;
  originalLength: number;
  finalLength: number;
  maxChars: number | null;
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
  if (typeof policy.maxChars === 'number' && policy.maxChars > 0 && nextPrompt.length > policy.maxChars) {
    nextPrompt = nextPrompt.slice(0, policy.maxChars);
    truncated = true;
  }

  return {
    provider,
    prompt: nextPrompt,
    originalLength,
    finalLength: nextPrompt.length,
    maxChars: policy.maxChars,
    removedBlankLines,
    truncated,
  };
}

export async function runAutomation(
  workerWin: BrowserWindow,
  prompt: string,
  timeoutMs: number,
  targetUrl: string,
  attachments?: string[],
): Promise<{ response: string; title: string }> {
  const provider = detectProvider(targetUrl);
  return PROVIDER_RUNNER[provider](workerWin, prompt, timeoutMs, targetUrl, attachments);
}

export function isLoginRequiredError(targetUrl: string, err: unknown): boolean {
  const provider = detectProvider(targetUrl);
  if (provider === 'chatgpt') {
    return isChatgptLoginRequiredError(err);
  }
  return false;
}

export function getProviderLoginUrl(targetUrl: string): string | null {
  const provider = detectProvider(targetUrl);
  if (provider === 'chatgpt') return CHATGPT_LOGIN_URL;
  return null;
}

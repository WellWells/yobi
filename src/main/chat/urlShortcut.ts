import { config } from '../config';
import { executeSkill } from '../flow/skills';
import { resolveStepTimeoutMs } from '../flow/runtime';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog, sendWebNotification } from '../helpers';
import { isSingleUrl, resolveUrlPrompt } from '../urlParser';

const URL_SHORTCUT_STEP_ID = 'url-shortcut';

export interface UrlShortcutOutcome {
  answer: string;
  title?: string;
  providerUrl: string;
}

export async function runUrlShortcut(
  input: string,
  targetUrl: string,
  deps: FlowExecutorDeps,
  strings: Record<string, string>,
  signal?: AbortSignal,
): Promise<UrlShortcutOutcome | null> {
  const text = input.trim();
  if (!isSingleUrl(text)) return null;

  const resolved = await resolveUrlPrompt(text, {
    langData: strings,
    youtubePrompt: config.youtubePrompt,
    onLog: sendLog,
    onNotify: (title, body) => sendWebNotification(title, body, 'info'),
  });

  if (resolved.prompt.trim() === text) return null;

  const providerUrl = resolved.forceProviderUrl ?? targetUrl;
  const timeoutMs = resolveStepTimeoutMs('llm', deps);
  const answer = await executeSkill(
    'llm',
    URL_SHORTCUT_STEP_ID,
    { prompt: resolved.prompt, provider: providerUrl },
    deps,
    timeoutMs,
    signal,
  );

  return { answer, title: resolved.title, providerUrl };
}

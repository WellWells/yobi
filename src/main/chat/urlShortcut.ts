import { config } from '../config';
import { executeSkill } from '../flow/skills';
import { resolveStepTimeoutMs } from '../flow/runtime';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog } from '../helpers';
import { buildTaskInstruction } from '../i18n';
import { isSingleUrl, resolveUrlPrompt } from '../urlParser';
import { splitMapsQuestion } from '../mapQuestion';

const URL_SHORTCUT_STEP_ID = 'url-shortcut';

export interface UrlShortcutOutcome {
  answer: string;
  title?: string;
  providerUrl: string;
}

export interface UrlShortcutOptions {
  /** Also take a Maps link with a question around it; only for callers whose words cannot be a task. */
  mapQuestions?: boolean;
  /** The "AI responses" settings, sent ahead of the prompt the way a chat send carries them. */
  instruction?: string;
}

function withInstruction(prompt: string, instruction: string | undefined): string {
  const block = buildTaskInstruction(instruction ?? '', false, '');
  return block ? `${block}\n\n${prompt}` : prompt;
}

export async function runUrlShortcut(
  input: string,
  targetUrl: string,
  deps: FlowExecutorDeps,
  strings: Record<string, string>,
  signal?: AbortSignal,
  options: UrlShortcutOptions = {},
): Promise<UrlShortcutOutcome | null> {
  const text = input.trim();
  const mapQuestion = options.mapQuestions === true && splitMapsQuestion(text) !== null;
  if (!isSingleUrl(text) && !mapQuestion) return null;

  const resolved = await resolveUrlPrompt(text, {
    langData: strings,
    youtubePrompt: config.youtubePrompt,
    targetUrl,
    onLog: sendLog,
  });

  if (resolved.prompt.trim() === text) return null;

  const providerUrl = resolved.forceProviderUrl ?? targetUrl;
  const timeoutMs = resolveStepTimeoutMs('llm', deps);
  const answer = await executeSkill(
    'llm',
    URL_SHORTCUT_STEP_ID,
    { prompt: withInstruction(resolved.prompt, options.instruction), provider: providerUrl },
    deps,
    timeoutMs,
    signal,
  );

  return { answer, title: resolved.title, providerUrl };
}

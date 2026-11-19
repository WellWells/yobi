import { providerAttachmentCapacity } from '../botChat/attachmentPlan';
import { deleteTempAttachments } from '../botChat/mediaTemp';
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
  /** A bare Agoda hotel link is its reviews, as in the desktop chat; the agent's `agoda_reviews` takes one with a question. */
  hotelReviews?: boolean;
  /** The "AI responses" settings, sent ahead of the prompt the way a chat send carries them. */
  instruction?: string;
  /** A provider command names the target for this request. */
  preserveTarget?: boolean;
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
    ...(options.preserveTarget ? { preserveTarget: true } : {}),
    onLog: sendLog,
    ...(signal ? { signal } : {}),
    ...(options.hotelReviews ? { hotelReviews: true } : {}),
    ...(providerAttachmentCapacity(targetUrl) > 0 ? { pictures: true } : {}),
  });

  if (resolved.prompt.trim() === text) return null;

  const providerUrl = resolved.forceProviderUrl ?? targetUrl;
  const timeoutMs = resolveStepTimeoutMs('llm', deps);
  const { picture } = resolved;
  try {
    const answer = await executeSkill(
      'llm',
      URL_SHORTCUT_STEP_ID,
      {
        prompt: withInstruction(resolved.prompt, options.instruction),
        provider: providerUrl,
        // The picture a picture link was: a file this send made, allowed as such.
        ...(picture ? { attachments: picture, __attachmentAllowlist: JSON.stringify([picture]) } : {}),
      },
      deps,
      timeoutMs,
      signal,
    );
    return { answer, title: resolved.title, providerUrl };
  } finally {
    if (picture) await deleteTempAttachments([picture]);
  }
}

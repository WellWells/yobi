import type { SkillInstance } from '../../shared/types';
import { parseBotPlatform } from '../../shared/types';
import { escapeRegExp } from '../../shared/regex';
import {
  formatResponseForTelegramHtml,
  TELEGRAM_CAPTION_LIMIT,
  telegramVisibleLength,
} from '../telegram/formatter';
import { interpolate } from './interpolation';

/**
 * An AI step whose answer goes out as a Telegram caption is told how long it may be, so the model
 * writes for the space rather than having its end cut off (a subscription summary of 1,500-3,600
 * characters under a video cover lost everything past 1,024). The budget is decided per run: the
 * same flow sends a cover with one video and none with the next, and only the run with a picture
 * has a caption limit; a text message is split into several and needs none.
 */

/** Hidden config key carrying the budget from the executor to the AI step. */
export const CAPTION_BUDGET_KEY = '__captionBudget';

/** What the model is asked to stay under, of the space it has: models overshoot a stated count. */
const MODEL_TARGET_SHARE = 0.85;

/** No budget below this: a caption with room for a line or two of text is not worth limiting to. */
const MIN_BUDGET = 120;

/** The blank line a message template puts between its own text and the answer. */
const JOIN_CHARS = 2;

const VARIABLE = /\{\{\s*([^}]+?)\s*\}\}/g;

function refersTo(template: string, outputKey: string): boolean {
  return new RegExp(`\\{\\{\\s*${escapeRegExp(outputKey)}(?:\\.text)?\\s*\\}\\}`).test(template);
}

/** Whether `name` is the output, or a field of the output, of one of `keys`. */
function isOutputOf(name: string, keys: ReadonlySet<string>): boolean {
  const dot = name.indexOf('.');
  return keys.has(name) || (dot > 0 && keys.has(name.slice(0, dot)));
}

function sendsToTelegram(step: SkillInstance, context: Map<string, string>): boolean {
  const platform = parseBotPlatform(step.config.platform) ?? parseBotPlatform(context.get('bot.triggerPlatform')) ?? 'telegram';
  return platform === 'telegram';
}

/**
 * Whether the bot step sends, this run, a file that is not the answer itself (a video's cover, a
 * post's photo). A file a step not yet run this pass makes (the AI step's own export, a `share` or
 * a capture of the answer) holds the whole answer, so its caption is only the opening and needs
 * no shorter answer: the caption cut alone is right there.
 */
function hasOtherFile(template: string, pending: ReadonlySet<string>, context: Map<string, string>): boolean {
  if (!template.trim()) return false;
  const names = [...template.matchAll(VARIABLE)].map((match) => match[1]);
  if (names.some((name) => isOutputOf(name, pending))) return false;
  return interpolate(template, context).trim() !== '';
}

/** The visible length of the bot step's message once the answer itself is taken out. */
function framingLength(template: string, outputKey: string, pending: ReadonlySet<string>, context: Map<string, string>): number {
  const withoutAnswer = template.replace(VARIABLE, (whole: string, name: string) => (
    name === outputKey || name === `${outputKey}.text` || isOutputOf(name, pending) ? '' : whole
  ));
  const framing = interpolate(withoutAnswer, context).trim();
  return framing ? telegramVisibleLength(formatResponseForTelegramHtml(framing)) + JOIN_CHARS : 0;
}

/**
 * The characters the AI step at `index` may write this run, or 0 for no limit: the room a Telegram
 * caption leaves in the first later bot step that sends this step's answer with a file.
 */
export function captionBudgetFor(steps: readonly SkillInstance[], index: number, context: Map<string, string>): number {
  const outputKey = steps[index]?.outputKey;
  if (!outputKey) return 0;
  const pending = new Set(steps.slice(index).map((step) => step.outputKey).filter(Boolean));
  for (const step of steps.slice(index + 1)) {
    if (step.type !== 'bot') continue;
    const message = step.config.message ?? '';
    if (!refersTo(message, outputKey) || !sendsToTelegram(step, context)) continue;
    if (!hasOtherFile(step.config.attachment ?? '', pending, context)) return 0;
    const room = TELEGRAM_CAPTION_LIMIT - framingLength(message, outputKey, pending, context);
    return Math.max(MIN_BUDGET, Math.floor(room * MODEL_TARGET_SHARE));
  }
  return 0;
}

/**
 * The prompt with the length limit ahead of it. Ahead, not after: a browser provider's input cap
 * cuts a long prompt from its end, and a transcript usually fills that end.
 */
export function withCaptionBudget(prompt: string, budget: number): string {
  if (!(budget > 0)) return prompt;
  return `LENGTH LIMIT (critical):
- The reply is posted as an image caption that holds only a little text. Keep the whole reply under ${budget} characters, counting every letter, space, emoji, hashtag and line break; anything past that is cut off.
- Fit the content to that length: keep the main points, drop detail, and finish the last sentence rather than run over.
- Every other instruction below still applies within this length.

${prompt}`;
}

import { fenceUntrusted } from '../../shared/promptFencing';
import { promptLanguageName, type TranslateLanguage } from '../../shared/translateLanguages';
import { TRANSLATE_FENCE_RULE, TRANSLATE_FIDELITY_RULES, TRANSLATE_REPLY_RULES } from '../../shared/translate';
import { PARAGRAPH_RULE, markParagraphs } from './oneShot';

export const TAG_SOURCE = 'source';

const RULES = [
  'OUTPUT RULES (critical):',
  ...TRANSLATE_REPLY_RULES,
  '- Each placeholder such as {{1}} stands for code, a formula or a web address. Copy every placeholder exactly once and unchanged, where it belongs in the translated sentence. Never translate, drop, repeat or invent one.',
  ...TRANSLATE_FIDELITY_RULES,
].join('\n');

const FENCE_RULE = TRANSLATE_FENCE_RULE;

export interface TranslatePromptOptions {
  /** Keep paragraph breaks through a browser provider, whose prompts lose their blank lines. */
  markParagraphs?: boolean;
  /** The placeholder line dividing a question from its answer, when both go in one request. */
  separator?: number;
}

/**
 * The prompt for one translation: the rules, the text fenced as material (an answer may hold text
 * that reads like an instruction), and the task last. `text` is already masked: code, formulas
 * and addresses are `{{n}}` placeholders.
 */
export function buildTranslatePrompt(text: string, to: TranslateLanguage, options: TranslatePromptOptions = {}): string {
  const { markParagraphs: markBreaks = false, separator } = options;
  const language = promptLanguageName(to);
  const extra = [
    ...(separator !== undefined
      ? [`- The text is a question, then a line holding only {{${separator}}}, then the answer to it. Keep that line exactly where it is and translate both parts; do not answer the question.`]
      : []),
    ...(markBreaks ? [PARAGRAPH_RULE] : []),
  ];
  return [
    `You translate text into ${language} for the user to read. The text comes from an earlier conversation with an AI.`,
    '',
    [RULES, ...extra, FENCE_RULE].join('\n'),
    '',
    'THE TEXT TO TRANSLATE:',
    fenceUntrusted(TAG_SOURCE, markParagraphs(text, markBreaks)),
    '',
    // The task stays the very last line.
    `TASK: Translate the text inside <${TAG_SOURCE}> into ${language}. Reply with the translation only.`,
  ].join('\n');
}

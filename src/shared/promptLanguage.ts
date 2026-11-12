import { fillTemplate } from './fillTemplate';
import { LOCALE_LANGUAGE_NAMES } from './localeLanguage';

export function responseLanguage(locale: string): string {
  return `${LOCALE_LANGUAGE_NAMES[locale] ?? locale} [${locale}]`;
}

/** The response-language line the built-in video and Maps templates carry. */
export const LANGUAGE_PLACEHOLDER_LINE = 'Write the entire response in {{language}}.';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Built-in templates used to spell the language out ("Write the entire response in English
// [en-US]."), so a saved copy kept answering in the language of the day it was saved.
const SPELLED_OUT_LANGUAGE_LINE = new RegExp(
  `Write the entire response in (?:${Object.entries(LOCALE_LANGUAGE_NAMES)
    .map(([locale, name]) => `${escapeRegExp(name)} \\[${escapeRegExp(locale)}\\]`)
    .join('|')})\\.`,
  'g',
);

/** A template with any spelled-out built-in language line turned back into the placeholder. */
export function withLanguagePlaceholder(template: string): string {
  return template.replace(SPELLED_OUT_LANGUAGE_LINE, LANGUAGE_PLACEHOLDER_LINE);
}

/** Resolve the output language at execution time while leaving video and review slots intact. */
export function withPromptLanguage(template: string, locale: string): string {
  return fillTemplate(withLanguagePlaceholder(template), { language: responseLanguage(locale) });
}

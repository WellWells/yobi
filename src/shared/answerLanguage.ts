import { languageForLocale } from './localeLanguage';
import { dominantScript, languageScript, uiTargetLanguage } from './translateLanguages';
import type { Script } from './translateLanguages';

/*
 * The answer is written in the asker's language, whatever language the search ran in: searching a
 * Japanese rental company in Japanese finds the right pages, but a question asked in Chinese is
 * answered in Chinese (Japanese keywords and sources can outweigh a single "write in Traditional
 * Chinese" line).
 */

/** Named so a model cannot pick the other Chinese script, or a neighbouring language. */
const SCRIPT_LANGUAGES: Partial<Record<Script, string>> = {
  han: 'Chinese, in the same characters (Traditional or Simplified) as the question',
  kana: 'Japanese',
  hangul: 'Korean',
};

/**
 * Japanese prose is held together by hiragana (particles, verb endings), so it runs to a third or
 * more of the CJK characters. A Chinese answer about Japan quotes katakana names and the odd
 * hiragana one ("よってって"), which `dominantScript` already counts as Japanese at a twentieth.
 */
const JAPANESE_HIRAGANA_SHARE = 0.15;

function hiraganaShare(text: string): number {
  let hiragana = 0;
  let cjk = 0;
  for (const char of text) {
    if (/\p{Script=Hiragana}/u.test(char)) hiragana += 1;
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) cjk += 1;
  }
  return cjk === 0 ? 0 : hiragana / cjk;
}

/** The script the text is written in, with Chinese that quotes Japanese names still Chinese. */
function writtenScript(text: string, minUnits?: number): Script | null {
  const script = dominantScript(text, minUnits);
  if (script === 'kana' && hiraganaShare(text) < JAPANESE_HIRAGANA_SHARE) return 'han';
  return script;
}

/** The script the asker wrote in; the UI language's when their words are too mixed to tell. */
function askedScript(words: string, locale: string): Script {
  return writtenScript(words, 0) ?? languageScript(uiTargetLanguage(locale));
}

/**
 * Appended to "write in <the UI language>" when the "reply in the UI language" switch is on: the
 * switch sets the default, and the asker's own "rewrite it in Japanese" still wins.
 */
export const UNLESS_ASKED_OTHERWISE = ', unless the question itself asks for another language';

/**
 * The language to answer `words` in, named for a prompt. With the "reply in the UI language" switch
 * on (`uiLanguage`) it is always the UI language: a Chinese request around a pasted Japanese article
 * is mostly Japanese by count, and only the request's words were the user's. Otherwise
 * the UI language when the asker wrote in its script (so Chinese stays Traditional for a zh-TW user),
 * else the language their script shows. An alphabet does not tell English from French, so a Latin
 * question under a Chinese UI is answered in "the language the question is written in".
 */
export function answerLanguageFor(words: string, locale: string, uiLanguage = false): string {
  if (uiLanguage) return languageForLocale(locale);
  const script = askedScript(words, locale);
  if (script === languageScript(uiTargetLanguage(locale))) return languageForLocale(locale);
  return SCRIPT_LANGUAGES[script] ?? 'the language the question is written in';
}

/**
 * The answer is plainly in another language than the one it should be in — a Japanese answer to a
 * Chinese question, or with `uiLanguage` any answer outside the UI language's script. False when the
 * answer is too short or too mixed to tell.
 */
export function answeredInAnotherLanguage(answer: string, words: string, locale: string, uiLanguage = false): boolean {
  const written = writtenScript(answer);
  if (written === null) return false;
  return written !== (uiLanguage ? languageScript(uiTargetLanguage(locale)) : askedScript(words, locale));
}

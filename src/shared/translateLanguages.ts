import { maskTranslation } from './translateMask';

/**
 * The languages translation offers, as BCP-47 tags. Chinese is two targets, told apart by the
 * region its writing follows; display names come from `Intl.DisplayNames`, so no language needs
 * three locale strings of its own.
 */
export const TRANSLATE_LANGUAGES = [
  'zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'vi', 'th', 'id', 'ar', 'hi',
  'nl', 'pl', 'tr', 'uk', 'sv', 'da', 'fi', 'no', 'cs', 'el', 'he', 'hu', 'ro', 'ms', 'fa',
] as const;

export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

export function isTranslateLanguage(value: unknown): value is TranslateLanguage {
  return typeof value === 'string' && (TRANSLATE_LANGUAGES as readonly string[]).includes(value);
}

/** How the target is named to the model: "Chinese" alone would let it pick either script. */
const PROMPT_NAMES: Partial<Record<TranslateLanguage, string>> = {
  'zh-TW': 'Traditional Chinese as used in Taiwan',
  'zh-CN': 'Simplified Chinese as used in mainland China',
  en: 'English',
};

/** The target language's full English name, for the prompt. */
export function promptLanguageName(tag: TranslateLanguage): string {
  const fixed = PROMPT_NAMES[tag];
  if (fixed) return fixed;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Chinese targets are named by script ("Traditional Chinese"), not by region ("Chinese (Taiwan)"). */
const DISPLAY_TAGS: Partial<Record<TranslateLanguage, string>> = { 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans' };

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

/** One `Intl.DisplayNames` per locale: the language menu names every language on each keystroke. */
function displayNamesFor(locale: string): Intl.DisplayNames | null {
  const cached = displayNamesCache.get(locale);
  if (cached !== undefined) return cached;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
  } catch {
    names = null;
  }
  displayNamesCache.set(locale, names);
  return names;
}

/** The language's name in the UI language. */
export function languageDisplayName(tag: TranslateLanguage, uiLocale: string): string {
  try {
    return displayNamesFor(uiLocale)?.of(DISPLAY_TAGS[tag] ?? tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The language's name in itself ("Deutsch" for German), so a reader can find it by that name too. */
function languageAutonym(tag: TranslateLanguage): string {
  const displayTag = DISPLAY_TAGS[tag] ?? tag;
  try {
    return displayNamesFor(displayTag)?.of(displayTag) ?? tag;
  } catch {
    return tag;
  }
}

/** UI locales whose primary subtag is not the target's tag (Norwegian Bokmål, the old Hebrew code). */
const UI_ALIASES: Readonly<Record<string, TranslateLanguage>> = { nb: 'no', nn: 'no', iw: 'he', in: 'id' };

/** The target that is the UI language. A UI language translation does not offer falls back to English. */
export function uiTargetLanguage(uiLocale: string): TranslateLanguage {
  const lower = uiLocale.toLowerCase();
  if (/^zh-(?:tw|hk|mo|hant)/.test(lower)) return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh-CN';
  const primary = lower.split('-')[0];
  if (isTranslateLanguage(primary)) return primary;
  return UI_ALIASES[primary] ?? 'en';
}

export type Script = 'han' | 'kana' | 'hangul' | 'latin' | 'cyrillic' | 'arabic' | 'thai' | 'devanagari' | 'greek' | 'hebrew';

const SCRIPT_PATTERNS: ReadonlyArray<[Script, RegExp, number]> = [
  // A CJK character is counted as a word; letters of an alphabet are, roughly, a fifth of one.
  ['han', /\p{Script=Han}/u, 1],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u, 1],
  ['hangul', /\p{Script=Hangul}/u, 0.5],
  ['latin', /\p{Script=Latin}/u, 0.2],
  ['cyrillic', /\p{Script=Cyrillic}/u, 0.2],
  ['arabic', /\p{Script=Arabic}/u, 0.2],
  ['thai', /\p{Script=Thai}/u, 0.3],
  ['devanagari', /\p{Script=Devanagari}/u, 0.2],
  ['greek', /\p{Script=Greek}/u, 0.2],
  ['hebrew', /\p{Script=Hebrew}/u, 0.2],
];

/** Less than this many words is too little to tell what language an answer is in. */
const MIN_UNITS = 12;
/** The main script must carry this share of the words. */
const DOMINANT_SHARE = 0.6;

/**
 * The writing system most of the text is in, counting prose only (code, formulas and addresses
 * are masked out). Japanese is `kana` as soon as kana make up a twentieth of its CJK. Null when
 * the text is short or mixed.
 */
export function dominantScript(text: string, minUnits = MIN_UNITS): Script | null {
  const prose = maskTranslation(text).text.replace(/\{\{\d+\}\}/g, ' ');
  const units = new Map<Script, number>();
  for (const char of prose) {
    for (const [script, re, weight] of SCRIPT_PATTERNS) {
      if (!re.test(char)) continue;
      units.set(script, (units.get(script) ?? 0) + weight);
      break;
    }
  }
  const kana = units.get('kana') ?? 0;
  const han = units.get('han') ?? 0;
  if (kana > 0 && kana >= (kana + han) * 0.05) {
    units.set('kana', kana + han);
    units.delete('han');
  }
  const total = [...units.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0 || total < minUnits) return null;
  const [script, count] = [...units.entries()].sort((a, b) => b[1] - a[1])[0];
  return count >= total * DOMINANT_SHARE ? script : null;
}

const LANGUAGE_SCRIPTS: Partial<Record<TranslateLanguage, Script>> = {
  'zh-TW': 'han', 'zh-CN': 'han', ja: 'kana', ko: 'hangul', ru: 'cyrillic', uk: 'cyrillic', ar: 'arabic', fa: 'arabic',
  th: 'thai', hi: 'devanagari', el: 'greek', he: 'hebrew',
};

export function languageScript(tag: TranslateLanguage): Script {
  return LANGUAGE_SCRIPTS[tag] ?? 'latin';
}

/**
 * The language to offer translating into, unasked, when the answer is written in another script
 * than the UI language; null when it is not (or cannot be told). Only offered, never done.
 */
export function suggestTranslation(text: string, uiLocale: string): TranslateLanguage | null {
  const script = dominantScript(text);
  if (!script) return null;
  const target = uiTargetLanguage(uiLocale);
  return script === languageScript(target) ? null : target;
}

/**
 * The language a translation goes to unless the user picks one: the last language the user
 * translated into that the text is not already written in, so a reader who always reads in
 * Japanese is not handed English every time. With nothing used yet, the UI language, or, when
 * the text is already in its script, English (Traditional Chinese for an English UI). A short
 * selection still has a script: a few words are enough to tell Chinese from English here, where
 * offering a translation unasked needs more.
 */
export function defaultTargetLanguage(text: string, uiLocale: string, recent: readonly TranslateLanguage[] = []): TranslateLanguage {
  const ui = uiTargetLanguage(uiLocale);
  const script = dominantScript(text, 0);
  const notTheSource = (tag: TranslateLanguage): boolean => script === null || languageScript(tag) !== script;
  const used = recent.filter(isTranslateLanguage).find(notTheSource);
  if (used) return used;
  if (notTheSource(ui)) return ui;
  return ui === 'en' ? 'zh-TW' : 'en';
}

export const RECENT_LANGUAGES_MAX = 5;

/** The recent list with `tag` moved to the front. */
export function pushRecentLanguage(recent: readonly TranslateLanguage[], tag: TranslateLanguage): TranslateLanguage[] {
  return [tag, ...recent.filter((other) => other !== tag)].slice(0, RECENT_LANGUAGES_MAX);
}

function collatorFor(uiLocale: string): Intl.Collator {
  try {
    return new Intl.Collator([uiLocale, 'en']);
  } catch {
    return new Intl.Collator('en');
  }
}

/**
 * Every language, in the order of its name in the UI language — alphabetical in English, by
 * stroke count in Traditional Chinese, by pinyin in Simplified, as the system lists them.
 */
export function sortedTranslateLanguages(uiLocale: string): TranslateLanguage[] {
  const collator = collatorFor(uiLocale);
  return TRANSLATE_LANGUAGES
    .map((tag) => ({ tag, name: languageDisplayName(tag, uiLocale) }))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map(({ tag }) => tag);
}

/** The menu: recently used languages and the default on top, then every language in name order. */
export function translateMenuLanguages(
  defaultTag: TranslateLanguage,
  recent: readonly TranslateLanguage[],
  uiLocale: string,
): { top: TranslateLanguage[]; all: TranslateLanguage[] } {
  const top = [...new Set([...recent.filter(isTranslateLanguage).slice(0, RECENT_LANGUAGES_MAX - 1), defaultTag])];
  return { top, all: sortedTranslateLanguages(uiLocale) };
}

/**
 * Case- and width-folded, so full-width "JA", "Ja" and "ja" are the same query. Plain `toLowerCase()`,
 * never the host locale's: on a Turkish system `toLocaleLowerCase()` turns "Indonesian" into
 * "ındonesıan" (dotless ı), and a typed "indo" would find nothing.
 */
function foldForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The names a language answers to: in the UI language, in English, in itself, and its tag. */
function searchNames(tag: TranslateLanguage, uiLocale: string): string[] {
  const names = [languageDisplayName(tag, uiLocale), languageDisplayName(tag, 'en'), languageAutonym(tag), tag];
  return [...new Set(names.map(foldForSearch))];
}

/** 0 when a name, or a word in it ("Chinese" in "Traditional Chinese"), starts with the query; 1 when it only contains it. */
function matchRank(names: readonly string[], needle: string): number | null {
  const wordStart = names.some((name) => name.startsWith(needle) || name.split(/[\s-]/).some((word) => word.startsWith(needle)));
  if (wordStart) return 0;
  return names.some((name) => name.includes(needle)) ? 1 : null;
}

/**
 * The languages matching what the reader typed, each once: names that start with it first, then
 * names that contain it, each group in name order. An empty query is every language.
 */
export function filterTranslateLanguages(query: string, uiLocale: string): TranslateLanguage[] {
  const sorted = sortedTranslateLanguages(uiLocale);
  const needle = foldForSearch(query);
  if (!needle) return sorted;
  return sorted
    .map((tag, order) => ({ tag, order, rank: matchRank(searchNames(tag, uiLocale), needle) }))
    .filter((entry): entry is { tag: TranslateLanguage; order: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ tag }) => tag);
}

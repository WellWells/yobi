/** English names of the app's languages, for telling a model which one to write in. */
export const LOCALE_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  'en-US': 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  ja: 'Japanese',
  ko: 'Korean',
  'pt-BR': 'Brazilian Portuguese',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese (Taiwan)',
};

export function languageForLocale(locale: string): string {
  return LOCALE_LANGUAGE_NAMES[locale] ?? 'English';
}

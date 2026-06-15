import { create } from 'zustand';

type Translations = Record<string, string>;
const FALLBACK_LOCALE = 'en-US';

const normalizeLocale = (locale: string): string => locale.trim().toLowerCase().replace('_', '-');

const getBaseLanguage = (locale: string): string => normalizeLocale(locale).split('-')[0] ?? '';

function resolveUiLocale(availableLocales: string[], preferredLocales: string[] = []): string {
  if (availableLocales.length === 0) return FALLBACK_LOCALE;

  const byNormalized = new Map<string, string>();
  for (const locale of availableLocales) {
    byNormalized.set(normalizeLocale(locale), locale);
  }

  for (const preferredLocale of preferredLocales) {
    const exact = byNormalized.get(normalizeLocale(preferredLocale));
    if (exact) return exact;
    const base = getBaseLanguage(preferredLocale);
    if (!base) continue;
    const matched = availableLocales.find((locale) => getBaseLanguage(locale) === base);
    if (matched) return matched;
  }

  const systemLocales = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const systemLocale of systemLocales) {
    const exact = byNormalized.get(normalizeLocale(systemLocale));
    if (exact) return exact;
  }

  for (const systemLocale of systemLocales) {
    const base = getBaseLanguage(systemLocale);
    const matched = availableLocales.find((locale) => getBaseLanguage(locale) === base);
    if (matched) return matched;
  }

  return byNormalized.get(normalizeLocale(FALLBACK_LOCALE)) ?? availableLocales[0];
}

interface I18nState {
  locale: string;
  translations: Translations;
  enTranslations: Translations;
  localeTranslations: Record<string, Translations>;
  availableLocales: string[];
  isReady: boolean;
  setLocale: (locale: string, options?: { persist?: boolean }) => Promise<void>;
  loadLocales: () => Promise<void>;
  t: (key: string) => string;
}

// Rebuilt whenever the active translations change so its identity changes on a
// locale switch — this is what lets React.memo/useMemo consumers that receive t
// as a prop or dependency actually re-render into the new language.
function makeT(translations: Translations, enTranslations: Translations) {
  return (key: string): string =>
    (translations[key] as string | undefined)
    ?? (enTranslations[key] as string | undefined)
    ?? key;
}

function findBestLocaleMatch(availableLocales: string[], targetLocale: string): string | null {
  if (!targetLocale?.trim()) return null;
  const normalizedTarget = normalizeLocale(targetLocale);
  const byNormalized = new Map<string, string>();
  for (const locale of availableLocales) {
    byNormalized.set(normalizeLocale(locale), locale);
  }
  const exact = byNormalized.get(normalizedTarget);
  if (exact) return exact;
  const base = getBaseLanguage(targetLocale);
  if (!base) return null;
  return availableLocales.find((locale) => getBaseLanguage(locale) === base) ?? null;
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: FALLBACK_LOCALE,
  translations: {},
  enTranslations: {},
  localeTranslations: {},
  availableLocales: [],
  isReady: false,

  t: makeT({}, {}),

  loadLocales: async () => {
    const list = await window.electronAPI.getLanguageList();
    const { locale: persistedLocale, setByUser } = await window.electronAPI.getCurrentLocale();

    let resolvedLocale: string;
    if (setByUser) {
      resolvedLocale = findBestLocaleMatch(list, persistedLocale) ?? FALLBACK_LOCALE;
    } else {
      resolvedLocale = resolveUiLocale(list, []);
      if (resolvedLocale !== persistedLocale) {
        void window.electronAPI.setLocaleAuto(resolvedLocale);
      }
    }

    const localesToLoad = [...new Set([FALLBACK_LOCALE, resolvedLocale])];
    const localeEntries = await Promise.all(
      localesToLoad.map(async (locale) => {
        const content = await window.electronAPI.getLanguageContent(locale);
        return [locale, content as Translations | null] as const;
      }),
    );
    const localeTranslations: Record<string, Translations> = {};
    for (const [locale, content] of localeEntries) {
      if (content) localeTranslations[locale] = content;
    }
    const enTranslations = localeTranslations[FALLBACK_LOCALE] ?? {};
    set({
      availableLocales: list,
      localeTranslations,
      enTranslations,
      t: makeT({}, enTranslations),
    });
    await get().setLocale(resolvedLocale, { persist: false });
    set({ isReady: true });
  },

  setLocale: async (locale: string, options?: { persist?: boolean }) => {
    const cachedTranslations = get().localeTranslations[locale];
    if (cachedTranslations) {
      set((state) => ({ locale, translations: cachedTranslations, t: makeT(cachedTranslations, state.enTranslations) }));
    } else {
      const content = await window.electronAPI.getLanguageContent(locale);
      if (content) {
        const translations = content as Translations;
        set((state) => ({
          locale,
          translations,
          t: makeT(translations, state.enTranslations),
          localeTranslations: {
            ...state.localeTranslations,
            [locale]: translations,
          },
        }));
      } else {
        set((state) => ({ locale, translations: {}, t: makeT({}, state.enTranslations) }));
      }
    }
    if (options?.persist !== false) {
      await window.electronAPI.setCurrentLocale(locale);
    }
  },
}));

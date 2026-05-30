// src/renderer/src/store/i18nStore.ts
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

  t: (key: string): string => {
    const { translations, enTranslations } = get();
    // Chain: current locale → en-US → key itself
    return (translations[key] as string | undefined)
      ?? (enTranslations[key] as string | undefined)
      ?? key;
  },

  loadLocales: async () => {
    const list = await window.electronAPI.getLanguageList();
    const { locale: persistedLocale, setByUser } = await window.electronAPI.getCurrentLocale();

    let resolvedLocale: string;
    if (setByUser) {
      // Respect the user's explicit choice — never override it
      resolvedLocale = findBestLocaleMatch(list, persistedLocale) ?? FALLBACK_LOCALE;
    } else {
      // Auto-detect from the OS/browser language preferences
      resolvedLocale = resolveUiLocale(list, []);
      // Persist the auto-detected locale so config reflects reality
      if (resolvedLocale !== persistedLocale) {
        void window.electronAPI.setLocaleAuto(resolvedLocale);
      }
    }

    // Only preload the active locale + en-US fallback (not all 9 locales)
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
    set({
      availableLocales: list,
      localeTranslations,
      enTranslations: localeTranslations[FALLBACK_LOCALE] ?? {},
    });
    await get().setLocale(resolvedLocale, { persist: false });
    set({ isReady: true });
  },

  setLocale: async (locale: string, options?: { persist?: boolean }) => {
    const cachedTranslations = get().localeTranslations[locale];
    if (cachedTranslations) {
      set({ locale, translations: cachedTranslations });
    } else {
      const content = await window.electronAPI.getLanguageContent(locale);
      if (content) {
        const translations = content as Translations;
        set((state) => ({
          locale,
          translations,
          localeTranslations: {
            ...state.localeTranslations,
            [locale]: translations,
          },
        }));
      } else {
        set({ locale, translations: {} });
      }
    }
    if (options?.persist !== false) {
      await window.electronAPI.setCurrentLocale(locale);
    }
  },
}));

import { create } from 'zustand';
import type { CSSVariablesResolver, MantineThemeOverride } from '@mantine/core';
import { getMantineTheme, buildCssVariablesResolver, applyRootThemeVars } from '../theme';
import { isTheme } from '../../../shared/themes';
import type { Theme, ThemePreference } from '../../../shared/themes';

export type { Theme, ThemePreference };

const THEME_STORAGE_KEY = 'yobi-theme';

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  colorScheme: 'light' | 'dark';
  mantineTheme: MantineThemeOverride;
  cssVariablesResolver: CSSVariablesResolver;
  setTheme: (preference: ThemePreference) => void;
  previewTheme: (preference: ThemePreference | null) => void;
}

export function resolveThemePreference(raw: string | null | undefined): ThemePreference {
  return isTheme(raw) ? raw : 'auto';
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference): Omit<ThemeState, 'setTheme' | 'previewTheme'> {
  const theme = preference === 'auto' ? systemTheme() : preference;
  const mantine = getMantineTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);
  applyRootThemeVars(theme);
  return {
    preference,
    theme,
    colorScheme: mantine.colorScheme,
    mantineTheme: mantine.theme,
    cssVariablesResolver: buildCssVariablesResolver(theme),
  };
}

function readStoredPreference(): ThemePreference {
  try {
    return resolveThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...applyTheme(readStoredPreference()),

  setTheme: (preference: ThemePreference) => {
    writeStoredPreference(preference);
    set(applyTheme(preference));
    window.electronAPI.updateTheme(preference).catch(() => {});
  },

  previewTheme: (preference: ThemePreference | null) => {
    const committed = get().preference;
    set({ ...applyTheme(preference ?? committed), preference: committed });
  },
}));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useThemeStore.getState().preference !== 'auto') return;
  useThemeStore.setState(applyTheme('auto'));
});

export function initThemeFromConfig(): void {
  window.electronAPI.getTheme().then((raw) => {
    const preference = resolveThemePreference(raw);
    writeStoredPreference(preference);
    if (preference === useThemeStore.getState().preference) return;
    useThemeStore.setState(applyTheme(preference));
  }).catch(() => { });
}

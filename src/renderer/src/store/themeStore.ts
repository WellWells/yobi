import { create } from 'zustand';
import type { CSSVariablesResolver, MantineThemeOverride } from '@mantine/core';
import { getMantineTheme, buildCssVariablesResolver, applyRootThemeVars } from '../theme';
import { isTheme } from '../../../shared/themes';
import type { Theme, ThemePreference } from '../../../shared/themes';

export type { Theme, ThemePreference };

// Mirrors the config-store value so the first paint (before the async IPC read
// in initThemeFromConfig resolves) already uses the configured theme.
const THEME_STORAGE_KEY = 'yobi-theme';

interface ThemeState {
  /** What the user picked — 'auto' follows the OS scheme. */
  preference: ThemePreference;
  /** Concrete theme currently applied. */
  theme: Theme;
  colorScheme: 'light' | 'dark';
  mantineTheme: MantineThemeOverride;
  cssVariablesResolver: CSSVariablesResolver;
  setTheme: (preference: ThemePreference) => void;
  /** Paint a theme without committing it (Word-style live preview); null restores the committed one. */
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
    // Mirror is best-effort; the config store remains the source of truth.
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
    // Repaint to the hovered theme (or back to `committed` on leave) without
    // persisting. `preference` is kept as-is so the selected ring and summary
    // text keep pointing at the real choice while the preview is showing.
    set({ ...applyTheme(preference ?? committed), preference: committed });
  },
}));

// Re-resolve when the OS scheme changes while following the system.
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

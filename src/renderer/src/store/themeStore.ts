import { create } from 'zustand';
import type { MantineThemeOverride } from '@mantine/core';
import { getMantineTheme, buildCssVariablesResolver } from '../theme';
import type { CSSVariablesResolver } from '@mantine/core';

export type Theme =
  | 'dark' | 'light' | 'dracula' | 'nord' | 'amoled' | 'sepia'
  | 'catppuccin' | 'everforest' | 'rosepine' | 'gruvbox' | 'cyberpunk';

const VALID_THEMES: readonly Theme[] = [
  'dark', 'light', 'dracula', 'nord', 'amoled', 'sepia',
  'catppuccin', 'everforest', 'rosepine', 'gruvbox', 'cyberpunk',
];

interface ThemeState {
  theme: Theme;
  colorScheme: 'light' | 'dark';
  mantineTheme: MantineThemeOverride;
  cssVariablesResolver: CSSVariablesResolver;
  setTheme: (theme: Theme) => void;
}

function resolveTheme(raw: string | null | undefined): Theme {
  if (VALID_THEMES.includes(raw as Theme)) return raw as Theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const _initial: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const _initialMantine = getMantineTheme(_initial);

document.documentElement.setAttribute('data-theme', _initial);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: _initial,
  colorScheme: _initialMantine.colorScheme,
  mantineTheme: _initialMantine.theme,
  cssVariablesResolver: buildCssVariablesResolver(_initial),

  setTheme: (theme: Theme) => {
    const mantine = getMantineTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({
      theme,
      colorScheme: mantine.colorScheme,
      mantineTheme: mantine.theme,
      cssVariablesResolver: buildCssVariablesResolver(theme),
    });
    window.electronAPI.updateTheme(theme).catch(() => {});
  },
}));

export function initThemeFromConfig(): void {
  window.electronAPI.getTheme().then((raw) => {
    const theme = resolveTheme(raw);
    const mantine = getMantineTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
    useThemeStore.setState({
      theme,
      colorScheme: mantine.colorScheme,
      mantineTheme: mantine.theme,
      cssVariablesResolver: buildCssVariablesResolver(theme),
    });
  }).catch(() => { });
}

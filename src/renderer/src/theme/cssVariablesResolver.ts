// src/renderer/src/theme/cssVariablesResolver.ts
//
// Bridges DAC's CSS custom properties into the Mantine CSS variable system.
// Each theme defines 11 independent tokens; 6 state-derived tokens are
// computed automatically by expandTheme() — no manual hover values needed.

import type { CSSVariablesResolver } from '@mantine/core';
import type { Theme } from '../store/themeStore';
import { lerpHex, hexToRgba } from './colorUtils';

// ── Per-theme base tokens (11 independent values) ────────────────────────────

interface BaseTheme {
  bgPrimary: string;
  bgSurface: string;   // cards, inputs
  bgElevated: string;   // tooltips, hover surfaces
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string; // text color for disabled elements
  accent: string;
  success: string;
  warning: string;
  error: string;
}

// Full resolved token set (kept for type safety across the codebase)
interface ThemeColors {
  '--bg-primary': string;
  '--bg-secondary': string;
  '--bg-tertiary': string;
  '--border': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--text-disabled': string;
  '--accent': string;
  '--accent-dim': string;
  '--success': string;
  '--warning': string;
  '--error': string;
  '--bg-hover': string;
  '--accent-hover': string;
  '--border-hover': string;
  '--code-bg': string;
  '--selection-bg': string;
}

// ── Derived token pipeline ────────────────────────────────────────────────────
// Hover / opacity tokens are computed from base colors — never hand-coded.

function expandTheme(base: BaseTheme, isLight: boolean): ThemeColors {
  const toward = isLight ? '#000000' : '#ffffff';
  return {
    '--bg-primary': base.bgPrimary,
    '--bg-secondary': base.bgSurface,
    '--bg-tertiary': base.bgElevated,
    '--border': base.border,
    '--text-primary': base.textPrimary,
    '--text-secondary': base.textSecondary,
    '--text-muted': base.textMuted,
    '--text-disabled': base.textDisabled,
    '--accent': base.accent,
    '--success': base.success,
    '--warning': base.warning,
    '--error': base.error,
    // Derived — do not add manually:
    '--accent-dim': hexToRgba(base.accent, 0.15),
    '--selection-bg': hexToRgba(base.accent, isLight ? 0.18 : 0.25),
    '--bg-hover': lerpHex(base.bgElevated, toward, 0.12),
    '--border-hover': lerpHex(base.border, toward, 0.25),
    '--accent-hover': lerpHex(base.accent, '#ffffff', 0.20),
    '--code-bg': base.bgSurface,
  };
}

// ── Theme definitions — 11 tokens each ───────────────────────────────────────

const LIGHT_THEMES: readonly Theme[] = ['light', 'sepia', 'rosepine'];

const baseThemes: Record<Theme, BaseTheme> = {
  dark: {
    bgPrimary: '#0d1117', bgSurface: '#161b22', bgElevated: '#21262d',
    border: '#30363d',
    textPrimary: '#e6edf3', textSecondary: '#c9d1d9', textMuted: '#8b949e', textDisabled: '#6e7681',
    accent: '#58a6ff',
    success: '#3fb950', warning: '#d29922', error: '#f85149',
  },
  light: {
    bgPrimary: '#ffffff', bgSurface: '#f6f8fa', bgElevated: '#eaeef2',
    border: '#d0d7de',
    textPrimary: '#1f2328', textSecondary: '#24292f', textMuted: '#656d76', textDisabled: '#8c959f',
    accent: '#0969da',
    success: '#1a7f37', warning: '#9a6700', error: '#d1242f',
  },
  dracula: {
    bgPrimary: '#282a36', bgSurface: '#1e1f29', bgElevated: '#44475a',
    border: '#6272a4',
    textPrimary: '#f8f8f2', textSecondary: '#e2e0ff', textMuted: '#8b9ec7', textDisabled: '#6272a4',
    accent: '#bd93f9',
    success: '#50fa7b', warning: '#f1fa8c', error: '#ff5555',
  },
  nord: {
    bgPrimary: '#2e3440', bgSurface: '#3b4252', bgElevated: '#434c5e',
    border: '#4c566a',
    textPrimary: '#eceff4', textSecondary: '#e5e9f0', textMuted: '#81a1c1', textDisabled: '#d8dee9',
    accent: '#88c0d0',
    success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a',
  },
  amoled: {
    bgPrimary: '#000000', bgSurface: '#0a0a0a', bgElevated: '#141414',
    border: '#222222',
    textPrimary: '#ffffff', textSecondary: '#e0e0e0', textMuted: '#909090', textDisabled: '#b0b0b0',
    accent: '#00b4d8',
    success: '#00e676', warning: '#ffab00', error: '#ff5252',
  },
  sepia: {
    bgPrimary: '#f5f0e8', bgSurface: '#ece7de', bgElevated: '#e0d8cc',
    border: '#c8bfaf',
    textPrimary: '#2c2018', textSecondary: '#3d2e20', textMuted: '#7a6a59', textDisabled: '#9b8978',
    accent: '#b5451b',
    success: '#4a7c59', warning: '#c07f1f', error: '#a63220',
  },
  catppuccin: {
    bgPrimary: '#1e1e2e', bgSurface: '#181825', bgElevated: '#313244',
    border: '#45475a',
    textPrimary: '#cdd6f4', textSecondary: '#bac2de', textMuted: '#a6adc8', textDisabled: '#9399b2',
    accent: '#cba6f7',
    success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8',
  },
  everforest: {
    bgPrimary: '#2d353b', bgSurface: '#272e33', bgElevated: '#343f44',
    border: '#475258',
    textPrimary: '#d3c6aa', textSecondary: '#c5b7a3', textMuted: '#7a8478', textDisabled: '#9ca6a3',
    accent: '#a7c080',
    success: '#a7c080', warning: '#dbbc7f', error: '#e67e80',
  },
  rosepine: {
    bgPrimary: '#faf4ed', bgSurface: '#fffaf3', bgElevated: '#f2e9e1',
    border: '#dfd7cc',
    textPrimary: '#575279', textSecondary: '#4a485b', textMuted: '#9893a5', textDisabled: '#b6b4ba',
    accent: '#b4637a',
    success: '#56949f', warning: '#ea9d34', error: '#b4637a',
  },
  gruvbox: {
    bgPrimary: '#282828', bgSurface: '#1d2021', bgElevated: '#3c3836',
    border: '#504945',
    textPrimary: '#ebdbb2', textSecondary: '#d5c4a1', textMuted: '#928374', textDisabled: '#a89984',
    accent: '#fe8019',
    success: '#b8bb26', warning: '#fabd2f', error: '#fb4934',
  },
  cyberpunk: {
    bgPrimary: '#0d0d1a', bgSurface: '#070711', bgElevated: '#12122a',
    border: '#1a1a3e',
    textPrimary: '#e0e0ff', textSecondary: '#c0c0f0', textMuted: '#8080cc', textDisabled: '#a0a0dd',
    accent: '#00e5ff',
    success: '#00ff88', warning: '#ffcc00', error: '#ff3355',
  },
};

// ── Resolver factory ──────────────────────────────────────────────────────────

export function buildCssVariablesResolver(dacTheme: Theme): CSSVariablesResolver {
  const isLight = LIGHT_THEMES.includes(dacTheme);
  const colors = expandTheme(baseThemes[dacTheme], isLight);

  const allVars = {
    // DAC semantic variables
    '--bg-primary': colors['--bg-primary'],
    '--bg-secondary': colors['--bg-secondary'],
    '--bg-tertiary': colors['--bg-tertiary'],
    '--border': colors['--border'],
    '--text-primary': colors['--text-primary'],
    '--text-secondary': colors['--text-secondary'],
    '--text-muted': colors['--text-muted'],
    '--text-disabled': colors['--text-disabled'],
    '--accent': colors['--accent'],
    '--accent-dim': colors['--accent-dim'],
    '--success': colors['--success'],
    '--warning': colors['--warning'],
    '--error': colors['--error'],
    '--bg-hover': colors['--bg-hover'],
    '--accent-hover': colors['--accent-hover'],
    '--border-hover': colors['--border-hover'],
    '--code-bg': colors['--code-bg'],
    '--selection-bg': colors['--selection-bg'],

    // Mantine built-in bridges
    '--mantine-color-body': colors['--bg-primary'],
    '--mantine-color-text': colors['--text-primary'],
    '--mantine-color-dimmed': colors['--text-disabled'],
    '--mantine-color-placeholder': colors['--text-muted'],
    '--mantine-color-default': colors['--bg-secondary'],
    '--mantine-color-default-hover': colors['--bg-hover'],
    '--mantine-color-default-color': colors['--text-secondary'],
    '--mantine-color-default-border': colors['--border'],

    // Action hover bridge (Button, ActionIcon, Menu, etc.)
    '--mantine-color-action-hover': colors['--bg-hover'],
    '--mantine-color-action-active': colors['--accent-dim'],

    // DAC extended bridges
    '--mantine-color-bg-tertiary': colors['--bg-tertiary'],
    '--mantine-color-accent': colors['--accent'],
    '--mantine-color-accent-dim': colors['--accent-dim'],
    '--mantine-color-accent-hover': colors['--accent-hover'],
    '--mantine-color-border-hover': colors['--border-hover'],
    '--mantine-color-success': colors['--success'],
    '--mantine-color-warning': colors['--warning'],
    '--mantine-color-error': colors['--error'],
    '--mantine-color-code-bg': colors['--code-bg'],
    '--mantine-color-selection-bg': colors['--selection-bg'],
  };

  // NavLink / Combobox.Option / Menu.Item use hardcoded palette references
  // that bypass --mantine-color-default-hover. Override at palette level.
  const paletteHoverOverrides: Record<string, string> = isLight
    ? {
      '--mantine-color-gray-0': colors['--bg-hover'],
      '--mantine-color-gray-1': colors['--bg-hover'],
    }
    : {
      '--mantine-color-dark-4': colors['--bg-hover'],
      '--mantine-color-dark-6': colors['--bg-hover'],
      '--mantine-color-dark-7': colors['--bg-hover'],
    };

  return () => ({
    variables: allVars,
    light: isLight ? { ...allVars, ...paletteHoverOverrides } : {},
    dark: !isLight ? { ...allVars, ...paletteHoverOverrides } : {},
  });
}


import type { CSSVariablesResolver } from '@mantine/core';
import { THEME_DEFS, VALID_THEMES, themeDef } from '../../../shared/themes';
import type { Theme, ThemeColors } from '../../../shared/themes';
import { lerpHex, hexToRgba, relativeLuminance } from './colorUtils';

// Matches Mantine's autoContrast luminanceThreshold (mantineTheme.ts) so text
// placed on the raw accent flips to dark in the same themes as filled buttons.
const ON_ACCENT_LUMINANCE_THRESHOLD = 0.3;

interface ThemeCssVars {
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
  '--on-accent': string;
}

function expandTheme(base: ThemeColors, isLight: boolean): ThemeCssVars {
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
    '--accent-dim': hexToRgba(base.accent, 0.15),
    '--selection-bg': hexToRgba(base.accent, isLight ? 0.18 : 0.25),
    '--bg-hover': lerpHex(base.bgElevated, toward, 0.12),
    '--border-hover': lerpHex(base.border, toward, 0.25),
    '--accent-hover': lerpHex(base.accent, toward, 0.20),
    '--code-bg': base.bgSurface,
    '--on-accent': relativeLuminance(base.accent) > ON_ACCENT_LUMINANCE_THRESHOLD ? '#1b1b1b' : '#ffffff',
  };
}

// Swatch data for the theme picker — derived from the same base definitions so
// the picker can never drift from the actual theme colors.
export interface ThemeSwatch {
  theme: Theme;
  background: string;
  accent: string;
  border: string;
}

export const THEME_SWATCHES: readonly ThemeSwatch[] = VALID_THEMES.map((theme) => ({
  theme,
  background: THEME_DEFS[theme].colors.bgPrimary,
  accent: THEME_DEFS[theme].colors.accent,
  border: THEME_DEFS[theme].colors.border,
}));

// Half-dark / half-light swatch for the "follow system" picker option.
export const AUTO_THEME_SWATCH = {
  background: `linear-gradient(135deg, ${THEME_DEFS.dark.colors.bgPrimary} 50%, ${THEME_DEFS.light.colors.bgPrimary} 50%)`,
  accent: `linear-gradient(135deg, ${THEME_DEFS.dark.colors.accent} 50%, ${THEME_DEFS.light.colors.accent} 50%)`,
  border: 'var(--border)',
} as const;

// Applies the theme's CSS variables as inline styles on <html> so the first
// paint (before MantineProvider mounts its resolver) already shows the right
// theme instead of the static dark defaults in globals.css. Values come from
// the same expandTheme() the resolver uses, so the two can never disagree.
export function applyRootThemeVars(theme: Theme): void {
  const def = themeDef(theme);
  const colors = expandTheme(def.colors, def.light === true);
  for (const [name, value] of Object.entries(colors)) {
    document.documentElement.style.setProperty(name, value);
  }
}

export function buildCssVariablesResolver(yobiTheme: Theme): CSSVariablesResolver {
  const def = themeDef(yobiTheme);
  const isLight = def.light === true;
  const colors = expandTheme(def.colors, isLight);

  const allVars = {
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
    '--on-accent': colors['--on-accent'],

    '--mantine-color-body': colors['--bg-primary'],
    '--mantine-color-text': colors['--text-primary'],
    '--mantine-color-dimmed': colors['--text-disabled'],
    '--mantine-color-placeholder': colors['--text-muted'],
    '--mantine-color-default': colors['--bg-secondary'],
    '--mantine-color-default-hover': colors['--bg-hover'],
    '--mantine-color-default-color': colors['--text-secondary'],
    '--mantine-color-default-border': colors['--border'],

    '--mantine-color-action-hover': colors['--bg-hover'],
    '--mantine-color-action-active': colors['--accent-dim'],

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

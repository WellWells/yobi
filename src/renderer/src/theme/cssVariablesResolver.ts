import type { CSSVariablesResolver } from '@mantine/core';
import { THEME_DEFS, VALID_THEMES, themeDef } from '../../../shared/themes';
import type { Theme, ThemeColors } from '../../../shared/themes';
import { contrastRatio, lerpHex, hexToRgba } from './colorUtils';

/** Accent opacity of `--accent-dim`, the fill of selected rows. */
const ACCENT_DIM_ALPHA = 0.15;
/** How far `--bg-hover` (hovered rows and menu items) moves from the elevated colour: toward white in dark themes, black in light ones. */
const HOVER_SHIFT = 0.12;

/** Accent opacity of the brand `light` variant fill in dark themes, at rest and on hover. */
export const BRAND_LIGHT_ALPHA = 0.15;
export const BRAND_LIGHT_HOVER_ALPHA = 0.22;
/** WCAG AA for body text: the `light` variant carries small labels (badges, pills). */
export const BRAND_LIGHT_MIN_CONTRAST = 4.5;
/** The label is lifted toward white in steps of 1/BRAND_LIGHT_LIFT_STEPS. */
export const BRAND_LIGHT_LIFT_STEPS = 20;

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
  '--border-hover': string;
  '--code-bg': string;
  '--selection-bg': string;
}

function hoverColor(base: ThemeColors, isLight: boolean): string {
  return lerpHex(base.bgElevated, isLight ? '#000000' : '#ffffff', HOVER_SHIFT);
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
    '--accent-dim': hexToRgba(base.accent, ACCENT_DIM_ALPHA),
    '--selection-bg': hexToRgba(base.accent, isLight ? 0.18 : 0.25),
    '--bg-hover': hoverColor(base, isLight),
    '--border-hover': lerpHex(base.border, toward, 0.25),
    '--code-bg': base.bgSurface,
  };
}

/** `color` moved toward white just far enough to reach the minimum contrast on every background. */
function liftUntilReadable(color: string, backgrounds: readonly string[]): string {
  for (let step = 0; step <= BRAND_LIGHT_LIFT_STEPS; step += 1) {
    const candidate = lerpHex(color, '#ffffff', step / BRAND_LIGHT_LIFT_STEPS);
    if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= BRAND_LIGHT_MIN_CONTRAST)) return candidate;
  }
  return '#ffffff';
}

/**
 * Mantine derives the dark-scheme `light` variant from shade 9, which in Yobi's palette is darker
 * than the surface under it. Dark themes use the accent at low opacity instead, with the text lifted
 * toward white just enough to stay readable over every backdrop a badge can sit on (page, surfaces,
 * hovered and selected rows). Light themes keep Mantine's opaque shade 1 fill and shade 9 text.
 */
function brandLightVars(base: ThemeColors, isLight: boolean): Record<string, string> {
  if (isLight) return {};
  const backdrops = [
    base.bgPrimary,
    base.bgSurface,
    base.bgElevated,
    hoverColor(base, isLight),
    lerpHex(base.bgPrimary, base.accent, ACCENT_DIM_ALPHA),
    lerpHex(base.bgSurface, base.accent, ACCENT_DIM_ALPHA),
  ];
  const fills = backdrops.flatMap((bg) => [
    lerpHex(bg, base.accent, BRAND_LIGHT_ALPHA),
    lerpHex(bg, base.accent, BRAND_LIGHT_HOVER_ALPHA),
  ]);
  return {
    '--mantine-color-brand-light': hexToRgba(base.accent, BRAND_LIGHT_ALPHA),
    '--mantine-color-brand-light-hover': hexToRgba(base.accent, BRAND_LIGHT_HOVER_ALPHA),
    '--mantine-color-brand-light-color': liftUntilReadable(base.accent, fills),
  };
}

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
    '--border-hover': colors['--border-hover'],
    '--code-bg': colors['--code-bg'],
    '--selection-bg': colors['--selection-bg'],

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
    '--mantine-color-border-hover': colors['--border-hover'],
    '--mantine-color-success': colors['--success'],
    '--mantine-color-warning': colors['--warning'],
    '--mantine-color-error': colors['--error'],
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

  const schemeVars = { ...allVars, ...paletteHoverOverrides, ...brandLightVars(def.colors, isLight) };

  return () => ({
    variables: allVars,
    light: isLight ? schemeVars : {},
    dark: !isLight ? schemeVars : {},
  });
}

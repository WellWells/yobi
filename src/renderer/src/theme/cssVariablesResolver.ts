import { DEFAULT_THEME } from '@mantine/core';
import type { CSSVariablesResolver } from '@mantine/core';
import { THEME_DEFS, VALID_THEMES, themeDef } from '../../../shared/themes';
import type { Theme, ThemeColors, ThemeDef } from '../../../shared/themes';
import { backdropLayers, backdropSurfaces } from './backdrop';
import { contrastRatio, lerpHex, hexToRgba } from './colorUtils';
import { flowStepColorVars } from './flowStepColors';

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

/** WCAG 1.4.3 (AA): text that is not disabled, `dimmed` and `--text-muted` included. */
export const TEXT_MIN_CONTRAST = 4.5;
/** WCAG 1.4.11 (AA): the focus ring and the boundary that identifies a control. */
export const NON_TEXT_MIN_CONTRAST = 3;
/** Theme colours that fall short are moved toward white (dark) or black (light) in 1/LIFT_STEPS steps. */
export const LIFT_STEPS = 20;

/** The one backdrop's darkness (Mantine's black overlay), under every dialog and the narrow window's sidebar drawer. */
export const BACKDROP_OPACITY = 0.55;

interface ThemeCssVars {
  '--bg-primary': string;
  '--bg-secondary': string;
  '--bg-tertiary': string;
  '--border': string;
  '--border-control': string;
  '--focus-ring': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--text-disabled': string;
  '--accent': string;
  '--accent-text': string;
  '--accent-dim': string;
  '--danger-text': string;
  '--caption-on-backdrop': string;
  '--success': string;
  '--warning': string;
  '--success-text': string;
  '--warning-text': string;
  '--error-text': string;
  '--error': string;
  '--bg-hover': string;
  '--border-hover': string;
  '--code-bg': string;
  '--selection-bg': string;
}

function hoverColor(base: ThemeColors, isLight: boolean): string {
  return lerpHex(base.bgElevated, isLight ? '#000000' : '#ffffff', HOVER_SHIFT);
}

/** `color` moved toward `toward` just far enough to reach `min` on every background (`toward` itself if never). */
export function liftUntil(color: string, toward: string, backgrounds: readonly string[], min: number): string {
  for (let step = 0; step <= LIFT_STEPS; step += 1) {
    const candidate = lerpHex(color, toward, step / LIFT_STEPS);
    if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= min)) return candidate;
  }
  return toward;
}

/**
 * The opaque backgrounds a theme's text, controls and focus ring sit on: the page, panels, cards
 * and inputs, and a selected row (`--accent-dim` over the page or a panel). The focus ring adds the
 * hovered row: a keyboard user can focus the row the pointer rests on. Hovered text is not lifted
 * for it: hover is transient and would push muted text in most dark themes to near white.
 * `extra` is what a theme with a drawn backdrop adds (`backdropSurfaces`): the colours the backdrop
 * shows and a sidebar over them, each also as a selected row.
 */
export function themeBackdrops(base: ThemeColors, extra: readonly string[] = []): Record<string, string> {
  const drawn = Object.fromEntries(extra.flatMap((color, index) => [
    [`backdrop${index}`, color],
    [`selectedRowOnBackdrop${index}`, lerpHex(color, base.accent, ACCENT_DIM_ALPHA)],
  ]));
  return {
    ...drawn,
    page: base.bgPrimary,
    surface: base.bgSurface,
    elevated: base.bgElevated,
    selectedRowOnPage: lerpHex(base.bgPrimary, base.accent, ACCENT_DIM_ALPHA),
    selectedRowOnSurface: lerpHex(base.bgSurface, base.accent, ACCENT_DIM_ALPHA),
  };
}

function focusBackdrops(base: ThemeColors, isLight: boolean, extra: readonly string[]): string[] {
  return [...Object.values(themeBackdrops(base, extra)), hoverColor(base, isLight)];
}

/** The shade Mantine paints a shade-less `color="red"` menu item and `c="red"` text with. */
const DANGER_SHADE = 6;

/**
 * Mantine's red as the label of a destructive menu item or icon button: shade 6 where it reads at
 * 4.5:1 on the page, panels, cards, selected rows and a hovered row (a menu item's highlight), else
 * the first darker (light themes) or lighter (dark ones) shade that does, else the last one moved
 * toward black or white just far enough. Red itself is not re-registered, so the template gallery
 * and step-category hues keep Mantine's palette.
 */
function dangerText(base: ThemeColors, isLight: boolean, extra: readonly string[]): string {
  const red = DEFAULT_THEME.colors.red;
  const fills = focusBackdrops(base, isLight, extra);
  const shades = isLight ? red.slice(DANGER_SHADE) : red.slice(0, DANGER_SHADE + 1).reverse();
  const found = shades.find((hex) => fills.every((bg) => contrastRatio(hex, bg) >= TEXT_MIN_CONTRAST));
  return found ?? liftUntil(shades[shades.length - 1], isLight ? '#000000' : '#ffffff', fills, TEXT_MIN_CONTRAST);
}

/** The page, panels and cards as they show through the backdrop. */
export function dimmedBackdrops(base: ThemeColors, extra: readonly string[] = []): string[] {
  return [base.bgPrimary, base.bgSurface, base.bgElevated, ...extra].map((bg) => lerpHex(bg, '#000000', BACKDROP_OPACITY));
}

/**
 * The label and icons of the caption controls while they float over the Settings dialog's
 * backdrop (TitleBar): the theme's text where it reads at 4.5:1 on the dimmed rows and on a
 * hovered subtle button's tint over them, else moved toward white just far enough. A light
 * theme's accent text (shade 9) reads 3.59:1 on its dimmed page (Solarized Light).
 */
function captionOnBackdrop(base: ThemeColors, extra: readonly string[]): string {
  const dimmed = dimmedBackdrops(base, extra);
  const fills = [...dimmed, ...dimmed.map((bg) => lerpHex(bg, base.accent, BRAND_LIGHT_HOVER_ALPHA))];
  return liftUntil(base.textPrimary, '#ffffff', fills, TEXT_MIN_CONTRAST);
}

/** The tint of the queue pill and its rows' status badges (TitleBar.module.css), over what is under them. */
export const STATUS_TINT_ALPHA = 0.15;

/**
 * A status colour as text or a small icon (a field's warning line, an error message, a done tick,
 * the queue pill): the token where it reads at 4.5:1 on the page, panels, cards, a selected row, a
 * hovered row and its own tint over the page, panels and cards, else moved just enough. Raw, the
 * warning read 1.43:1 on Rosé Pine, success 1.80:1 on Solarized Light, error 1.52:1 on Nord.
 */
function statusText(tone: string, base: ThemeColors, isLight: boolean, extra: readonly string[]): string {
  const tinted = [base.bgPrimary, base.bgSurface, base.bgElevated, ...extra].map((bg) => lerpHex(bg, tone, STATUS_TINT_ALPHA));
  return liftUntil(tone, isLight ? '#000000' : '#ffffff', [...focusBackdrops(base, isLight, extra), ...tinted], TEXT_MIN_CONTRAST);
}

function expandTheme(def: ThemeDef): ThemeCssVars {
  const base = def.colors;
  const isLight = def.light === true;
  const extra = backdropSurfaces(def);
  const toward = isLight ? '#000000' : '#ffffff';
  const textBackdrops = Object.values(themeBackdrops(base, extra));
  const controlBackdrops = [base.bgPrimary, base.bgSurface, base.bgElevated, ...extra];
  const readable = (color: string) => liftUntil(color, toward, textBackdrops, TEXT_MIN_CONTRAST);
  return {
    '--bg-primary': base.bgPrimary,
    '--bg-secondary': base.bgSurface,
    '--bg-tertiary': base.bgElevated,
    '--border': base.border,
    '--border-control': liftUntil(base.border, toward, controlBackdrops, NON_TEXT_MIN_CONTRAST),
    '--focus-ring': liftUntil(base.accent, toward, focusBackdrops(base, isLight, extra), NON_TEXT_MIN_CONTRAST),
    '--text-primary': readable(base.textPrimary),
    '--text-secondary': readable(base.textSecondary),
    '--text-muted': readable(base.textMuted),
    '--text-disabled': base.textDisabled,
    '--accent': base.accent,
    // The accent as text (a selected nav entry, links, accent log lines): the accent itself where it
    // already reads at 4.5:1 on the page, panels, cards and a selected row, else moved just enough.
    '--accent-text': readable(base.accent),
    '--danger-text': dangerText(base, isLight, extra),
    '--caption-on-backdrop': captionOnBackdrop(base, extra),
    '--success': base.success,
    '--warning': base.warning,
    '--error': base.error,
    '--success-text': statusText(base.success, base, isLight, extra),
    '--warning-text': statusText(base.warning, base, isLight, extra),
    '--error-text': statusText(base.error, base, isLight, extra),
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
function brandLightVars(def: ThemeDef): Record<string, string> {
  const base = def.colors;
  const isLight = def.light === true;
  if (isLight) return {};
  const backdrops = [
    base.bgPrimary,
    base.bgSurface,
    base.bgElevated,
    hoverColor(base, isLight),
    lerpHex(base.bgPrimary, base.accent, ACCENT_DIM_ALPHA),
    lerpHex(base.bgSurface, base.accent, ACCENT_DIM_ALPHA),
    ...backdropSurfaces(def),
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
  background: backdropLayers(themeDef(theme))?.swatch ?? THEME_DEFS[theme].colors.bgPrimary,
  accent: THEME_DEFS[theme].colors.accent,
  border: THEME_DEFS[theme].colors.border,
}));

export function buildCssVariablesResolver(yobiTheme: Theme): CSSVariablesResolver {
  const def = themeDef(yobiTheme);
  const isLight = def.light === true;
  const colors = expandTheme(def);

  const allVars = {
    ...flowStepColorVars(def.colors, isLight),
    '--bg-primary': colors['--bg-primary'],
    '--bg-secondary': colors['--bg-secondary'],
    '--bg-tertiary': colors['--bg-tertiary'],
    '--border': colors['--border'],
    '--border-control': colors['--border-control'],
    '--focus-ring': colors['--focus-ring'],
    '--text-primary': colors['--text-primary'],
    '--text-secondary': colors['--text-secondary'],
    '--text-muted': colors['--text-muted'],
    '--text-disabled': colors['--text-disabled'],
    '--accent': colors['--accent'],
    '--accent-text': colors['--accent-text'],
    '--accent-dim': colors['--accent-dim'],
    '--danger-text': colors['--danger-text'],
    '--caption-on-backdrop': colors['--caption-on-backdrop'],
    '--success': colors['--success'],
    '--warning': colors['--warning'],
    '--success-text': colors['--success-text'],
    '--warning-text': colors['--warning-text'],
    '--error-text': colors['--error-text'],
    '--error': colors['--error'],
    '--bg-hover': colors['--bg-hover'],
    '--border-hover': colors['--border-hover'],
    '--code-bg': colors['--code-bg'],
    '--selection-bg': colors['--selection-bg'],

    '--mantine-color-body': colors['--bg-primary'],
    '--mantine-color-text': colors['--text-primary'],
    // `c="dimmed"` is secondary text (timestamps, hints, descriptions), not a disabled control:
    // Mantine draws disabled controls with --mantine-color-disabled-color. WCAG 1.4.3 needs 4.5:1.
    '--mantine-color-dimmed': colors['--text-muted'],
    '--mantine-color-placeholder': colors['--text-muted'],
    '--mantine-color-default': colors['--bg-secondary'],
    '--mantine-color-default-hover': colors['--bg-hover'],
    '--mantine-color-default-color': colors['--text-secondary'],
    '--mantine-color-default-border': colors['--border'],

    '--mantine-color-action-hover': colors['--bg-hover'],
    '--mantine-color-action-active': colors['--accent-dim'],

    '--mantine-color-bg-tertiary': colors['--bg-tertiary'],
    '--mantine-color-accent': colors['--accent'],
    '--mantine-color-accent-text': colors['--accent-text'],
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

  const schemeVars = { ...allVars, ...paletteHoverOverrides, ...brandLightVars(def) };

  return () => ({
    variables: allVars,
    light: isLight ? schemeVars : {},
    dark: !isLight ? schemeVars : {},
  });
}

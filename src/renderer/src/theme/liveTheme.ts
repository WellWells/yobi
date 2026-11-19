import {
  DEFAULT_THEME, defaultCssVariablesResolver, defaultVariantColorsResolver, getAutoContrastValue, mergeMantineTheme,
  parseThemeColor, rem,
} from '@mantine/core';
import type {
  ConvertCSSVariablesInput, MantineColorSchemeManager, MantineTheme, MantineThemeOverride, VariantColorsResolver,
} from '@mantine/core';
import { themeDef } from '../../../shared/themes';
import type { Theme } from '../../../shared/themes';
import { backdropLayers, backdropPanelFill } from './backdrop';
import { buildCssVariablesResolver } from './cssVariablesResolver';
import { brandPalette, buildMantineTheme, getMantineTheme } from './mantineTheme';
import { STATUS_TOKEN, TEXT_VARIANTS, readableVariantColors } from './variantColors';

/*
 * Switching the theme repaints, it does not re-render. A new Mantine theme object (or colour
 * scheme) handed to MantineProvider re-renders every Mantine component in every always-mounted
 * View: about 300 ms of main thread per theme on 9,000 DOM nodes, once per row the pointer crossed
 * in the theme picker's hover preview (measured). So the provider gets one theme for
 * the life of the window, and everything that differs between Yobi themes is a CSS variable on
 * <html>, projected from the per-theme reference (`getMantineTheme`) and checked against it.
 */

/** The label Mantine's autoContrast picks for the brand fill, per theme (black on a light accent). */
const BRAND_CONTRAST = 'var(--mantine-primary-color-contrast)';

function isBrand(color: string, theme: MantineTheme): boolean {
  const parsed = parseThemeColor({ color, theme });
  return parsed.isThemeColor && parsed.color === theme.primaryColor && parsed.shade === undefined;
}

/** The variable that carries a palette colour's or status token's lifted label in one variant. */
export function variantLabelVar(color: string, variant: string, theme: MantineTheme): string | null {
  if (!TEXT_VARIANTS.has(variant)) return null;
  const status = STATUS_TOKEN.exec(color);
  if (status) return `--yobi-${status[1]}-${variant}-label`;
  const parsed = parseThemeColor({ color, theme });
  if (!parsed.isThemeColor || parsed.shade !== undefined || parsed.color === theme.primaryColor) return null;
  return `--yobi-${parsed.color}-${variant}-label`;
}

/**
 * `readableVariantColors` with every theme-dependent label read from a variable: a lifted label
 * is defined only in the themes that lift it, else Mantine's own label stands (the fallback).
 */
const liveVariantColors: VariantColorsResolver = (input) => {
  const result = defaultVariantColorsResolver(input);
  const { color, theme, variant } = input;
  if (!color) return result;
  if (variant === 'filled' && isBrand(color, theme) && getAutoContrastValue(input.autoContrast, theme)) {
    return { ...result, color: BRAND_CONTRAST };
  }
  const name = variantLabelVar(color, variant, theme);
  if (!name) return result;
  const label = `var(${name}, ${result.color})`;
  return { ...result, color: label, border: variant === 'outline' ? `${rem(1)} solid ${label}` : result.border };
};

interface ContrastProps {
  color?: string;
  autoContrast?: boolean;
  iconColor?: string;
  variant?: string;
}

/**
 * Components whose vars resolver picks a black or white label for their colour in JS
 * (`getContrastColor`): on the brand colour that pick follows the theme, so it is replaced by the
 * variable. `iconLike`: Checkbox and Radio skip it for an explicit icon colour and the light variant.
 */
interface ContrastVar {
  /** The part the component's own vars resolver writes the label to. */
  selector: 'root' | 'indicator';
  variable: string;
  iconLike: boolean;
}

function brandContrast({ selector, variable, iconLike }: ContrastVar) {
  return (theme: MantineTheme, props: ContrastProps) => {
    if (iconLike && (props.iconColor || props.variant === 'light')) return {};
    if (!getAutoContrastValue(props.autoContrast, theme)) return {};
    if (!isBrand(props.color || theme.primaryColor, theme)) return {};
    return { [selector]: { [variable]: BRAND_CONTRAST } };
  };
}

/** Mantine theme keys and the label variable each one's vars resolver computes from the colour. */
export const BRAND_CONTRAST_VARS: Record<string, ContrastVar> = {
  Checkbox: { selector: 'root', variable: '--checkbox-icon-color', iconLike: true },
  CheckboxIndicator: { selector: 'indicator', variable: '--checkbox-icon-color', iconLike: true },
  Radio: { selector: 'root', variable: '--radio-icon-color', iconLike: true },
  RadioIndicator: { selector: 'indicator', variable: '--radio-icon-color', iconLike: true },
  Indicator: { selector: 'root', variable: '--indicator-text-color', iconLike: false },
  Pagination: { selector: 'root', variable: '--pagination-active-color', iconLike: false },
  Stepper: { selector: 'root', variable: '--stepper-icon-color', iconLike: false },
  Tabs: { selector: 'root', variable: '--tabs-text-color', iconLike: false },
  Timeline: { selector: 'root', variable: '--tl-icon-color', iconLike: false },
};

const contrastComponents = Object.fromEntries(Object.entries(BRAND_CONTRAST_VARS)
  .map(([name, entry]) => [name, { vars: brandContrast(entry) }])) as MantineThemeOverride['components'];

/**
 * The window's one Mantine theme. Its brand palette is a placeholder (the dark theme's): every
 * colour drawn from it is overridden per theme on <html> by `applyRootThemeVars`.
 */
export const APP_MANTINE_THEME: MantineThemeOverride = buildMantineTheme(
  brandPalette(themeDef('dark')),
  liveVariantColors,
  contrastComponents,
);

const APP_MERGED = mergeMantineTheme(DEFAULT_THEME, APP_MANTINE_THEME);

type Scheme = 'light' | 'dark';

/** What one scheme's `:root` ends up with: Mantine's generator merged with ours, scheme block last. */
function effective(blocks: ConvertCSSVariablesInput[], scheme: Scheme): Record<string, string> {
  const variables = Object.assign({}, ...blocks.map((b) => b.variables)) as Record<string, string>;
  const schemeVars = Object.assign({}, ...blocks.map((b) => b[scheme])) as Record<string, string>;
  return { ...variables, ...schemeVars };
}

export interface ThemeRoot {
  scheme: Scheme;
  /** Every variable whose value in this theme differs from what the provider's stylesheet gives. */
  vars: Record<string, string>;
}

const PALETTE_STATUS = ['success', 'warning', 'error'] as const;
const rootCache = new Map<Theme, ThemeRoot>();

/** The labels `readableVariantColors` lifts in this theme, under their `variantLabelVar` names. */
function liftedLabels(theme: Theme, reference: MantineTheme): Record<string, string> {
  const resolve = readableVariantColors(themeDef(theme));
  const colors = [
    ...Object.keys(reference.colors).filter((c) => c !== reference.primaryColor),
    ...PALETTE_STATUS.map((s) => `var(--mantine-color-${s})`),
  ];
  const labels: Record<string, string> = {};
  for (const color of colors) {
    for (const variant of TEXT_VARIANTS) {
      const name = variantLabelVar(color, variant, reference);
      if (!name) continue;
      const lifted = resolve({ color, theme: reference, variant }).color;
      if (lifted !== defaultVariantColorsResolver({ color, theme: reference, variant }).color) labels[name] = lifted;
    }
  }
  return labels;
}

/**
 * What a theme with a drawn backdrop adds: its two gradient layers, a see-through page (the views
 * let the backdrop show) and a part see-through sidebar. Other themes keep the stylesheet's defaults.
 */
export function backdropVars(theme: Theme): Record<string, string> {
  const def = themeDef(theme);
  const layers = backdropLayers(def);
  if (!layers) return {};
  return {
    '--backdrop-back': layers.back,
    '--backdrop-front': layers.front,
    '--page-bg': 'transparent',
    '--panel-bg': backdropPanelFill(def),
  };
}

/** The variables one Yobi theme sets on <html>, and its colour scheme. Computed once per theme. */
export function themeRootVars(theme: Theme): ThemeRoot {
  const cached = rootCache.get(theme);
  if (cached) return cached;
  const scheme: Scheme = themeDef(theme).light === true ? 'light' : 'dark';
  const reference = mergeMantineTheme(DEFAULT_THEME, getMantineTheme(theme).theme);
  const target = effective([defaultCssVariablesResolver(reference), buildCssVariablesResolver(theme)(reference)], scheme);
  const sheet = effective([defaultCssVariablesResolver(APP_MERGED)], scheme);
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(target)) {
    if (sheet[name] !== value) vars[name] = value;
  }
  Object.assign(vars, liftedLabels(theme, reference), backdropVars(theme));
  const root = { scheme, vars };
  rootCache.set(theme, root);
  return root;
}

/** The names last set on <html>, kept on the element so a hot reload of this module still clears them. */
const APPLIED = Symbol.for('yobi.themeRootVars');
type RootWithApplied = HTMLElement & { [APPLIED]?: Record<string, string> };

/** Applies a theme by updating <html>: changed variables only, the colour scheme and `data-theme`. */
export function applyRootThemeVars(theme: Theme): void {
  const { scheme, vars } = themeRootVars(theme);
  const root = document.documentElement as RootWithApplied;
  const applied = root[APPLIED] ?? {};
  for (const name of Object.keys(applied)) {
    if (!(name in vars)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(vars)) {
    if (applied[name] !== value) root.style.setProperty(name, value);
  }
  root[APPLIED] = vars;
  root.toggleAttribute('data-backdrop', themeDef(theme).backdrop !== undefined);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mantine-color-scheme', scheme);
}

/**
 * The provider reads the colour scheme `applyRootThemeVars` already wrote and never writes one:
 * no `forceColorScheme`, whose every change re-renders the tree like a new theme does.
 */
export const rootColorSchemeManager: MantineColorSchemeManager = {
  get: (fallback) => {
    const scheme = document.documentElement.getAttribute('data-mantine-color-scheme');
    return scheme === 'light' || scheme === 'dark' ? scheme : fallback;
  },
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};

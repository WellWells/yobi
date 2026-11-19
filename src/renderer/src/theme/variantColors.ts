import { defaultVariantColorsResolver, parseThemeColor, rem } from '@mantine/core';
import type { MantineTheme, VariantColorsResolver, VariantColorsResolverInput } from '@mantine/core';
import type { ThemeDef } from '../../../shared/themes';
import { contrastRatio, lerpHex } from './colorUtils';
import { backdropSurfaces } from './backdrop';
import { TEXT_MIN_CONTRAST, liftUntil, themeBackdrops } from './cssVariablesResolver';

/** The variants whose label is the colour itself, over a tint or over whatever is behind it. */
export const TEXT_VARIANTS = new Set(['light', 'subtle', 'transparent', 'outline']);

/** Status tokens a call site passes as `color` (a "signed in" badge, a warning badge). */
export const STATUS_TOKEN = /^var\(--mantine-color-(success|warning|error)\)$/;

/** Mantine's tints: the light variant's fill on rest and hover, the outline variant's hover. */
const LIGHT_ALPHA = 0.1;
const LIGHT_HOVER_ALPHA = 0.12;
const OUTLINE_HOVER_ALPHA = 0.05;

interface Label {
  text: string;
  fills: string[];
  /** Darker (light scheme) or lighter (dark) shades of the same palette colour to try first. */
  shades?: readonly string[];
}

/**
 * The label itself when it reads on every fill; else the first further shade of its own palette
 * that does (a red outline goes from shade 4 to shade 9, still red); else the last shade moved
 * toward black or white just far enough.
 */
function readableLabel(label: Label, toward: string): string {
  const passes = (hex: string) => label.fills.every((fill) => contrastRatio(hex, fill) >= TEXT_MIN_CONTRAST);
  const candidates = [label.text, ...(label.shades ?? [])];
  const found = candidates.find(passes);
  return found ?? liftUntil(candidates[candidates.length - 1], toward, label.fills, TEXT_MIN_CONTRAST);
}

function primaryShade(theme: MantineTheme, isLight: boolean): number {
  const shade = theme.primaryShade;
  return typeof shade === 'number' ? shade : shade[isLight ? 'light' : 'dark'];
}

/** The colour Mantine paints a palette colour's label with, and every fill it can sit on. */
function paletteLabel(shades: readonly string[], variant: string, shade: number, isLight: boolean, backdrops: string[]): Label {
  const tinted = (hex: string, alpha: number) => backdrops.map((bg) => lerpHex(bg, hex, alpha));
  if (variant === 'outline') {
    const index = isLight ? shade : Math.max(shade - 4, 0);
    const text = shades[index];
    // Light schemes darken through shades 5..9; dark schemes are already at the lightest shade.
    const further = isLight ? shades.slice(index + 1) : [];
    return { text, shades: further, fills: [...backdrops, ...tinted(text, OUTLINE_HOVER_ALPHA)] };
  }
  const text = shades[isLight ? 9 : 0];
  // Mantine's light fill: shades 1 and 2 in a light scheme, shade 9 darkened by .5 and .3 in a dark one.
  const lightFills = isLight ? [shades[1], shades[2]] : [lerpHex(shades[9], '#000000', 0.5), lerpHex(shades[9], '#000000', 0.3)];
  if (variant === 'light') return { text, fills: lightFills };
  if (variant === 'subtle') return { text, fills: [...backdrops, lightFills[1]] };
  return { text, fills: backdrops };
}

/** A status token's label: the token itself, over its own tint (light, subtle hover) or the page. */
function tokenLabel(hex: string, variant: string, backdrops: string[]): Label {
  const tinted = (alpha: number) => backdrops.map((bg) => lerpHex(bg, hex, alpha));
  if (variant === 'light') return { text: hex, fills: [...tinted(LIGHT_ALPHA), ...tinted(LIGHT_HOVER_ALPHA)] };
  if (variant === 'subtle') return { text: hex, fills: [...backdrops, ...tinted(LIGHT_HOVER_ALPHA)] };
  if (variant === 'outline') return { text: hex, fills: [...backdrops, ...tinted(OUTLINE_HOVER_ALPHA)] };
  return { text: hex, fills: backdrops };
}

function labelOf(input: VariantColorsResolverInput, def: ThemeDef, backdrops: string[]): Label | null {
  const { color, theme, variant } = input;
  if (!color) return null;
  const isLight = def.light === true;
  const status = STATUS_TOKEN.exec(color);
  if (status) return tokenLabel(def.colors[status[1] as 'success' | 'warning' | 'error'], variant, backdrops);
  const parsed = parseThemeColor({ color, theme });
  // The brand colour has its own light variant (cssVariablesResolver's brandLightVars).
  if (!parsed.isThemeColor || parsed.shade !== undefined || parsed.color === theme.primaryColor) return null;
  const shades = theme.colors[parsed.color];
  if (!shades) return null;
  return paletteLabel(shades, variant, primaryShade(theme, isLight), isLight, backdrops);
}

/**
 * Mantine's label colours for palette colours and status tokens in the light, subtle, transparent
 * and outline variants, moved toward black (light themes) or white (dark ones) just far enough to
 * reach 4.5:1 on every fill they sit on (WCAG 1.4.3). Unmoved, the red
 * outline button is 2.18:1 (shade 4 on white), the green step-category badge 3.81:1 and the
 * "signed in" success badge 4.18:1. The hue stays; only the lightness moves, and a label that
 * already passes is left exactly as Mantine wrote it. Palette colours are not re-registered: the
 * same red still marks a delete action, the same green a category.
 */
export function readableVariantColors(def: ThemeDef): VariantColorsResolver {
  const toward = def.light === true ? '#000000' : '#ffffff';
  const backdrops = Object.values(themeBackdrops(def.colors, backdropSurfaces(def)));
  return (input) => {
    const result = defaultVariantColorsResolver(input);
    if (!TEXT_VARIANTS.has(input.variant)) return result;
    const label = labelOf(input, def, backdrops);
    if (!label) return result;
    const text = readableLabel(label, toward);
    if (text === label.text) return result;
    return {
      ...result,
      color: text,
      border: input.variant === 'outline' ? `${rem(1)} solid ${text}` : result.border,
    };
  };
}

import {
  createTheme, luminance, type MantineColorsTuple, type MantineThemeOverride, type VariantColorsResolver,
} from '@mantine/core';
import { themeDef, type Theme, type ThemeDef } from '../../../shared/themes';
import { contrastRatio, lerpHex } from './colorUtils';
import { BACKDROP_OPACITY, TEXT_MIN_CONTRAST, liftUntil } from './cssVariablesResolver';
import { readableVariantColors } from './variantColors';

/** Mantine's autoContrast cut-off: a filled colour lighter than this gets a black label, else white. */
const LUMINANCE_THRESHOLD = 0.3;
/** The palette slot of a filled control at rest; Mantine hovers it with the next one. */
const FILLED_SHADE = 4;

function generateColors(accent: string): MantineColorsTuple {
  return [
    lerpHex(accent, '#ffffff', 0.85),
    lerpHex(accent, '#ffffff', 0.65),
    lerpHex(accent, '#ffffff', 0.45),
    lerpHex(accent, '#ffffff', 0.25),
    accent,
    lerpHex(accent, '#000000', 0.20),
    lerpHex(accent, '#000000', 0.38),
    lerpHex(accent, '#000000', 0.55),
    lerpHex(accent, '#000000', 0.70),
    lerpHex(accent, '#000000', 0.83),
  ] as unknown as MantineColorsTuple;
}

/**
 * The fill of brand buttons and a selected segment (`AppSegmentedControl`): the theme's button
 * accent where the label autoContrast picks for it (black above the threshold, else white) reads
 * at 4.5:1 at rest and hovered, else darkened just far enough for white. Solarized's #268bd2 gets
 * white at 3.68:1, Nord's #4698af 3.30:1, Cyberpunk's #008a99 4.12:1.
 */
export function brandFill(def: ThemeDef): string {
  const accent = def.buttonAccent ?? def.colors.accent;
  const label = luminance(accent) > LUMINANCE_THRESHOLD ? '#000000' : '#ffffff';
  const shades = generateColors(accent);
  const readable = [shades[FILLED_SHADE], shades[FILLED_SHADE + 1]].every((fill) => contrastRatio(label, fill) >= TEXT_MIN_CONTRAST);
  return readable ? accent : liftUntil(accent, '#000000', ['#ffffff'], TEXT_MIN_CONTRAST);
}

export { BACKDROP_OPACITY };

/** The `Kbd` variant of a secondary keycap (ShortcutHint `muted`). */
export const KBD_SECONDARY = 'secondary';

/** Default width cap of a multiline tooltip that sets no `maw` of its own. */
export const TOOLTIP_MAX_WIDTH = '20rem';

const baseTheme: MantineThemeOverride = {
  autoContrast: true,
  luminanceThreshold: LUMINANCE_THRESHOLD,
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  // Mantine and application text share one rem scale. The document's default stays at 1rem.
  fontSizes: {
    xs: 'var(--font-size-sm)',
    sm: 'var(--font-size-md)',
  },
  radius: {
    lg: 'var(--radius-lg)',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    // A multiline tooltip is as wide as its text, up to a cap. With Mantine's auto width it is
    // squeezed into whatever room is left right of where it opens: near a window edge, a label
    // that grows after opening (a loader, then the text) opens narrow and tall, then creeps to its
    // width over ~30 frames. A call site's `maw` still wins over the default cap (inline style).
    Tooltip: {
      defaultProps: {
        openDelay: 450,
      },
      styles: (_theme: unknown, props: { multiline?: boolean }) => (props.multiline
        ? { tooltip: { width: 'max-content', maxWidth: TOOLTIP_MAX_WIDTH, overflowWrap: 'anywhere' } }
        : {}),
    },
    Modal: {
      defaultProps: {
        overlayProps: { backgroundOpacity: BACKDROP_OPACITY },
      },
    },
    // Mantine's Badge.css uppercases, bolds and letter-spaces every badge; Yobi's are sentence
    // case. `styles` (not defaultProps `tt`/`fw`) so a call site's own `style` still wins.
    Badge: {
      defaultProps: {
        radius: 'sm',
      },
      styles: {
        root: { textTransform: 'none', letterSpacing: 'normal', fontWeight: 500 },
      },
    },
    // Every Anchor sits in running text (settings descriptions, notices, previews): underlined, so a
    // link is not told apart by colour alone (WCAG 1.4.1). A call site may still pass `underline`.
    Anchor: {
      defaultProps: {
        underline: 'always',
      },
    },
    // Keycaps (ShortcutHint): one look, set once. A secondary combo is told apart by an empty cap,
    // never by opacity: muted text at 0.55 opacity falls to 3.26:1 (WCAG 1.4.3).
    Kbd: {
      styles: (_theme: unknown, props: { variant?: string }) => ({
        root: {
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 500,
          lineHeight: 1.4,
          color: 'var(--text-muted)',
          backgroundColor: props.variant === KBD_SECONDARY ? 'transparent' : 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px 5px',
          boxShadow: 'none',
        },
      }),
    },
    ScrollArea: {
      defaultProps: {
        scrollbarSize: 6,
        type: 'auto',
      },
    },
  },
};

export interface YobiMantineTheme {
  theme: MantineThemeOverride;
  colorScheme: 'light' | 'dark';
}

/** The shared settings with a brand palette, a label resolver and any extra component overrides. */
export function buildMantineTheme(
  brand: MantineColorsTuple,
  variantColorResolver: VariantColorsResolver,
  components: MantineThemeOverride['components'] = {},
): MantineThemeOverride {
  return createTheme({
    ...baseTheme,
    primaryColor: 'brand',
    primaryShade: FILLED_SHADE,
    variantColorResolver,
    colors: { brand },
    components: { ...baseTheme.components, ...components },
  });
}

/** The brand palette a Yobi theme's filled controls are drawn from. */
export function brandPalette(def: ThemeDef): MantineColorsTuple {
  return generateColors(brandFill(def));
}

/**
 * One Yobi theme as a self-contained Mantine theme, every colour resolved to a hex: the reference
 * the live theme (`liveTheme.ts`) is projected from and checked against, and the theme tests
 * render with. The window itself never swaps it in: see `APP_MANTINE_THEME`.
 */
export function getMantineTheme(yobiTheme: Theme): YobiMantineTheme {
  const def = themeDef(yobiTheme);
  const theme = buildMantineTheme(brandPalette(def), readableVariantColors(def));
  return { theme, colorScheme: def.light === true ? 'light' : 'dark' };
}

import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';
import { themeDef, type Theme } from '../../../shared/themes';
import { lerpHex } from './colorUtils';

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

const baseTheme: MantineThemeOverride = {
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  // Mantine ships a `fontSizes`/`radius` scale under the SAME key names as the CSS-var
  // scale in globals.css but with different values, so `fz="sm"` and `fz="var(--font-size-sm)"`
  // rendered 14px and 12px — which of the two a component got came down to the spelling its
  // author happened to reach for. These point the colliding keys at the CSS-var scale using
  // the pixel values Mantine already renders today, so the change moves nothing on screen and
  // only removes the ambiguity.
  //
  // `md` is deliberately left out: --mantine-font-size-md is the document base size and the
  // fallback for every <Text> without an explicit size, so remapping it shrinks the whole app
  // (see the note above the font-size scale in globals.css).
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
    Tooltip: {
      defaultProps: {
        openDelay: 450,
      },
    },
    Modal: {
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.5, blur: 3 },
      },
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

export function getMantineTheme(yobiTheme: Theme): YobiMantineTheme {
  const def = themeDef(yobiTheme);

  const theme = createTheme({
    ...baseTheme,
    primaryColor: 'brand',
    primaryShade: 4,
    colors: {
      brand: generateColors(def.buttonAccent ?? def.colors.accent),
    },
  });

  return { theme, colorScheme: def.light === true ? 'light' : 'dark' };
}

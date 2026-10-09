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
  // Mantine's `fontSizes`/`radius` keys collide with the CSS-var scale in globals.css; point the
  // colliding keys at that scale, at the pixel values Mantine already renders.
  // `md` is left out: it is the document base size and the default <Text> size, so remapping it
  // would shrink the whole app.
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
        overlayProps: { backgroundOpacity: 0.55 },
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

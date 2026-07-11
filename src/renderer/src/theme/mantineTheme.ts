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
  // Pale accents (catppuccin, everforest, amoled) get dark text on filled
  // buttons instead of unreadable white-on-pastel. Threshold must stay in sync
  // with ON_ACCENT_LUMINANCE_THRESHOLD in cssVariablesResolver.ts.
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  defaultRadius: 'md',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Tooltip: {
      defaultProps: {
        openDelay: 450,
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

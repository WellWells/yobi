import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';
import type { Theme } from '../store/themeStore';
import { lerpHex } from './colorUtils';
import { LIGHT_THEMES } from './cssVariablesResolver';

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

const colorTuples: Record<Theme, MantineColorsTuple> = {
  dark:        generateColors('#0969da'),
  light:       generateColors('#0969da'),
  dracula:     generateColors('#8434f4'),
  nord:        generateColors('#4698af'),
  amoled:      generateColors('#00b4d8'),
  sepia:       generateColors('#b5451b'),
  catppuccin:  generateColors('#cba6f7'),
  everforest:  generateColors('#a7c080'),
  rosepine:    generateColors('#b4637a'),
  gruvbox:     generateColors('#8b6304'),
  cyberpunk:   generateColors('#008a99'),
};

const baseTheme: MantineThemeOverride = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  fontFamilyMonospace: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  defaultRadius: 'md',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Tooltip: {
      defaultProps: {
        openDelay: 450,
      },
    },
    Button: {
      styles: {
        root: {
          '&:disabled': {
            opacity: 0.6,
          },
        },
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
  const colorScheme: 'light' | 'dark' = LIGHT_THEMES.includes(yobiTheme) ? 'light' : 'dark';

  const theme = createTheme({
    ...baseTheme,
    primaryColor: 'brand',
    primaryShade: 4,
    colors: {
      brand: colorTuples[yobiTheme],
    },
  });

  return { theme, colorScheme };
}

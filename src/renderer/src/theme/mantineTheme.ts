// src/renderer/src/theme/mantineTheme.ts

import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';
import type { Theme } from '../store/themeStore';
import { lerpHex } from './colorUtils';

// ── Color tuple generation ────────────────────────────────────────────────────
// Produces a 10-shade MantineColorsTuple from a single accent hex.
// Accent placed at index 4 (primaryShade). 0-3 → white, 5-9 → black.

function generateColors(accent: string): MantineColorsTuple {
  return [
    lerpHex(accent, '#ffffff', 0.85),  // 0 — very light
    lerpHex(accent, '#ffffff', 0.65),  // 1 — light
    lerpHex(accent, '#ffffff', 0.45),  // 2 — medium-light
    lerpHex(accent, '#ffffff', 0.25),  // 3 — slightly light
    accent,                            // 4 — accent (primaryShade)
    lerpHex(accent, '#000000', 0.20),  // 5 — slightly dark
    lerpHex(accent, '#000000', 0.38),  // 6 — medium-dark
    lerpHex(accent, '#000000', 0.55),  // 7 — dark
    lerpHex(accent, '#000000', 0.70),  // 8 — very dark
    lerpHex(accent, '#000000', 0.83),  // 9 — near black
  ] as unknown as MantineColorsTuple;
}

// ── One accent per theme — all tuples are auto-generated ─────────────────────

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

// ── Shared base theme ─────────────────────────────────────────────────────────

const baseTheme: MantineThemeOverride = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  fontFamilyMonospace: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  defaultRadius: 'md',
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
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

// ── Per-theme overrides ───────────────────────────────────────────────────────

export interface DacMantineTheme {
  theme: MantineThemeOverride;
  colorScheme: 'light' | 'dark';
}

const LIGHT_THEMES: readonly Theme[] = ['light', 'sepia', 'rosepine'];

export function getMantineTheme(dacTheme: Theme): DacMantineTheme {
  const colorScheme: 'light' | 'dark' = LIGHT_THEMES.includes(dacTheme) ? 'light' : 'dark';

  const theme = createTheme({
    ...baseTheme,
    primaryColor: 'brand',
    primaryShade: 4, // accent is always at index 4 in generateColors
    colors: {
      brand: colorTuples[dacTheme],
    },
  });

  return { theme, colorScheme };
}

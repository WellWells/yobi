import type { CardTheme } from './types';

export type CaptureBackgroundStyle = 'solid' | 'gradient' | 'silk';

export const CAPTURE_BACKGROUND_STYLES: readonly CaptureBackgroundStyle[] = ['solid', 'gradient', 'silk'];

export type CapturePaletteGroup = 'light' | 'dark' | 'vivid';

export const CAPTURE_PALETTE_GROUPS: readonly CapturePaletteGroup[] = ['light', 'dark', 'vivid'];

export interface CapturePalette {
  key: string;
  label: string;
  card: CardTheme;
  group: CapturePaletteGroup;
  solid: string;
  gradient: readonly [string, string];
  /** Silk, in order: base, two sheets, glow (the dark sheen), the corner the base starts from. */
  silk: readonly [string, string, string, string, string];
}

export const CAPTURE_PALETTES = [
  {
    key: 'linen', label: 'Linen', card: 'light', group: 'light',
    solid: '#ffffff',
    gradient: ['#f1f5f9', '#e2e8f0'],
    silk: ['#ffffff', '#f1f5f9', '#e2e8f0', '#e0e7ff', '#cbd5e1'],
  },
  {
    key: 'dawn', label: 'Dawn', card: 'light', group: 'light',
    solid: '#fff1f2',
    gradient: ['#ffe4e6', '#e0e7ff'],
    silk: ['#fff1f2', '#fecdd3', '#fed7aa', '#e0e7ff', '#fbcfe8'],
  },
  {
    key: 'mist', label: 'Mist', card: 'light', group: 'light',
    solid: '#f0f9ff',
    gradient: ['#e0f2fe', '#ede9fe'],
    silk: ['#f0f9ff', '#bae6fd', '#c7d2fe', '#a5f3fc', '#ddd6fe'],
  },
  {
    key: 'sky', label: 'Sky', card: 'light', group: 'light',
    solid: '#eff6ff',
    gradient: ['#dbeafe', '#bae6fd'],
    silk: ['#eff6ff', '#bfdbfe', '#a5f3fc', '#ddd6fe', '#bae6fd'],
  },
  {
    key: 'sage', label: 'Sage', card: 'light', group: 'light',
    solid: '#f0fdf4',
    gradient: ['#dcfce7', '#d1fae5'],
    silk: ['#f0fdf4', '#bbf7d0', '#d9f99d', '#a7f3d0', '#bae6fd'],
  },
  {
    key: 'sand', label: 'Sand', card: 'light', group: 'light',
    solid: '#fffbeb',
    gradient: ['#fef3c7', '#fed7aa'],
    silk: ['#fffbeb', '#fde68a', '#fed7aa', '#fecaca', '#d9f99d'],
  },
  {
    key: 'peach', label: 'Peach', card: 'light', group: 'light',
    solid: '#fff7ed',
    gradient: ['#ffedd5', '#fecdd3'],
    silk: ['#fff7ed', '#fed7aa', '#fecdd3', '#fde68a', '#ddd6fe'],
  },
  {
    key: 'lavender', label: 'Lavender', card: 'light', group: 'light',
    solid: '#faf5ff',
    gradient: ['#ede9fe', '#f5d0fe'],
    silk: ['#faf5ff', '#ddd6fe', '#f5d0fe', '#bfdbfe', '#fbcfe8'],
  },
  {
    key: 'aurora', label: 'Aurora', card: 'dark', group: 'dark',
    solid: '#0b1220',
    gradient: ['#0f172a', '#3b0764'],
    silk: ['#0b1220', '#1e3a8a', '#6d28d9', '#0e7490', '#4c1d95'],
  },
  {
    key: 'ocean', label: 'Ocean', card: 'dark', group: 'dark',
    solid: '#071a2b',
    gradient: ['#0c4a6e', '#1e293b'],
    silk: ['#071a2b', '#0369a1', '#0e7490', '#1d4ed8', '#155e75'],
  },
  {
    key: 'mint', label: 'Mint', card: 'dark', group: 'dark',
    solid: '#08201e',
    gradient: ['#0f766e', '#1f2937'],
    silk: ['#08201e', '#0f766e', '#047857', '#0e7490', '#4d7c0f'],
  },
  {
    key: 'forest', label: 'Forest', card: 'dark', group: 'dark',
    solid: '#06170e',
    gradient: ['#14532d', '#1f2937'],
    silk: ['#06170e', '#15803d', '#4d7c0f', '#0f766e', '#166534'],
  },
  {
    key: 'violet', label: 'Violet', card: 'dark', group: 'dark',
    solid: '#12082a',
    gradient: ['#312e81', '#4a044e'],
    silk: ['#12082a', '#6d28d9', '#a21caf', '#4338ca', '#7e22ce'],
  },
  {
    key: 'rose', label: 'Rose', card: 'dark', group: 'dark',
    solid: '#1a0a0a',
    gradient: ['#7f1d1d', '#312e81'],
    silk: ['#1a0a0a', '#be123c', '#9f1239', '#7e22ce', '#b91c1c'],
  },
  {
    key: 'sunset', label: 'Sunset', card: 'dark', group: 'dark',
    solid: '#1c0f06',
    gradient: ['#7c2d12', '#4338ca'],
    silk: ['#1c0f06', '#c2410c', '#b45309', '#be123c', '#7c2d12'],
  },
  {
    key: 'ember', label: 'Ember', card: 'dark', group: 'dark',
    solid: '#1a0808',
    gradient: ['#7f1d1d', '#111827'],
    silk: ['#1a0808', '#b91c1c', '#c2410c', '#7f1d1d', '#991b1b'],
  },
  {
    key: 'steel', label: 'Steel', card: 'dark', group: 'dark',
    solid: '#0b1120',
    gradient: ['#334155', '#111827'],
    silk: ['#0b1120', '#334155', '#1e40af', '#0f766e', '#475569'],
  },
  {
    key: 'citrus', label: 'Citrus', card: 'light', group: 'vivid',
    solid: '#16a34a',
    gradient: ['#22c55e', '#06b6d4'],
    silk: ['#16a34a', '#4ade80', '#fef08a', '#22d3ee', '#0d9488'],
  },
  {
    key: 'bubblegum', label: 'Bubblegum', card: 'light', group: 'vivid',
    solid: '#db2777',
    gradient: ['#ec4899', '#f97316'],
    silk: ['#db2777', '#fb923c', '#f9a8d4', '#a78bfa', '#fde047'],
  },
  {
    key: 'nebula', label: 'Nebula', card: 'light', group: 'vivid',
    solid: '#4338ca',
    gradient: ['#6366f1', '#a855f7'],
    silk: ['#4338ca', '#60a5fa', '#c084fc', '#f472b6', '#22d3ee'],
  },
] as const satisfies readonly CapturePalette[];

export const DEFAULT_CAPTURE_PALETTE = 'linen';
export const DEFAULT_CAPTURE_BACKGROUND_STYLE: CaptureBackgroundStyle = 'gradient';

export type CaptureDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'c';

/**
 * The picker's 3x3 grid, in reading order: a cell's place in the grid is the direction it means.
 * Keys only — the picker draws each one as an icon; this module stays free of React.
 */
export const CAPTURE_DIRECTIONS = [
  'nw', 'n', 'ne',
  'w', 'c', 'e',
  'sw', 's', 'se',
] as const satisfies readonly CaptureDirection[];

const DIRECTION_ANGLES: Record<Exclude<CaptureDirection, 'c'>, number> = {
  n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
};

/**
 * Styles that were retired, and the one that took their place. Saved settings, flow steps and
 * quick-export picks keep the old key; reading it through here gives the replacement instead of
 * silently dropping back to the default. Mesh (five radial blooms) gave way to silk:
 * silk looks better side by side, and a radial bloom stretches into an ellipse on a
 * tall card.
 */
const RETIRED_STYLES: Readonly<Record<string, CaptureBackgroundStyle>> = { mesh: 'silk' };

/** A saved style key as a current style; null when it is neither current nor retired. */
export function captureBackgroundStyleOf(value: unknown): CaptureBackgroundStyle | null {
  if (typeof value !== 'string') return null;
  if ((CAPTURE_BACKGROUND_STYLES as readonly string[]).includes(value)) return value as CaptureBackgroundStyle;
  return RETIRED_STYLES[value] ?? null;
}

/**
 * Film grain for the silk background: an SVG noise filter, not a bitmap. Chromium renders it at
 * whatever size and pixel ratio the card is drawn, and it tiles seamlessly (`stitchTiles`). Grey
 * noise at 7% opacity breaks up the banding a smooth gradient shows in an 8-bit PNG.
 */
const GRAIN_TILE_PX = 180;

const GRAIN_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${GRAIN_TILE_PX}' height='${GRAIN_TILE_PX}'>` +
  `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/>` +
  `<feColorMatrix values='2 0 0 0 -.5  2 0 0 0 -.5  2 0 0 0 -.5  0 0 0 0 .07'/></filter>` +
  `<rect width='100%' height='100%' filter='url(#g)'/></svg>`;

/** The one `url()` the capture background guard lets through: this exact string, nothing else. */
export const CAPTURE_GRAIN_LAYER = `url(data:image/svg+xml;base64,${btoa(GRAIN_SVG)})`;

const GRAIN_BACKGROUND = `${CAPTURE_GRAIN_LAYER} 0 0/${GRAIN_TILE_PX}px ${GRAIN_TILE_PX}px`;

/**
 * The background without its grain, for PDF. A PDF's backdrop is baked into one small JPEG and
 * stretched over the page (vector gradients made readers crawl), and grain survives that
 * downscale → JPEG → upscale only as blotches. The grain exists to break up 8-bit banding in a
 * PNG; the JPEG has nothing for it to fix.
 */
export function withoutCaptureGrain(css: string): string {
  return css.split(`${GRAIN_BACKGROUND}, `).join('');
}

/** Silk is lit from one fixed angle; the compass grid stays a plain gradient's control. */
const SILK_ANGLE = 135;

/**
 * Silk: a soft diagonal sheen over two tinted sheets and a three-stop base, all linear gradients.
 * A linear gradient keeps its angle at any aspect ratio, so a card of any length gets the same
 * look — a radial bloom stretches into an ellipse on a tall card. Dark palettes take the
 * sheen from their own accent and sink further into the base colour; a white sheen there reads
 * as plastic.
 */
function silkBackgroundCss(palette: CapturePalette): string {
  const [base, sheetA, sheetB, glow, start] = palette.silk;
  const dark = palette.group === 'dark';
  const sheen = dark ? glow : '#ffffff';
  const layers = [
    GRAIN_BACKGROUND,
    `linear-gradient(${SILK_ANGLE - 20}deg, transparent 36%, ${sheen}${dark ? '99' : 'b3'} 55%, ${sheen}33 66%, transparent 78%)`,
    `linear-gradient(${SILK_ANGLE + 65}deg, ${sheetA} 0%, transparent 50%)`,
    `linear-gradient(${SILK_ANGLE - 80}deg, ${sheetB} 0%, transparent 55%)`,
    dark
      ? `linear-gradient(${SILK_ANGLE}deg, ${start} 0%, ${base} 70%, ${glow} 130%)`
      : `linear-gradient(${SILK_ANGLE}deg, ${start} 0%, ${base} 55%, ${glow} 100%)`,
  ];
  return layers.join(', ');
}

export function paletteOf(key: string): CapturePalette {
  return CAPTURE_PALETTES.find((p) => p.key === key) ?? CAPTURE_PALETTES[0];
}

export function captureBackgroundCss(
  paletteKey: string,
  style: CaptureBackgroundStyle = DEFAULT_CAPTURE_BACKGROUND_STYLE,
  direction: CaptureDirection = 'se',
): string {
  const palette = paletteOf(paletteKey);

  const resolved = captureBackgroundStyleOf(style) ?? DEFAULT_CAPTURE_BACKGROUND_STYLE;

  if (resolved === 'solid') return palette.solid;

  if (resolved === 'silk') return silkBackgroundCss(palette);

  const [from, to] = palette.gradient;
  if (direction === 'c') return `radial-gradient(circle at center, ${from} 0%, ${to} 100%)`;
  return `linear-gradient(${DIRECTION_ANGLES[direction]}deg, ${from} 0%, ${to} 100%)`;
}

export function paletteCardTheme(key: string): CardTheme {
  return paletteOf(key).card;
}

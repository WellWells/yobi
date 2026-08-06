import type { CardTheme } from './types';

export type CaptureBackgroundStyle = 'solid' | 'gradient' | 'mesh';

export const CAPTURE_BACKGROUND_STYLES: readonly CaptureBackgroundStyle[] = ['solid', 'gradient', 'mesh'];

export type CapturePaletteGroup = 'light' | 'dark' | 'vivid';

export const CAPTURE_PALETTE_GROUPS: readonly CapturePaletteGroup[] = ['light', 'dark', 'vivid'];

export interface CapturePalette {
  key: string;
  label: string;
  card: CardTheme;
  group: CapturePaletteGroup;
  solid: string;
  gradient: readonly [string, string];
  mesh: readonly [string, string, string, string, string];
}

export const CAPTURE_PALETTES = [
  {
    key: 'linen', label: 'Linen', card: 'light', group: 'light',
    solid: '#ffffff',
    gradient: ['#f1f5f9', '#e2e8f0'],
    mesh: ['#ffffff', '#f1f5f9', '#e2e8f0', '#e0e7ff', '#cbd5e1'],
  },
  {
    key: 'dawn', label: 'Dawn', card: 'light', group: 'light',
    solid: '#fff1f2',
    gradient: ['#ffe4e6', '#e0e7ff'],
    mesh: ['#fff1f2', '#fecdd3', '#fed7aa', '#e0e7ff', '#fbcfe8'],
  },
  {
    key: 'mist', label: 'Mist', card: 'light', group: 'light',
    solid: '#f0f9ff',
    gradient: ['#e0f2fe', '#ede9fe'],
    mesh: ['#f0f9ff', '#bae6fd', '#c7d2fe', '#a5f3fc', '#ddd6fe'],
  },
  {
    key: 'sky', label: 'Sky', card: 'light', group: 'light',
    solid: '#eff6ff',
    gradient: ['#dbeafe', '#bae6fd'],
    mesh: ['#eff6ff', '#bfdbfe', '#a5f3fc', '#ddd6fe', '#bae6fd'],
  },
  {
    key: 'sage', label: 'Sage', card: 'light', group: 'light',
    solid: '#f0fdf4',
    gradient: ['#dcfce7', '#d1fae5'],
    mesh: ['#f0fdf4', '#bbf7d0', '#d9f99d', '#a7f3d0', '#bae6fd'],
  },
  {
    key: 'sand', label: 'Sand', card: 'light', group: 'light',
    solid: '#fffbeb',
    gradient: ['#fef3c7', '#fed7aa'],
    mesh: ['#fffbeb', '#fde68a', '#fed7aa', '#fecaca', '#d9f99d'],
  },
  {
    key: 'peach', label: 'Peach', card: 'light', group: 'light',
    solid: '#fff7ed',
    gradient: ['#ffedd5', '#fecdd3'],
    mesh: ['#fff7ed', '#fed7aa', '#fecdd3', '#fde68a', '#ddd6fe'],
  },
  {
    key: 'lavender', label: 'Lavender', card: 'light', group: 'light',
    solid: '#faf5ff',
    gradient: ['#ede9fe', '#f5d0fe'],
    mesh: ['#faf5ff', '#ddd6fe', '#f5d0fe', '#bfdbfe', '#fbcfe8'],
  },
  {
    key: 'aurora', label: 'Aurora', card: 'dark', group: 'dark',
    solid: '#0b1220',
    gradient: ['#0f172a', '#3b0764'],
    mesh: ['#0b1220', '#1e3a8a', '#6d28d9', '#0e7490', '#4c1d95'],
  },
  {
    key: 'ocean', label: 'Ocean', card: 'dark', group: 'dark',
    solid: '#071a2b',
    gradient: ['#0c4a6e', '#1e293b'],
    mesh: ['#071a2b', '#0369a1', '#0e7490', '#1d4ed8', '#155e75'],
  },
  {
    key: 'mint', label: 'Mint', card: 'dark', group: 'dark',
    solid: '#08201e',
    gradient: ['#0f766e', '#1f2937'],
    mesh: ['#08201e', '#0f766e', '#047857', '#0e7490', '#4d7c0f'],
  },
  {
    key: 'forest', label: 'Forest', card: 'dark', group: 'dark',
    solid: '#06170e',
    gradient: ['#14532d', '#1f2937'],
    mesh: ['#06170e', '#15803d', '#4d7c0f', '#0f766e', '#166534'],
  },
  {
    key: 'violet', label: 'Violet', card: 'dark', group: 'dark',
    solid: '#12082a',
    gradient: ['#312e81', '#4a044e'],
    mesh: ['#12082a', '#6d28d9', '#a21caf', '#4338ca', '#7e22ce'],
  },
  {
    key: 'rose', label: 'Rose', card: 'dark', group: 'dark',
    solid: '#1a0a0a',
    gradient: ['#7f1d1d', '#312e81'],
    mesh: ['#1a0a0a', '#be123c', '#9f1239', '#7e22ce', '#b91c1c'],
  },
  {
    key: 'sunset', label: 'Sunset', card: 'dark', group: 'dark',
    solid: '#1c0f06',
    gradient: ['#7c2d12', '#4338ca'],
    mesh: ['#1c0f06', '#c2410c', '#b45309', '#be123c', '#7c2d12'],
  },
  {
    key: 'ember', label: 'Ember', card: 'dark', group: 'dark',
    solid: '#1a0808',
    gradient: ['#7f1d1d', '#111827'],
    mesh: ['#1a0808', '#b91c1c', '#c2410c', '#7f1d1d', '#991b1b'],
  },
  {
    key: 'steel', label: 'Steel', card: 'dark', group: 'dark',
    solid: '#0b1120',
    gradient: ['#334155', '#111827'],
    mesh: ['#0b1120', '#334155', '#1e40af', '#0f766e', '#475569'],
  },
  {
    key: 'citrus', label: 'Citrus', card: 'light', group: 'vivid',
    solid: '#16a34a',
    gradient: ['#22c55e', '#06b6d4'],
    mesh: ['#16a34a', '#4ade80', '#fef08a', '#22d3ee', '#0d9488'],
  },
  {
    key: 'bubblegum', label: 'Bubblegum', card: 'light', group: 'vivid',
    solid: '#db2777',
    gradient: ['#ec4899', '#f97316'],
    mesh: ['#db2777', '#fb923c', '#f9a8d4', '#a78bfa', '#fde047'],
  },
  {
    key: 'nebula', label: 'Nebula', card: 'light', group: 'vivid',
    solid: '#4338ca',
    gradient: ['#6366f1', '#a855f7'],
    mesh: ['#4338ca', '#60a5fa', '#c084fc', '#f472b6', '#22d3ee'],
  },
] as const satisfies readonly CapturePalette[];

export const DEFAULT_CAPTURE_PALETTE = 'linen';
export const DEFAULT_CAPTURE_BACKGROUND_STYLE: CaptureBackgroundStyle = 'gradient';

export type CaptureDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'c';

export const CAPTURE_DIRECTIONS: readonly (readonly [CaptureDirection, string])[] = [
  ['nw', '↖'], ['n', '↑'], ['ne', '↗'],
  ['w', '←'], ['c', '●'], ['e', '→'],
  ['sw', '↙'], ['s', '↓'], ['se', '↘'],
] as const;

const DIRECTION_ANGLES: Record<Exclude<CaptureDirection, 'c'>, number> = {
  n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
};

const MESH_BLOOMS: readonly (readonly [x: number, y: number, bloom: number, reach: number])[] = [
  [18, 22, 1, 55],
  [84, 14, 2, 52],
  [12, 84, 3, 50],
  [88, 78, 4, 46],
  [50, 46, 2, 62],
];

export function paletteOf(key: string): CapturePalette {
  return CAPTURE_PALETTES.find((p) => p.key === key) ?? CAPTURE_PALETTES[0];
}

export function captureBackgroundCss(
  paletteKey: string,
  style: CaptureBackgroundStyle = DEFAULT_CAPTURE_BACKGROUND_STYLE,
  direction: CaptureDirection = 'se',
): string {
  const palette = paletteOf(paletteKey);

  if (style === 'solid') return palette.solid;

  if (style === 'mesh') {
    const blooms = MESH_BLOOMS.map(
      ([x, y, bloom, reach]) =>
        `radial-gradient(at ${x}% ${y}%, ${palette.mesh[bloom]} 0px, transparent ${reach}%)`,
    );
    return `${blooms.join(', ')}, ${palette.mesh[0]}`;
  }

  const [from, to] = palette.gradient;
  if (direction === 'c') return `radial-gradient(circle at center, ${from} 0%, ${to} 100%)`;
  return `linear-gradient(${DIRECTION_ANGLES[direction]}deg, ${from} 0%, ${to} 100%)`;
}

export function paletteCardTheme(key: string): CardTheme {
  return paletteOf(key).card;
}

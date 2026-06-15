import type { CardTheme } from './types';

export const CAPTURE_PALETTES = [
  { key: 'aurora', label: 'Aurora', from: '#0f172a', to: '#3b0764', card: 'dark' },
  { key: 'mint',   label: 'Mint',   from: '#0f766e', to: '#1f2937', card: 'dark' },
  { key: 'rose',   label: 'Rose',   from: '#7f1d1d', to: '#312e81', card: 'dark' },
  { key: 'ocean',  label: 'Ocean',  from: '#0c4a6e', to: '#1e293b', card: 'dark' },
  { key: 'sunset', label: 'Sunset', from: '#7c2d12', to: '#4338ca', card: 'dark' },
  { key: 'forest', label: 'Forest', from: '#14532d', to: '#1f2937', card: 'dark' },
  { key: 'violet', label: 'Violet', from: '#312e81', to: '#4a044e', card: 'dark' },
  { key: 'steel',  label: 'Steel',  from: '#334155', to: '#111827', card: 'dark' },
  { key: 'ember',  label: 'Ember',  from: '#7f1d1d', to: '#111827', card: 'dark' },
  { key: 'dawn',     label: 'Dawn',     from: '#ffe4e6', to: '#e0e7ff', card: 'light' },
  { key: 'mist',     label: 'Mist',     from: '#e0f2fe', to: '#ede9fe', card: 'light' },
  { key: 'sand',     label: 'Sand',     from: '#fef3c7', to: '#fed7aa', card: 'light' },
  { key: 'sage',     label: 'Sage',     from: '#dcfce7', to: '#d1fae5', card: 'light' },
  { key: 'sky',      label: 'Sky',      from: '#dbeafe', to: '#bae6fd', card: 'light' },
  { key: 'peach',    label: 'Peach',    from: '#ffedd5', to: '#fecdd3', card: 'light' },
  { key: 'lavender', label: 'Lavender', from: '#ede9fe', to: '#f5d0fe', card: 'light' },
  { key: 'linen',    label: 'Linen',    from: '#f1f5f9', to: '#e2e8f0', card: 'light' },
] as const satisfies readonly { key: string; label: string; from: string; to: string; card: CardTheme }[];

export type CaptureDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'c';

export function buildCaptureBackground(from: string, to: string, direction: CaptureDirection): string {
  if (direction === 'c') return `radial-gradient(circle at center, ${from} 0%, ${to} 100%)`;
  const angleMap: Record<Exclude<CaptureDirection, 'c'>, number> = {
    n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
  };
  return `linear-gradient(${angleMap[direction]}deg, ${from} 0%, ${to} 100%)`;
}

export function paletteCardTheme(key: string): CardTheme {
  return (CAPTURE_PALETTES.find((p) => p.key === key) ?? CAPTURE_PALETTES[0]).card;
}

export function paletteBackground(key: string, direction: CaptureDirection = 'se'): string | null {
  const palette = CAPTURE_PALETTES.find((p) => p.key === key);
  return palette ? buildCaptureBackground(palette.from, palette.to, direction) : null;
}

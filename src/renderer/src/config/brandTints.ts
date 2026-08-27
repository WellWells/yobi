import { themeDef } from '../../../shared/themes';
import type { Theme } from '../../../shared/themes';

export const BRAND_HEX: Record<string, string> = {
  airtable: '#18BFFF',
  asana: '#FF5B4D',
  atlassian: '#0052CC',
  cloudflare: '#F38020',
  'cloudflare-docs': '#F38020',
  dropbox: '#0061FF',
  figma: '#F24E1E',
  github: '#181717',
  huggingface: '#FFD21E',
  intercom: '#6AFDEF',
  linear: '#5E6AD2',
  neon: '#34D59A',
  netlify: '#00C7B7',
  notion: '#000000',
  paypal: '#002991',
  sentry: '#362D59',
  square: '#3E4348',
  stripe: '#635BFF',
  supabase: '#3FCF8E',
  vercel: '#000000',
  webflow: '#146EF5',
  wix: '#0C6EFC',
  zapier: '#FF4F00',
};

export const CONTRAST_TARGET = 3;

const ACHROMATIC_MAX_SATURATION = 0.15;

interface Rgb { r: number; g: number; b: number }

export function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function luminance(rgb: Rgb): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function mix(from: Rgb, toward: Rgb, t: number): Rgb {
  return {
    r: from.r + (toward.r - from.r) * t,
    g: from.g + (toward.g - from.g) * t,
    b: from.b + (toward.b - from.b) * t,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const SEARCH_STEPS = 12;

export function readableTint(hex: string, backgroundHex: string): string | undefined {
  const brand = parseHex(hex);
  if (saturation(brand) < ACHROMATIC_MAX_SATURATION) return undefined;

  const background = parseHex(backgroundHex);
  if (contrastRatio(brand, background) >= CONTRAST_TARGET) return hex;

  const endpoint = contrastRatio(WHITE, background) >= contrastRatio(BLACK, background) ? WHITE : BLACK;
  const candidate = (t: number): string => toHex(mix(brand, endpoint, t));
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const middle = (low + high) / 2;
    if (contrastRatio(parseHex(candidate(middle)), background) >= CONTRAST_TARGET) high = middle;
    else low = middle;
  }
  return candidate(high);
}

export function tileBackground(theme: Theme): string {
  return themeDef(theme).colors.bgElevated;
}

export function brandTint(id: string, theme: Theme): string | undefined {
  const hex = BRAND_HEX[id];
  return hex ? readableTint(hex, tileBackground(theme)) : undefined;
}

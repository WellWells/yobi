import { themeDef } from '../../../shared/themes';
import type { Theme } from '../../../shared/themes';
import { contrastRatio, hexToRgb, lerpHex } from '../theme/colorUtils';

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

function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

const WHITE = '#ffffff';
const BLACK = '#000000';
const SEARCH_STEPS = 12;

export function readableTint(hex: string, backgroundHex: string): string | undefined {
  if (saturation(hexToRgb(hex)) < ACHROMATIC_MAX_SATURATION) return undefined;
  if (contrastRatio(hex, backgroundHex) >= CONTRAST_TARGET) return hex;

  const endpoint = contrastRatio(WHITE, backgroundHex) >= contrastRatio(BLACK, backgroundHex) ? WHITE : BLACK;
  const candidate = (t: number): string => lerpHex(hex, endpoint, t);
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const middle = (low + high) / 2;
    if (contrastRatio(candidate(middle), backgroundHex) >= CONTRAST_TARGET) high = middle;
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

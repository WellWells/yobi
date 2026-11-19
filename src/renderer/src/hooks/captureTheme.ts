import { DEFAULT_CARD_OPACITY, clampCardOpacity } from '../../../shared/types';
import type { CardTheme } from '../../../shared/types';
import { contrastRatio, hexToRgba, lerpHex } from '../theme/colorUtils';

export {
  CAPTURE_PALETTES,
  captureBackgroundCss,
  paletteCardTheme,
} from '../../../shared/capturePalettes';
export type { CaptureDirection, CaptureBackgroundStyle } from '../../../shared/capturePalettes';

export interface CaptureCardTokens {
  /** The card's own colour; how opaque it is comes from the request (`cardOpacity`). */
  cardBase: string;
  cardBorder: string;
  cardShadow: string;
  title: string;
  text: string;
  textSecondary: string;
  muted: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  promptBg: string;
  promptBorder: string;
  assistantBg: string;
  assistantBorder: string;
  link: string;
  quoteBorder: string;
  quoteBg: string;
  quoteText: string;
  tableBorder: string;
  tableHeadBg: string;
  inlineCodeBg: string;
  inlineCodeText: string;
}

export const CAPTURE_CARD_TOKENS: Record<CardTheme, CaptureCardTokens> = {
  dark: {
    cardBase: '#0d1117',
    cardBorder: 'rgba(201, 209, 217, 0.2)',
    cardShadow: '0 14px 42px rgba(0, 0, 0, 0.36)',
    title: '#f0f6fc',
    text: '#e6edf3',
    textSecondary: '#c9d1d9',
    muted: '#8b949e',
    chipBg: 'rgba(33, 38, 45, 0.9)',
    chipBorder: 'rgba(201, 209, 217, 0.25)',
    chipText: '#c9d1d9',
    promptBg: 'rgba(33, 38, 45, 0.8)',
    promptBorder: 'rgba(201, 209, 217, 0.18)',
    assistantBg: 'rgba(88, 166, 255, 0.12)',
    assistantBorder: 'rgba(88, 166, 255, 0.32)',
    link: '#58a6ff',
    quoteBorder: 'rgba(88, 166, 255, 0.85)',
    quoteBg: 'rgba(88, 166, 255, 0.09)',
    quoteText: '#c9d1d9',
    tableBorder: 'rgba(201, 209, 217, 0.2)',
    tableHeadBg: 'rgba(33, 38, 45, 0.8)',
    inlineCodeBg: 'rgba(33, 38, 45, 0.95)',
    inlineCodeText: '#7ee787',
  },
  light: {
    cardBase: '#ffffff',
    cardBorder: 'rgba(15, 23, 42, 0.12)',
    cardShadow: '0 14px 42px rgba(15, 23, 42, 0.18)',
    title: '#0f172a',
    text: '#1e293b',
    textSecondary: '#334155',
    muted: '#64748b',
    chipBg: 'rgba(15, 23, 42, 0.05)',
    chipBorder: 'rgba(15, 23, 42, 0.12)',
    chipText: '#334155',
    promptBg: 'rgba(15, 23, 42, 0.04)',
    promptBorder: 'rgba(15, 23, 42, 0.10)',
    assistantBg: 'rgba(37, 99, 235, 0.06)',
    assistantBorder: 'rgba(37, 99, 235, 0.22)',
    link: '#2563eb',
    quoteBorder: '#2563eb',
    quoteBg: 'rgba(37, 99, 235, 0.07)',
    quoteText: '#334155',
    tableBorder: 'rgba(15, 23, 42, 0.15)',
    tableHeadBg: 'rgba(15, 23, 42, 0.04)',
    inlineCodeBg: 'rgba(15, 23, 42, 0.06)',
    inlineCodeText: '#0f766e',
  },
};

const CARD_TOKEN_CSS_VARS: Record<keyof CaptureCardTokens, string> = {
  cardBase: '--cap-card-bg',
  cardBorder: '--cap-card-border',
  cardShadow: '--cap-card-shadow',
  title: '--cap-title',
  text: '--cap-text',
  textSecondary: '--cap-text-secondary',
  muted: '--cap-muted',
  chipBg: '--cap-chip-bg',
  chipBorder: '--cap-chip-border',
  chipText: '--cap-chip-text',
  promptBg: '--cap-prompt-bg',
  promptBorder: '--cap-prompt-border',
  assistantBg: '--cap-assistant-bg',
  assistantBorder: '--cap-assistant-border',
  link: '--cap-link',
  quoteBorder: '--cap-quote-border',
  quoteBg: '--cap-quote-bg',
  quoteText: '--cap-quote-text',
  tableBorder: '--cap-table-border',
  tableHeadBg: '--cap-table-head-bg',
  inlineCodeBg: '--cap-code-bg',
  inlineCodeText: '--cap-code-text',
};

/** WCAG AA for body-size text: every word printed on a card must reach it. */
export const CARD_TEXT_MIN_CONTRAST = 4.5;

/** Coloured text that gives way when the background behind a see-through card washes it out. */
const YIELDING_TEXT: ReadonlyArray<keyof CaptureCardTokens> = [
  'muted', 'link', 'inlineCodeText', 'quoteText', 'chipText', 'textSecondary',
];

/**
 * Every colour a card's background CSS paints with. The alpha of an `#rrggbbaa` sheen is dropped:
 * drawn solid it is the extreme it can only approach, so a check against it holds for the real one.
 */
export function backgroundColours(css: string): string[] {
  return [...css.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)].map(([, hex]) => {
    const six = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex.slice(0, 6);
    return `#${six.toLowerCase()}`;
  });
}

/** What the card shows over each background colour at this opacity: the shades its text sits on. */
export function cardSurfaces(theme: CardTheme, opacity: number, background: string): string[] {
  const base = CAPTURE_CARD_TOKENS[theme].cardBase;
  const under = backgroundColours(background);
  if (under.length === 0) return [base];
  return under.map((colour) => lerpHex(colour, base, clampCardOpacity(opacity) / 100));
}

/** The first colour that reads on every surface; the body text colour is the last resort. */
function readableOn(surfaces: readonly string[], candidates: readonly string[]): string {
  const fits = candidates.find((colour) => surfaces.every((surface) => contrastRatio(colour, surface) >= CARD_TEXT_MIN_CONTRAST));
  return fits ?? candidates[candidates.length - 1];
}

export interface CardLook {
  /** Percent, MIN_CARD_OPACITY–100; absent = the default. */
  opacity?: number;
  /** The background CSS behind the card, read for the colours it paints with. */
  background?: string;
}

/**
 * The card's CSS variables. A see-through card lets the background into the text's contrast, so
 * each coloured text (grey, link, inline code, quote, chip, secondary) falls back to the secondary
 * and then the body colour until it reads at 4.5:1 over the brightest or darkest colour behind it;
 * the body text itself is kept readable by MIN_CARD_OPACITY.
 */
export function captureCardCssVars(theme: CardTheme, look: CardLook = {}): Record<string, string> {
  const tokens = CAPTURE_CARD_TOKENS[theme];
  const opacity = clampCardOpacity(look.opacity ?? DEFAULT_CARD_OPACITY);
  const surfaces = cardSurfaces(theme, opacity, look.background ?? '');
  const resolved: CaptureCardTokens = { ...tokens, cardBase: cardBackground(theme, opacity) };
  for (const key of YIELDING_TEXT) {
    resolved[key] = readableOn(surfaces, [tokens[key], tokens.textSecondary, tokens.text]);
  }
  const vars: Record<string, string> = {};
  for (const key of Object.keys(CARD_TOKEN_CSS_VARS) as Array<keyof CaptureCardTokens>) {
    vars[CARD_TOKEN_CSS_VARS[key]] = resolved[key];
  }
  return vars;
}

/** The card's fill at this opacity (also what the quick-export schematic paints). */
export function cardBackground(theme: CardTheme, opacity: number | undefined): string {
  return hexToRgba(CAPTURE_CARD_TOKENS[theme].cardBase, clampCardOpacity(opacity ?? DEFAULT_CARD_OPACITY) / 100);
}

/**
 * The serif reading face for a card. The capture window loads no globals.css and does not know the
 * locale, so this is the app's serif stack (globals.css `--font-reading`) with both Chinese scripts.
 */
export const CARD_SERIF_STACK = "Georgia, Cambria, 'Noto Serif TC', 'Noto Serif SC', 'Songti TC', 'Songti SC', PMingLiU, SimSun, serif";

/** Inline vars for the card root: only serif carries over; mono stays on code alone. */
export function cardReadingVars(font: 'default' | 'serif' | undefined): Record<string, string> {
  return font === 'serif' ? { '--cap-font-reading': CARD_SERIF_STACK } : {};
}

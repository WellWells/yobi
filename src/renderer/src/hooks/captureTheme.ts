import type { CardTheme } from '../../../shared/types';

export {
  CAPTURE_PALETTES,
  buildCaptureBackground,
  paletteCardTheme,
} from '../../../shared/capturePalettes';
export type { CaptureDirection } from '../../../shared/capturePalettes';

export interface CaptureCardTokens {
  cardBg: string;
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
    cardBg: 'rgba(13, 17, 23, 0.94)',
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
    cardBg: 'rgba(255, 255, 255, 0.94)',
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
  cardBg: '--cap-card-bg',
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
  link: '--cap-link',
  quoteBorder: '--cap-quote-border',
  quoteBg: '--cap-quote-bg',
  quoteText: '--cap-quote-text',
  tableBorder: '--cap-table-border',
  tableHeadBg: '--cap-table-head-bg',
  inlineCodeBg: '--cap-code-bg',
  inlineCodeText: '--cap-code-text',
};

export function captureCardCssVars(theme: CardTheme): Record<string, string> {
  const tokens = CAPTURE_CARD_TOKENS[theme];
  const vars: Record<string, string> = {};
  for (const key of Object.keys(CARD_TOKEN_CSS_VARS) as Array<keyof CaptureCardTokens>) {
    vars[CARD_TOKEN_CSS_VARS[key]] = tokens[key];
  }
  return vars;
}

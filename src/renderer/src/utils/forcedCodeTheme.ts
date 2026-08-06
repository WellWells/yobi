import { createContext } from 'react';
import type { CardTheme } from '../../../shared/types';
import type { Theme } from '../store/themeStore';

export const ForcedCodeThemeContext = createContext<Theme | null>(null);

/*
 * Code panels stay dark in both card themes — a dark code panel is a familiar
 * convention, and the capture stylesheet pins their chrome to match.
 */
export const CAPTURE_CODE_THEME: Theme = 'dark';

export const CaptureDiagramThemeContext = createContext<Theme | null>(null);

/*
 * Diagrams, unlike code panels, do follow the card theme: a dark diagram slab in
 * the middle of a light document card reads as a rendering bug.
 *
 * It has to be this one function: the capture window pre-renders diagrams under
 * this theme before the card mounts, so a value that drifted from the provider
 * would miss the cache and the export would measure its height before the
 * diagrams appeared.
 */
export function captureDiagramTheme(cardTheme: CardTheme): Theme {
  return cardTheme === 'light' ? 'light' : 'dark';
}

import { createContext } from 'react';
import type { CardTheme } from '../../../shared/types';
import type { Theme } from '../store/themeStore';

export const ForcedCodeThemeContext = createContext<Theme | null>(null);

export const CAPTURE_CODE_THEME: Theme = 'dark';

export const CaptureDiagramThemeContext = createContext<Theme | null>(null);

export function captureDiagramTheme(cardTheme: CardTheme): Theme {
  return cardTheme === 'light' ? 'light' : 'dark';
}

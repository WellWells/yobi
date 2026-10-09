import { createContext } from 'react';
import type { CardTheme } from '../../../shared/types';
import type { Theme } from '../store/themeStore';

/*
 * The theme code blocks and diagrams draw in on an export card (and its preview). Non-null also
 * means a static render: no copy button, no hover chrome. Null = follow the app theme (chat).
 * Both follow the card theme: a dark slab in the middle of a light card reads as a rendering bug.
 */
export const CaptureContentThemeContext = createContext<Theme | null>(null);

export function captureContentTheme(cardTheme: CardTheme): Theme {
  return cardTheme === 'light' ? 'light' : 'dark';
}

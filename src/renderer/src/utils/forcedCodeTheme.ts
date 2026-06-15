import { createContext } from 'react';
import type { Theme } from '../store/themeStore';

export const ForcedCodeThemeContext = createContext<Theme | null>(null);

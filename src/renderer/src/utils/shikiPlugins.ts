import rehypeKatex from 'rehype-katex';
import type { BundledTheme, Highlighter } from 'shiki';
import { THEME_DEFS } from '../../../shared/themes';
import type { Theme } from '../../../shared/themes';

export const SHIKI_FALLBACK_THEME = 'github-dark';

export function shikiThemeFor(theme: Theme): string {
  return THEME_DEFS[theme].shiki;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RehypePluginList = any[];

export const REHYPE_PLUGINS: RehypePluginList = [rehypeKatex];

let _highlighter: Highlighter | null = null;
let _loadPromise: Promise<Highlighter | null> | null = null;

export function getHighlighterSync(): Highlighter | null {
  return _highlighter;
}

export function loadShiki(): Promise<Highlighter | null> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async (): Promise<Highlighter | null> => {
    try {
      const { createHighlighter } = await import('shiki');
      _highlighter = await createHighlighter({
        // Other app themes load their Shiki theme on demand (ensureShikiTheme).
        themes: [SHIKI_FALLBACK_THEME, 'github-light'],
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx',
          'python', 'bash', 'sh', 'json', 'css', 'html',
          'yaml', 'markdown', 'rust', 'go', 'java', 'cpp', 'c',
        ],
      });
    } catch {
    }
    return _highlighter;
  })();
  return _loadPromise;
}

const _themeLoads = new Map<string, Promise<string>>();

/** Loads a bundled Shiki theme on demand; falls back to github-dark on failure. */
export function ensureShikiTheme(highlighter: Highlighter, theme: string): Promise<string> {
  if (highlighter.getLoadedThemes().includes(theme)) return Promise.resolve(theme);
  const pending = _themeLoads.get(theme);
  if (pending) return pending;
  const load = highlighter.loadTheme(theme as BundledTheme)
    .then(() => theme)
    .catch(() => SHIKI_FALLBACK_THEME)
    .finally(() => { _themeLoads.delete(theme); });
  _themeLoads.set(theme, load);
  return load;
}

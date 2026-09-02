import type { BundledThemeName, ShikiHighlighter } from './shikiBundle';
import { THEME_DEFS } from '../../../shared/themes';
import type { Theme } from '../../../shared/themes';

export const SHIKI_FALLBACK_THEME = 'github-dark';

export function shikiThemeFor(theme: Theme): string {
  return THEME_DEFS[theme].shiki;
}

let _highlighter: ShikiHighlighter | null = null;
let _loadPromise: Promise<ShikiHighlighter | null> | null = null;

export function getHighlighterSync(): ShikiHighlighter | null {
  return _highlighter;
}

/**
 * Grammars loaded up front. Anything outside this list falls back to plain
 * text, so it doubles as the list of languages Yobi can highlight. Aliases
 * (sh, cs, yml, dockerfile...) ship inside each grammar's own registration
 * and need no entry here.
 */
export const SHIKI_LANGS = [
  'typescript', 'tsx', 'javascript', 'jsx',
  'python', 'shellscript', 'json', 'css', 'html',
  'yaml', 'markdown', 'rust', 'go', 'java', 'cpp', 'c',
  'sql', 'graphql', 'csharp', 'php', 'kotlin', 'swift',
  'docker', 'toml', 'ini', 'diff',
] as const;

export function loadShiki(): Promise<ShikiHighlighter | null> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async (): Promise<ShikiHighlighter | null> => {
    try {
      const { createHighlighter } = await import('./shikiBundle');
      _highlighter = await createHighlighter({
        themes: [SHIKI_FALLBACK_THEME, 'github-light'],
        langs: [...SHIKI_LANGS],
      });
    } catch (err) {
      // Never throw: callers degrade to unhighlighted text. Log it, because a
      // silent failure here is indistinguishable from "no code blocks shown".
      console.error('[shiki] highlighter failed to load', err);
    }
    return _highlighter;
  })();
  return _loadPromise;
}

const _themeLoads = new Map<string, Promise<string>>();

export function ensureShikiTheme(highlighter: ShikiHighlighter, theme: string): Promise<string> {
  if (highlighter.getLoadedThemes().includes(theme)) return Promise.resolve(theme);
  const pending = _themeLoads.get(theme);
  if (pending) return pending;
  const load = highlighter.loadTheme(theme as BundledThemeName)
    .then(() => theme)
    .catch(() => SHIKI_FALLBACK_THEME)
    .finally(() => { _themeLoads.delete(theme); });
  _themeLoads.set(theme, load);
  return load;
}

import rehypeKatex from 'rehype-katex';
import type { Highlighter } from 'shiki';
import type { Theme } from '../store/themeStore';

export const appThemeToShikiTheme: Record<Theme, string> = {
  dark:        'github-dark',
  light:       'github-light',
  dracula:     'dracula',
  nord:        'nord',
  amoled:      'github-dark',
  sepia:       'github-light',
  catppuccin:  'github-dark',
  everforest:  'nord',
  rosepine:    'github-light',
  gruvbox:     'github-dark',
  cyberpunk:   'github-dark',
};

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
        themes: ['github-dark', 'github-light', 'dracula', 'nord'],
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

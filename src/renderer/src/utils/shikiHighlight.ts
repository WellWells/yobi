import type { Theme } from '../../../shared/themes';
import { ensureShikiTheme, getHighlighterSync, loadShiki, shikiThemeFor } from './shikiPlugins';

/**
 * Highlighted HTML per (Shiki theme, language, code). Code blocks remount whenever the user
 * switches back to a conversation; without this every mount re-ran codeToHtml and painted
 * uncoloured text for a frame. A Map keeps insertion order, so re-inserting on a hit makes the
 * first key the least recently used one.
 */
export const SHIKI_CACHE_LIMIT = 200;

const _cache = new Map<string, string>();
const _inflight = new Map<string, Promise<string | null>>();

function cacheKey(code: string, lang: string, theme: Theme): string {
  return `${shikiThemeFor(theme)}\u0000${lang || 'text'}\u0000${code}`;
}

function remember(key: string, html: string): void {
  _cache.delete(key);
  _cache.set(key, html);
  while (_cache.size > SHIKI_CACHE_LIMIT) {
    const oldest = _cache.keys().next();
    if (oldest.done) break;
    _cache.delete(oldest.value);
  }
}

export function getCachedHighlight(code: string, lang: string, theme: Theme): string | undefined {
  const key = cacheKey(code, lang, theme);
  const html = _cache.get(key);
  if (html !== undefined) remember(key, html);
  return html;
}

/** Drops one entry, so a block whose code changes in place (a streaming answer) keeps one entry, not one per chunk. */
export function forgetHighlight(code: string, lang: string, theme: Theme): void {
  _cache.delete(cacheKey(code, lang, theme));
}

export function resetShikiHighlightCache(): void {
  _cache.clear();
  _inflight.clear();
}

async function runHighlight(code: string, lang: string, theme: Theme, key: string): Promise<string | null> {
  const highlighter = getHighlighterSync() ?? await loadShiki();
  if (!highlighter) return null;
  const wanted = shikiThemeFor(theme);
  const shikiTheme = await ensureShikiTheme(highlighter, wanted);
  let html: string;
  try {
    html = highlighter.codeToHtml(code, { lang: lang || 'text', theme: shikiTheme });
  } catch {
    try {
      html = highlighter.codeToHtml(code, { lang: 'text', theme: shikiTheme });
    } catch {
      return null;
    }
  }
  // A theme that failed to load renders in the fallback theme; return it but let the next mount retry.
  if (shikiTheme === wanted) remember(key, html);
  return html;
}

/** Resolves to the highlighted HTML, or null when Shiki is unavailable. Concurrent calls for one key share a run. */
export function highlightCode(code: string, lang: string, theme: Theme): Promise<string | null> {
  const key = cacheKey(code, lang, theme);
  const cached = _cache.get(key);
  if (cached !== undefined) {
    remember(key, cached);
    return Promise.resolve(cached);
  }
  const existing = _inflight.get(key);
  if (existing) return existing;
  const job = runHighlight(code, lang, theme, key)
    .catch(() => null)
    .finally(() => { _inflight.delete(key); });
  _inflight.set(key, job);
  return job;
}

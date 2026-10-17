/**
 * Reading display preferences: the typeface and width of the reading column (answers,
 * prompts, the conversation title). Global, stored in config.json and mirrored to localStorage so
 * the first paint already uses them.
 */

export const READING_FONTS = ['default', 'serif', 'mono'] as const;
export type ReadingFont = typeof READING_FONTS[number];

export interface ReadingPrefs {
  font: ReadingFont;
  fullWidth: boolean;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  font: 'default',
  fullWidth: false,
};

export function isReadingFont(value: unknown): value is ReadingFont {
  return typeof value === 'string' && (READING_FONTS as readonly string[]).includes(value);
}

export function normalizeReadingFont(value: unknown): ReadingFont {
  return isReadingFont(value) ? value : 'default';
}

/** Anything not exactly right falls back to its default; only a real `true` turns a switch on. */
export function normalizeReadingPrefs(value: unknown): ReadingPrefs {
  const obj = value && typeof value === 'object' ? value as Partial<Record<keyof ReadingPrefs, unknown>> : {};
  return {
    font: normalizeReadingFont(obj.font),
    fullWidth: obj.fullWidth === true,
  };
}

/**
 * Merges a partial update into the current preferences; unknown or malformed fields keep the
 * current value rather than resetting it.
 */
export function mergeReadingPrefs(current: ReadingPrefs, patch: unknown): ReadingPrefs {
  const obj = patch && typeof patch === 'object' ? patch as Partial<Record<keyof ReadingPrefs, unknown>> : {};
  return {
    font: isReadingFont(obj.font) ? obj.font : current.font,
    fullWidth: typeof obj.fullWidth === 'boolean' ? obj.fullWidth : current.fullWidth,
  };
}

/** The flat config keys the preferences are stored under. */
export interface ReadingConfigKeys {
  readingFont: ReadingFont;
  readingFullWidth: boolean;
}

export function readingPrefsFromConfig(config: Partial<Record<keyof ReadingConfigKeys, unknown>>): ReadingPrefs {
  return normalizeReadingPrefs({
    font: config.readingFont,
    fullWidth: config.readingFullWidth,
  });
}

export function readingPrefsToConfig(prefs: ReadingPrefs): ReadingConfigKeys {
  return { readingFont: prefs.font, readingFullWidth: prefs.fullWidth };
}

/**
 * The face an exported card uses. Only serif carries over: the card keeps monospace for code
 * alone, so a mono reading font exports in the default face.
 */
export function exportReadingFont(font: ReadingFont | undefined): 'default' | 'serif' {
  return font === 'serif' ? 'serif' : 'default';
}

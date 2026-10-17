/**
 * The reading column's face and size (globals.css: `--font-reading`, `--reading-size`). Only the
 * text a conversation is read in uses it — answers, prompts, the conversation title — never
 * buttons, badges or the rest of the UI. Code and formulas keep their own faces.
 */
export const READING_TEXT_STYLE = {
  fontFamily: 'var(--font-reading)',
  fontSize: 'var(--reading-size)',
} as const;

/** Same face for text sized on its own (the conversation title, quoted lines). */
export const READING_FACE = 'var(--font-reading)';

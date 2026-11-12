/**
 * Format and direction controls render as nothing, or reorder what is around them, so the string a
 * user reads is not the string the shell gets: bidi embeddings, overrides and isolates (U+202A–E,
 * U+2066–9), marks (U+200E/F, U+061C), zero-width characters (U+200B–D, U+2060, U+FEFF) and the
 * rest of `\p{Cf}`; line and paragraph separators, which a chat breaks a line at and a shell does
 * not; and C0/C1 controls (escape sequences, backspace) other than tab, line feed and carriage return.
 */
export const HIDDEN_SHELL_CHARACTER = /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/** "U+202E" for the first hidden character in `text`, or null when it shows as written. */
export function hiddenShellCharacter(text: string): string | null {
  const hidden = HIDDEN_SHELL_CHARACTER.exec(text);
  if (!hidden) return null;
  return `U+${(hidden[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

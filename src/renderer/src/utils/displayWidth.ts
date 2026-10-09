/**
 * Monospace-cell width of a string: East Asian wide characters (CJK, Hangul,
 * fullwidth forms, most emoji) count 2, everything else 1. A rough stand-in for
 * rendered width that needs no canvas, so it also runs outside the DOM.
 */
export function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x1100) return 1;
  const wide = code <= 0x115f
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f9ff);
  return wide ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

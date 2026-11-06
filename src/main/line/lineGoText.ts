/**
 * Go's text helpers as line-cli's messages use them, so a message quoted or clipped here reads the
 * same as line-cli's: strconv.Quote, clip (first n characters + "..."), and strings.TrimSpace's idea
 * of white space.
 */

// unicode.IsPrint: letters, marks, numbers, punctuation, symbols and the ASCII space.
const GO_PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u;

const GO_ESCAPES: Readonly<Record<string, string>> = {
  '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v',
};

function hex(cp: number, width: number): string {
  return cp.toString(16).padStart(width, '0');
}

/** strconv.Quote: a double-quoted Go string literal, escaping what Go does not print as is. */
export function goQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (GO_PRINTABLE.test(ch)) out += ch;
    else if (GO_ESCAPES[ch]) out += GO_ESCAPES[ch];
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${hex(cp, 2)}`;
    else if (cp >= 0xd800 && cp <= 0xdfff) out += '\\ufffd'; // a lone surrogate is not valid UTF-8
    else if (cp < 0x1_0000) out += `\\u${hex(cp, 4)}`;
    else out += `\\U${hex(cp, 8)}`;
  }
  return `${out}"`;
}

/** s unchanged when it has at most n characters, else its first n and "...". */
export function clipRunes(s: string, n: number): string {
  const chars = [...s];
  return chars.length <= n ? s : `${chars.slice(0, n).join('')}...`;
}

// unicode.IsSpace, which strings.TrimSpace trims (JS trim also drops U+FEFF and keeps U+0085).
const GO_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const GO_SPACE_ONLY = new RegExp(`^${GO_SPACE}*$`);
const GO_SPACE_CHAR = new RegExp(`^${GO_SPACE}$`);

/** strings.TrimSpace(s) === "". */
export function isGoBlank(s: string): boolean {
  return GO_SPACE_ONLY.test(s);
}

/** unicode.IsSpace for one character. */
export function isGoSpace(ch: string): boolean {
  return GO_SPACE_CHAR.test(ch);
}

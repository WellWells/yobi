/**
 * Filling `{{variables}}` into the code of a js or browser_js step without letting a value become
 * code. A small lexer tracks where each `{{…}}` sits:
 * - inside a '…', "…" or `…` literal (template text, not `${…}`), or a regex literal: the value is
 *   written as escapes that read back as exactly the value (a regex matches it literally). Only
 *   [A-Za-z0-9_] stay as they are, so if the lexer were ever wrong about the spot, the escapes can
 *   at most spell one identifier and anything else is a SyntaxError.
 * - anywhere else (code, `${…}`, comments): a literal. A JSON number, boolean or null is that
 *   value and a JSON array or object becomes `JSON.parse("…")`, which is what splicing them used
 *   to give; any other text is a string literal. Every quote kind, `$`, `/` and line terminator in
 *   it is escaped, so it cannot end a comment, a regex or a string around it either.
 */

const TOKEN = /\{\{([^}]+)\}\}/y;
const WORD = /[A-Za-z0-9_$]+/y;
const JSON_SCALAR = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;
/** After these words a `/` starts a regex; after any other word or number it divides. */
const BEFORE_REGEX_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
/** LF, CR and the line and paragraph separators, by code point (never raw in this file). */
const LINE_ENDS = new Set([0x0a, 0x0d, 0x2028, 0x2029]);

function isLineEnd(ch: string): boolean {
  return LINE_ENDS.has(ch.charCodeAt(0));
}

/** The value as string-literal content that every quote kind, a regex and a comment read the same. */
function escapedText(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function codeLiteral(value: string): string {
  const text = value.trim();
  if (JSON_SCALAR.test(text)) return text;
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      JSON.parse(text);
      return `JSON.parse("${escapedText(text)}")`;
    } catch {
      // Not JSON: an ordinary string below.
    }
  }
  return `"${escapedText(value)}"`;
}

function regexMayStart(prev: string): boolean {
  if (prev === '' || prev === 'operator') return true;
  if (prev === 'value') return false;
  return BEFORE_REGEX_WORDS.has(prev);
}

type Mode = 'code' | 'string' | 'template' | 'regex' | 'lineComment' | 'blockComment';

export function interpolateCode(code: string, context: Map<string, string>): string {
  if (!code.includes('{{')) return code;
  let out = '';
  // The open template literals and the `${…}` inside them; a number is a code frame's open braces.
  const frames: Array<'template' | number> = [0];
  let mode: Mode = 'code';
  let quote = '';
  let inClass = false;
  // The last thing in code: '' at the start, 'value', 'operator', or the word itself.
  let prev = '';
  let i = 0;
  const tokenAt = (at: number): RegExpExecArray | null => {
    TOKEN.lastIndex = at;
    return TOKEN.exec(code);
  };

  while (i < code.length) {
    const token = tokenAt(i);
    if (token) {
      const value = context.get(token[1].trim()) ?? '';
      const asText = mode === 'string' || mode === 'template' || mode === 'regex';
      out += asText ? escapedText(value) : codeLiteral(value);
      if (mode === 'code') prev = 'value';
      i += token[0].length;
      continue;
    }
    const ch = code[i];
    const next = code[i + 1] ?? '';

    if (mode === 'string' || mode === 'template' || mode === 'regex') {
      if (ch === '\\') {
        out += ch + next;
        i += 2;
        continue;
      }
      out += ch;
      i++;
      if (mode === 'string') {
        if (ch === quote || isLineEnd(ch)) {
          mode = 'code';
          prev = 'value';
        }
      } else if (mode === 'template') {
        if (ch === '`') {
          frames.pop();
          mode = 'code';
          prev = 'value';
        } else if (ch === '$' && next === '{' && !tokenAt(i)) {
          out += next;
          i++;
          frames.push(0);
          mode = 'code';
          prev = 'operator';
        }
      } else if (isLineEnd(ch)) {
        mode = 'code';
        prev = 'value';
      } else if (ch === '[') {
        inClass = true;
      } else if (ch === ']') {
        inClass = false;
      } else if (ch === '/' && !inClass) {
        WORD.lastIndex = i;
        const flags = WORD.exec(code);
        if (flags) {
          out += flags[0];
          i += flags[0].length;
        }
        mode = 'code';
        prev = 'value';
      }
      continue;
    }

    if (mode === 'lineComment' || mode === 'blockComment') {
      out += ch;
      i++;
      if (mode === 'lineComment' && isLineEnd(ch)) mode = 'code';
      if (mode === 'blockComment' && ch === '*' && next === '/') {
        out += next;
        i++;
        mode = 'code';
      }
      continue;
    }

    WORD.lastIndex = i;
    const word = WORD.exec(code);
    if (word) {
      out += word[0];
      i += word[0].length;
      prev = /^[0-9]/.test(word[0]) ? 'value' : word[0];
      continue;
    }
    out += ch;
    i++;
    if (/\s/.test(ch)) continue;
    if (ch === '"' || ch === "'") {
      mode = 'string';
      quote = ch;
    } else if (ch === '`') {
      frames.push('template');
      mode = 'template';
    } else if (ch === '/' && next === '/') {
      out += next;
      i++;
      mode = 'lineComment';
    } else if (ch === '/' && next === '*') {
      out += next;
      i++;
      mode = 'blockComment';
    } else if (ch === '/' && regexMayStart(prev)) {
      mode = 'regex';
      inClass = false;
    } else if (ch === '{') {
      const top = frames[frames.length - 1];
      if (typeof top === 'number') frames[frames.length - 1] = top + 1;
      prev = 'operator';
    } else if (ch === '}') {
      const top = frames[frames.length - 1];
      if (typeof top === 'number' && top > 0) {
        frames[frames.length - 1] = top - 1;
      } else if (frames.length > 1) {
        frames.pop();
        mode = 'template';
      }
      prev = 'value';
    } else {
      prev = ch === ')' || ch === ']' ? 'value' : 'operator';
    }
  }
  return out;
}

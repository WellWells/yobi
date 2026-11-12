/**
 * Escapes the quotes a model wrote inside a string without a backslash, as in
 * `"thought": "maybe the sequel ("Dune: Part Two"), load the skill"`. JSON.parse rejects it, and
 * jsonrepair gives up when the stray quote is followed by a bracket or by CJK text.
 *
 * A quote inside a string ends it only when what follows is structure: a key's quote is followed by
 * `:`; an array element's by `,` or `]`; an object value's by `}`, or by `,` and then the next
 * `"key":`. Every other quote is part of the text. A value that really ends with a quote followed
 * by `, "x"` and no colon is read as text — the same call a reader makes.
 */

type Container = '{' | '[';

const NEXT_KEY = /^\s*"(?:[^"\\]|\\.)*"\s*:/;

function nextSolid(text: string, from: number): { char: string; at: number } {
  let at = from;
  while (at < text.length && /\s/.test(text[at])) at++;
  return { char: text[at] ?? '', at };
}

function closesString(text: string, quoteAt: number, isKey: boolean, container: Container | undefined): boolean {
  const { char, at } = nextSolid(text, quoteAt + 1);
  if (char === '') return true;
  if (isKey) return char === ':';
  if (container === '[') return char === ',' || char === ']';
  if (container === '{') {
    if (char === '}') return true;
    if (char !== ',') return false;
    const after = nextSolid(text, at + 1).char;
    return after === '}' || NEXT_KEY.test(text.slice(at + 1));
  }
  return false;
}

export function escapeInnerQuotes(text: string): string {
  const stack: Container[] = [];
  let expectKey = false;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '"') {
      if (ch === '{') { stack.push('{'); expectKey = true; }
      else if (ch === '[') { stack.push('['); expectKey = false; }
      else if (ch === '}' || ch === ']') { stack.pop(); expectKey = false; }
      else if (ch === ',') expectKey = stack.at(-1) === '{';
      else if (ch === ':') expectKey = false;
      out += ch;
      continue;
    }
    const container = stack.at(-1);
    const isKey = container === '{' && expectKey;
    out += ch;
    let j = i + 1;
    for (; j < text.length; j++) {
      const inner = text[j];
      if (inner === '\\') {
        out += inner + (text[j + 1] ?? '');
        j++;
        continue;
      }
      if (inner === '"') {
        if (closesString(text, j, isKey, container)) break;
        out += '\\"';
        continue;
      }
      out += inner;
    }
    if (j < text.length) out += '"';
    i = j;
  }
  return out;
}

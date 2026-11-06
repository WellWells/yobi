/**
 * TeX commands that start with a letter JSON also reads as an escape (`\b \f \n \r \t`). A model
 * that writes `$\frac{1}{2}$` inside a JSON string without doubling the backslash gets a form feed
 * and "rac" back — JSON.parse accepts it, so no repair ever ran.
 */
const TEX_COMMANDS = new Set([
  'backslash', 'bar', 'begin', 'beta', 'bf', 'big', 'bigcap', 'bigcup', 'bigg', 'bigl', 'bigoplus',
  'bigotimes', 'bigr', 'binom', 'bmod', 'boldsymbol', 'bot', 'bullet',
  'flat', 'forall', 'frac', 'frown',
  'nabla', 'ne', 'nearrow', 'neg', 'neq', 'newline', 'nexists', 'ngeq', 'nleq', 'nmid',
  'nolimits', 'not', 'notin', 'nparallel', 'nu', 'nwarrow',
  'rangle', 'rbrace', 'rceil', 'rfloor', 'rho', 'right', 'rightarrow', 'rightharpoonup',
  'rightleftharpoons', 'rvert',
  'tan', 'tanh', 'tau', 'tbinom', 'text', 'textbf', 'textit', 'textrm', 'textstyle', 'tfrac',
  'therefore', 'theta', 'tilde', 'times', 'to', 'top', 'triangle',
]);

/**
 * `\n` and `\t` before a letter are ordinary in model JSON ("line one\nThe next"), so those two are
 * read as TeX only inside math. `\b \f \r` before a TeX command name are taken as TeX anywhere: a
 * backspace, form feed or bare carriage return followed by "eta", "rac" or "ightarrow" is not
 * something a model means.
 */
const TEX_ONLY_IN_MATH = new Set(['n', 't']);

/**
 * A string that IS a Windows path written with single backslashes (`"C:\Users\…"`), the way
 * browser-UI models write them. Its `\n`, `\t`, `\r`, `\b`, `\f` are valid JSON escapes, so
 * `C:\Users\me\Desktop\todo.txt` parsed into a tab and "odo.txt" and the file was never found;
 * the invalid-escape repair (`escapeStrayBackslashes`) only runs when parsing fails. `C:\\…`, a
 * correctly doubled path, does not match.
 */
const WINDOWS_PATH_START = /^[A-Za-z]:\\(?!\\)/;

function letterRunAt(text: string, start: number): string {
  let end = start;
  while (end < text.length && /[A-Za-z]/.test(text[end])) end++;
  return text.slice(start, end);
}

/**
 * Doubles the backslashes a model meant literally but that JSON would read as a control character:
 * every single backslash of a string that is a Windows path, and the backslash of each TeX command.
 * Math is `$…$`, `$$…$$`, `\(…\)` or `\[…\]` within one string; a `$` followed by a digit is a
 * price, not math. Escapes outside strings, doubled backslashes and every other escape are copied
 * as they are.
 */
export function escapeLiteralBackslashes(text: string): string {
  let out = '';
  let inString = false;
  let inMath = false;
  let windowsPath = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') {
        inString = true;
        inMath = false;
        windowsPath = WINDOWS_PATH_START.test(text.slice(i + 1, i + 5));
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (windowsPath) {
      // Every single backslash of a path is literal; only `\"` still ends the escape.
      if (ch === '\\' && text[i + 1] !== '"') out += '\\\\';
      else if (ch === '\\') {
        out += '\\"';
        i++;
      } else out += ch;
      continue;
    }
    if (ch === '$') {
      const display = text[i + 1] === '$';
      if (inMath || !/\d/.test(text[i + (display ? 2 : 1)] ?? '')) inMath = !inMath;
      out += display ? '$$' : '$';
      if (display) i++;
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[i + 1] ?? '';
    // `\(` `\[` open math and `\)` `\]` close it, written either single or doubled.
    const bracket = next === '\\' ? (text[i + 2] ?? '') : next;
    if (bracket === '(' || bracket === '[') inMath = true;
    else if (bracket === ')' || bracket === ']') inMath = false;
    const word = /[bfnrt]/.test(next) ? letterRunAt(text, i + 1) : '';
    if (word && TEX_COMMANDS.has(word) && (inMath || !TEX_ONLY_IN_MATH.has(next))) {
      out += '\\\\';
      continue;
    }
    // Any other escape is copied whole, so `\"` does not end the string and `\\` stays doubled.
    out += ch + next;
    i++;
  }
  return out;
}

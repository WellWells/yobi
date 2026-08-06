const ALLOWED_FUNCTIONS = new Set([
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
]);

const MAX_LENGTH = 4_000;

const FUNCTION_CALL = /([a-z][a-z0-9-]*)\s*\(/gi;
const STATEMENT_CHARS = /[;{}<>"'\\]/;

export function isSafeCaptureBackground(value: string): boolean {
  const css = (value ?? '').trim();
  if (!css || css.length > MAX_LENGTH) return false;
  if (STATEMENT_CHARS.test(css)) return false;
  for (const match of css.matchAll(FUNCTION_CALL)) {
    if (!ALLOWED_FUNCTIONS.has(match[1].toLowerCase())) return false;
  }
  return true;
}

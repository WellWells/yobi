import { CAPTURE_GRAIN_LAYER } from './capturePalettes';

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

/**
 * A background the capture window may paint: gradients and colours only. The single `url()` let
 * through is the silk grain, compared as the exact constant — any other image source (a remote
 * file, a different data URL) still fails.
 */
export function isSafeCaptureBackground(value: string): boolean {
  const css = (value ?? '').trim().split(CAPTURE_GRAIN_LAYER).join('');
  if (!css || css.length > MAX_LENGTH) return false;
  if (STATEMENT_CHARS.test(css)) return false;
  for (const match of css.matchAll(FUNCTION_CALL)) {
    if (!ALLOWED_FUNCTIONS.has(match[1].toLowerCase())) return false;
  }
  return true;
}

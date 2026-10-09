/**
 * Read a number out of a step config value or a loosely typed API field.
 *
 * `Number('')` is 0, not NaN, so a key the model or the flow left blank would otherwise read
 * as an explicit zero and silently override the step's default (forex rounding a rate to a
 * whole number, file_download dropping its size cap). Blank, null and non-numeric all mean
 * "not given" here; the caller picks the fallback.
 */
export function parseNumberField(raw: unknown): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function clampIntField(raw: unknown, fallback: number, min: number, max: number): number {
  const n = parseNumberField(raw);
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

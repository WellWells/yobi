import { ensureHttpScheme } from '../../urlParser';
import { isFetchableWebUrl } from '../../../shared/webUrl';

/**
 * Reads the "one URL, a JSON array, or a comma/newline list" shape that skills accept from the
 * model, and returns only the http(s) ones. Shared by `browser` and `research`'s `urls` field so
 * the sandbox guard cannot be present in one and missing in the other.
 *
 * Returns `null` when the input is not a list — a single URL — because `browser` treats that
 * case differently (it can also extract a cover image).
 */
export function parseWebUrlList(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((u): u is string => typeof u === 'string')) {
      return parsed.map((u) => ensureHttpScheme(u)).filter(Boolean).filter(isFetchableWebUrl);
    }
  } catch {
    const candidates = raw.split(/[\n\r,]+/).map((s) => ensureHttpScheme(s)).filter(Boolean);
    if (candidates.length > 1) return candidates.filter(isFetchableWebUrl);
  }
  return null;
}

/** Like `parseWebUrlList` but for a field that is always a list, even with one entry. */
export function parseWebUrls(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const list = parseWebUrlList(trimmed);
  if (list) return [...new Set(list)];
  const single = ensureHttpScheme(trimmed);
  return single && isFetchableWebUrl(single) ? [single] : [];
}

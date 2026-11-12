import { ensureHttpScheme } from '../../urlParser';
import { isFetchableWebUrl } from '../../../shared/webUrl';
import { looksLikeWebUrl, parseJsonStringArray, splitUrlListText } from '../../../shared/urlRows';

/** A listed entry worth loading: a web address, never a local file or the prose around a list. */
function isListedWebUrl(candidate: string): boolean {
  return isFetchableWebUrl(candidate) && looksLikeWebUrl(candidate);
}

/**
 * Reads the "one URL, a JSON array, or a comma/newline list" shape that skills accept from the
 * model, and returns only the web addresses, dropping anything else without a word (a model's
 * list arrives with its own heading lines).
 *
 * `preservePositions` is for the editor's own URL rows (a JSON array the user laid out row by
 * row, with `.pageN` named after the rows): every row is kept, blank or not, so the reader can
 * report a bad row as that row's failure instead of shifting the pages after it.
 *
 * Returns `null` when the input is not a list — a single URL — because `browser` treats that
 * case differently (it can also extract a cover image).
 */
export function parseWebUrlList(raw: string, preservePositions = false): string[] | null {
  const rows = parseJsonStringArray(raw);
  if (rows) {
    const candidates = rows.map((u) => ensureHttpScheme(u));
    return preservePositions ? candidates : candidates.filter(isListedWebUrl);
  }
  const pieces = splitUrlListText(raw);
  if (pieces.length < 2) return null;
  return pieces.map((s) => ensureHttpScheme(s)).filter(isListedWebUrl);
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

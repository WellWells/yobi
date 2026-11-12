/**
 * The URL-list shapes a `browser` step reads, shared by the editor (which lists `.pageN`) and the
 * runtime (which fills them), so the two never disagree about where page N comes from.
 */

/** A JSON array of strings, or `null` when the value is anything else. */
export function parseJsonStringArray(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * An address a list may hold: no whitespace, http(s) (a bare host counts) and a host with a dot,
 * `localhost` or an IP literal. Rejects the prose a model puts around its links ("Here are the
 * URLs:") and the halves of a URL whose query has a comma in it.
 */
export function looksLikeWebUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.hostname === 'localhost' || url.hostname.includes('.') || url.hostname.startsWith('[');
}

function isListItem(piece: string): boolean {
  return /^\{\{[^{}]+\}\}$/.test(piece) || looksLikeWebUrl(piece);
}

/**
 * A free-text list: one entry per line, and a line splits at its commas only when every piece is
 * an address (or a whole `{{variable}}`), so `https://a.test/?q=x,y` stays one entry.
 */
export function splitUrlListText(value: string): string[] {
  return value.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const pieces = line.split(',').map((piece) => piece.trim()).filter(Boolean);
    return pieces.length > 1 && pieces.every(isListItem) ? pieces : [line];
  });
}

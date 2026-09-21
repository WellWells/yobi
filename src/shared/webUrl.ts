/**
 * The read side of the file sandbox leaks without this. Page loaders call `win.loadURL(url)`
 * with no scheme check, and `ensureHttpScheme` passes an existing `file://` through untouched —
 * so any skill that takes a URL from the model is a way to read a local file as page text, no
 * file_read involved. Reject anything that is not http(s) before the URL reaches a loader.
 *
 * Lives in shared/ because three layers need the same answer: the `browser` skill, `research`'s
 * `urls` field, and the search pipeline that harvests them.
 */
export function isFetchableWebUrl(raw: string): boolean {
  const trimmed = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return true; // bare host — ensureHttpScheme prepends https
  if (scheme === 'http' || scheme === 'https') return true;
  // A `//` test is not enough: `data:` and `javascript:` carry an opaque body with no slashes
  // and would have passed as "no scheme". But a scheme match alone over-rejects, because
  // `example.com:8080/x` looks exactly like one — and there the part after the colon is a
  // PORT, which is all digits and is what `ensureHttpScheme` is about to prepend https to.
  return /^[a-z][a-z0-9+.-]*:\d+(?:[/?#]|$)/i.test(trimmed);
}

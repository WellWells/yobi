/**
 * An absolute http(s) URL. The guard trims, but the string parsed is the one given: a caller opens
 * or returns exactly what was checked, so one that trims first (a form field) trims before calling.
 */
export function isHttpUrl(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Only http(s) URLs (or bare hosts) may reach a page loader: `loadURL` has no scheme check and
 * `ensureHttpScheme` passes `file://` through, so a model-supplied URL could read a local file.
 * Shared by the `browser` skill, `research`'s `urls` field and the search harvest.
 */
export function isFetchableWebUrl(raw: string): boolean {
  const trimmed = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return true; // bare host — ensureHttpScheme prepends https
  if (scheme === 'http' || scheme === 'https') return true;
  // Any other scheme (including opaque `data:`/`javascript:`) is rejected, except `host:port`,
  // where the part after the colon is all digits.
  return /^[a-z][a-z0-9+.-]*:\d+(?:[/?#]|$)/i.test(trimmed);
}

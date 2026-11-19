/** The kinds every model that takes pictures reads; a GIF stays a link. */
const PICTURE_PATH = /\.(?:jpe?g|png|webp)$/i;
const PICTURE_FORMATS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp']);

/**
 * The link, when the message is one https address that names a picture (`i.imgur.com/….jpg`): by
 * its path's extension, or by `format=` as X's media host writes it. Decided from the address
 * alone; fetching it decides whether it really is one.
 */
export function pictureLinkOf(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const format = url.searchParams.get('format')?.toLowerCase() ?? '';
  return PICTURE_PATH.test(url.pathname) || PICTURE_FORMATS.has(format) ? trimmed : null;
}

/*
 * A bare HLS playlist link (`https://…/<name>.m3u8`), on any host: the stream itself rather than a
 * site's page, as a person copies it out of a player or the browser's network panel. It has no
 * site behind it, so it carries no title, channel or cover; the playlist's file name stands in
 * for the title.
 *
 * Only https links with no user, password or port, as every segmented download requests them
 * (`assertStreamUrl`); an http link reaches the agent like any other. The query is kept (a CDN's
 * signature lives there), the fragment dropped. Which addresses may be asked at all — never this
 * computer or its local network — is decided in main, where the host can be resolved.
 */

export interface M3u8Link {
  /** The link as parsed, without its fragment. */
  url: string;
  /** A short hash of `url`: the reuse key's id and a safe file-name part. */
  id: string;
  /** The title the playlist's path suggests (`v_645516`). */
  name: string;
  /** Where it is served from, shown where a site's channel would be. */
  host: string;
}

/** Playlist names that say nothing about the video: the folder above them is its name. */
const GENERIC_NAMES = new Set(['index', 'master', 'playlist', 'prog_index', 'main', 'video', 'stream', 'manifest', 'chunklist', 'media']);

/** cyrb53: a 53-bit string hash, the same in main and the renderer (no `node:crypto` here). */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)).toString(36);
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The playlist's own name, or the folder's when the name is generic; the host when there is neither. */
function nameFrom(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean).map(decoded);
  const stem = (segments.at(-1) ?? '').replace(/\.m3u8$/i, '').trim();
  if (stem && !GENERIC_NAMES.has(stem.toLowerCase())) return stem;
  const folder = segments.at(-2)?.trim();
  return folder || stem || url.hostname;
}

/** An https link to an `.m3u8` playlist; null for anything else. */
export function parseM3u8Url(text: string): M3u8Link | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!/\.m3u8$/i.test(url.pathname)) return null;
  url.hash = '';
  const href = url.toString();
  return { url: href, id: hash53(href), name: nameFrom(url), host: url.hostname.toLowerCase() };
}

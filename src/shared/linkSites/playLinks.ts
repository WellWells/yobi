/*
 * Google Play app links: `play.google.com/store/apps/details?id=<package>`. The region (`gl`) is
 * kept, since the in-app purchase range and its currency differ by country; the language (`hl`)
 * and every other parameter are dropped (the reader writes the language the user reads). The link
 * is rebuilt from the package name. Developer pages, categories, searches, games' and books' other
 * pages are not this row's: they reach the agent like any other link.
 */

const PLAY_HOST = 'play.google.com';
const DETAILS_PATH = /^\/store\/apps\/details\/?(?:[^/]+\/?)?$/;
/** Android's package name: dot-separated segments, each starting with a letter. */
const PACKAGE = /^[A-Za-z][\w]*(?:\.[A-Za-z_][\w]*)+$/;
const REGION = /^[A-Za-z]{2}$/;

export interface PlayLink {
  url: string;
  /** The app's package name (`org.zwanoo.android.speedtest`). */
  id: string;
  /** The country (`gl`) in lower case; "" when the link names none. */
  region: string;
}

/** The app a Google Play link opens, or null when it is no app page. */
export function parsePlayUrl(raw: string): PlayLink | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== PLAY_HOST || !DETAILS_PATH.test(url.pathname)) return null;
  const id = url.searchParams.get('id') ?? '';
  if (!PACKAGE.test(id) || id.length > 150) return null;
  const gl = url.searchParams.get('gl') ?? '';
  const region = REGION.test(gl) ? gl.toLowerCase() : '';
  return { url: playAppUrl(id, region), id, region };
}

/** The app's page, with the region when there is one. */
export function playAppUrl(id: string, region: string): string {
  return `https://${PLAY_HOST}/store/apps/details?id=${id}${region ? `&gl=${region.toUpperCase()}` : ''}`;
}

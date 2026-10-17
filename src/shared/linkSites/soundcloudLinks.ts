/*
 * SoundCloud links: a track `soundcloud.com/<artist>/<track>` (a private one with its secret,
 * `/<artist>/<track>/s-<token>`), a playlist or album `/<artist>/sets/<name>`, and the app's
 * share links `on.soundcloud.com/<code>`. Only these: an artist's page, their tabs (`/tracks`,
 * `/likes`…), a track's own tabs, and the site's pages (`/discover`, `/charts`, `/search`…) are
 * not this row's, so such a link reaches the agent like any other.
 *
 * A playlist is taken so its read can say playlists are not downloaded (one pasted track at a
 * time); a share link is taken before it is resolved, as bilibili's
 * `b23.tv` is. Every query (`?si=…`, `utm_*`, `in=<playlist>`) is dropped: the link is rebuilt
 * from its path, the secret kept, since it is what opens a private track.
 */

export type SoundcloudLink =
  /** One track, the link rebuilt as `https://soundcloud.com/<artist>/<track>` (+ `/s-<token>`). */
  | { kind: 'track'; id: string; artist: string; url: string }
  /** A playlist or album: refused when read, with a note to paste one track. */
  | { kind: 'set'; id: string; artist: string; url: string }
  /** An `on.soundcloud.com` share code, not yet resolved. */
  | { kind: 'short'; id: string; artist: ''; url: string };

const SITE_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const SHORT_HOST = 'on.soundcloud.com';

/** An artist's or a track's permalink as SoundCloud writes it. */
const NAME = /^[A-Za-z0-9_-]{1,100}$/;
const SECRET = /^s-[A-Za-z0-9]{1,40}$/;
const SHORT_CODE = /^[A-Za-z0-9]{4,32}$/;

/** First path parts that are the site's own pages, never an artist. */
const SITE_PAGES = new Set([
  'discover', 'charts', 'search', 'stream', 'feed', 'you', 'upload', 'settings', 'messages', 'notifications',
  'pages', 'terms-of-use', 'imprint', 'mobile', 'jobs', 'popular', 'tags', 'stations', 'people', 'groups',
  'home', 'login', 'signin', 'signup', 'logout', 'pro', 'creators', 'artists', 'go', 'premium', 'connect',
  'oauth', 'apps', 'help', 'press', 'legal', 'community-guidelines', 'playlists', 'tracks', 'sets', 'next',
]);

/** Second path parts that are an artist's own tabs, never a track. */
const ARTIST_TABS = new Set([
  'tracks', 'albums', 'sets', 'reposts', 'likes', 'followers', 'following', 'comments', 'popular-tracks',
  'spotlight', 'playlists', 'toptracks', 'stations',
]);

/** The canonical link of a track or a playlist: lower-case names, the secret as written. */
function canonical(parts: readonly string[]): string {
  return `https://soundcloud.com/${parts.join('/')}`;
}

function siteLink(parts: readonly string[]): SoundcloudLink | null {
  const [artist = '', second = '', third, fourth, extra] = parts;
  if (!NAME.test(artist) || SITE_PAGES.has(artist.toLowerCase()) || extra !== undefined) return null;
  const who = artist.toLowerCase();
  if (second.toLowerCase() === 'sets') {
    if (!third || !NAME.test(third) || (fourth !== undefined && !SECRET.test(fourth))) return null;
    const set = [who, 'sets', third.toLowerCase(), ...(fourth ? [fourth] : [])];
    return { kind: 'set', id: set.slice(0, 3).join('/'), artist: who, url: canonical(set) };
  }
  if (!NAME.test(second) || ARTIST_TABS.has(second.toLowerCase()) || fourth !== undefined) return null;
  if (third !== undefined && !SECRET.test(third)) return null;
  const track = [who, second.toLowerCase(), ...(third ? [third] : [])];
  return { kind: 'track', id: `${who}/${second.toLowerCase()}`, artist: who, url: canonical(track) };
}

/**
 * A SoundCloud track, playlist or share link; null for anything else. Only http(s) links with no
 * user, password or port, as the other video rows take them.
 */
export function parseSoundcloudUrl(text: string): SoundcloudLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === SHORT_HOST) {
    const code = parts.length === 1 ? parts[0] : '';
    return SHORT_CODE.test(code) ? { kind: 'short', id: code, artist: '', url: `https://${SHORT_HOST}/${code}` } : null;
  }
  return SITE_HOSTS.has(host) ? siteLink(parts) : null;
}

/**
 * Where a share link led, read as a track or a playlist: null when it is neither (an artist's
 * page, another share link, another site). A resolved link is never resolved again.
 */
export function parseResolvedSoundcloudUrl(location: string): Exclude<SoundcloudLink, { kind: 'short' }> | null {
  const link = parseSoundcloudUrl(location);
  return link && link.kind !== 'short' ? link : null;
}

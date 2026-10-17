/*
 * Reddit post links: `/r/<community>/comments/<id>[/<slug>[/<comment>]]`, the same under
 * `/user/<name>/` or `/u/<name>/`, `/comments/<id>`, `/gallery/<id>`, and the short `redd.it/<id>`;
 * on `www.`, `m.`, `old.`, `new.`, `np.`, `sh.` or bare `reddit.com`. The share links the app's
 * share button copies (`/r/<community>/s/<code>`) and a video's own `v.redd.it/<id>` are taken
 * as they are and resolved by the reader. Communities, profiles, searches and the like are not
 * this row's: such a link reaches the agent like any other. A post is always read at
 * `redditPostUrl`, never at the address as written.
 */

const POST_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'm.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'sh.reddit.com']);
const SHORT_HOST = 'redd.it';
const VIDEO_HOST = 'v.redd.it';

/** Post ids are base 36: seven characters for recent posts, fewer for older ones. */
const ID = '[a-z0-9]{4,10}';
const NAME = '[A-Za-z0-9_-]{2,30}';
const CODE = '[A-Za-z0-9]{6,16}';
const VIDEO_ID = '[a-z0-9]{8,20}';

const COMMENTS_PATH = new RegExp(`^/(?:(?:r|user|u)/${NAME}/)?comments/(${ID})(?:/[^/]*(?:/[a-z0-9]+)?)?/?$`, 'i');
const GALLERY_PATH = new RegExp(`^/gallery/(${ID})/?$`, 'i');
const SHARE_PATH = new RegExp(`^/r/(${NAME})/s/(${CODE})/?$`);
const SHORT_PATH = new RegExp(`^/(${ID})/?$`, 'i');
const VIDEO_PATH = new RegExp(`^/(${VIDEO_ID})/?$`, 'i');

export type RedditLink =
  /** One post; `url` is the address it is read at, `www.reddit.com/comments/<id>/`. */
  | { kind: 'post'; id: string; author: ''; url: string }
  /** A share code or a v.redd.it video, not yet resolved; `url` is where its redirect is read. */
  | { kind: 'short'; id: string; author: ''; url: string };

/** Any of Reddit's own page hosts: the reader's redirect guard. */
export function isRedditHost(host: string): boolean {
  return /(?:^|\.)reddit\.com$/i.test(host);
}

/** Where a post is read: its own address follows with a redirect. */
export function redditPostUrl(id: string): string {
  return `https://www.reddit.com/comments/${id.toLowerCase()}/`;
}

function post(id: string): RedditLink {
  return { kind: 'post', id: id.toLowerCase(), author: '', url: redditPostUrl(id) };
}

/**
 * A Reddit post link, share link or v.redd.it video; null for anything else. http(s) with no
 * user, password or port; the scheme may be left out, as every post row takes it. The query
 * (`share_id`, `utm_*`…) and the fragment are dropped.
 */
export function parseRedditUrl(raw: string): RedditLink | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === SHORT_HOST) {
    const id = SHORT_PATH.exec(url.pathname)?.[1];
    return id ? post(id) : null;
  }
  if (host === VIDEO_HOST) {
    const id = VIDEO_PATH.exec(url.pathname)?.[1]?.toLowerCase();
    return id ? { kind: 'short', id, author: '', url: `https://www.reddit.com/video/${id}` } : null;
  }
  if (!POST_HOSTS.has(host)) return null;
  const share = SHARE_PATH.exec(url.pathname);
  if (share) return { kind: 'short', id: share[2], author: '', url: `https://www.reddit.com/r/${share[1]}/s/${share[2]}` };
  const id = COMMENTS_PATH.exec(url.pathname)?.[1] ?? GALLERY_PATH.exec(url.pathname)?.[1];
  return id ? post(id) : null;
}

/** Where a share link or video led, read as a post: null when it is not one. A resolved link is never resolved again. */
export function parseResolvedRedditUrl(location: string): Extract<RedditLink, { kind: 'post' }> | null {
  const link = parseRedditUrl(location);
  return link?.kind === 'post' ? link : null;
}

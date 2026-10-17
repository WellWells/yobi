/*
 * TikTok post links: a video (`/@<account>/video/<id>`), a photo post (`/@<account>/photo/<id>`),
 * the mobile `m.tiktok.com/v/<id>.html` and an embed (`/embed/v2/<id>`), and the share links
 * (`vm.tiktok.com/<code>`, `vt.tiktok.com/<code>`, `www.tiktok.com/t/<code>`) the app's share
 * button copies. Accounts, tags, music, live rooms and the like are not this row's: such a link
 * reaches the agent like any other.
 *
 * Every query parameter is dropped (`_r`, `_t`, `is_from_webapp`, `sender_device`…), and the link
 * is rebuilt from its id. A post's page answers the same under any account name, `_` included,
 * so a link that names none is read as `/@_/…`.
 */

const POST_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
/** Share hosts: the code resolves to the post with a redirect, read later (the reader). */
const SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

/** TikTok account names: letters, digits, dots and underscores; "" in TikTok's own `/@/video/<id>`. */
const ACCOUNT = '[A-Za-z0-9._-]{0,30}';
/** Post ids are 64-bit numbers: 19 digits today, older ones fewer. */
const ID = '\\d{15,20}';
const CODE = '[A-Za-z0-9]{5,16}';

const POST_PATH = new RegExp(`^/@(${ACCOUNT})/(video|photo)/(${ID})/?$`);
const MOBILE_PATH = new RegExp(`^/v/(${ID})(?:\\.html)?/?$`);
const EMBED_PATH = new RegExp(`^/embed(?:/v2)?/(${ID})/?$`);
const SHARE_PATH = new RegExp(`^/t/(${CODE})/?$`);
const SHORT_PATH = new RegExp(`^/(${CODE})/?$`);

export type TikTokLink =
  /** One post, the link rebuilt as `https://www.tiktok.com/@<account or _>/<video|photo>/<id>`. */
  | { kind: 'video' | 'photo'; id: string; author: string; url: string }
  /** A share code, not yet resolved; `url` is the share link rebuilt on its own host. */
  | { kind: 'short'; id: string; author: ''; url: string };

/** Any of TikTok's own hosts: the readers' redirect guard. */
export function isTikTokHost(host: string): boolean {
  return /(?:^|\.)tiktok\.com$/i.test(host);
}

/** A post's own page. A photo post's is its `/video/` page: its `/photo/` page carries no post. */
export function tiktokPageUrl(id: string, author = ''): string {
  return `https://www.tiktok.com/@${author || '_'}/video/${id}`;
}

/** The link to show for a post: its kind's own path. */
export function tiktokPostUrl(kind: 'video' | 'photo', id: string, author = ''): string {
  return `https://www.tiktok.com/@${author || '_'}/${kind}/${id}`;
}

function post(kind: 'video' | 'photo', id: string, rawAuthor: string): TikTokLink {
  const author = rawAuthor === '_' ? '' : rawAuthor;
  return { kind, id, author, url: tiktokPostUrl(kind, id, author) };
}

/**
 * A TikTok post link or share link; null for anything else. http(s) with no user, password or
 * port; the scheme may be left out, as every post row takes it.
 */
export function parseTikTokUrl(raw: string): TikTokLink | null {
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
  if (SHORT_HOSTS.has(host)) {
    const code = SHORT_PATH.exec(url.pathname)?.[1];
    return code ? { kind: 'short', id: code, author: '', url: `https://${host}/${code}/` } : null;
  }
  if (!POST_HOSTS.has(host)) return null;
  const share = SHARE_PATH.exec(url.pathname)?.[1];
  if (share) return { kind: 'short', id: share, author: '', url: `https://www.tiktok.com/t/${share}/` };
  const found = POST_PATH.exec(url.pathname);
  if (found) return post(found[2] as 'video' | 'photo', found[3], found[1]);
  const other = MOBILE_PATH.exec(url.pathname)?.[1] ?? EMBED_PATH.exec(url.pathname)?.[1];
  return other ? post('video', other, '') : null;
}

/**
 * Where a share link led, read as a post: null when it is not one. An unknown or expired share
 * code leads to TikTok's home page, `/?_r=1`, which is null here too. A resolved link is never
 * resolved again.
 */
export function parseResolvedTikTokUrl(location: string): Extract<TikTokLink, { kind: 'video' | 'photo' }> | null {
  const link = parseTikTokUrl(location);
  return link && link.kind !== 'short' ? link : null;
}

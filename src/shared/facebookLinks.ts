/** facebook.com, its mobile hosts, and the short hosts that redirect to it. */
const FACEBOOK_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'mbasic.facebook.com',
  'touch.facebook.com', 'business.facebook.com', 'fb.com', 'www.fb.com', 'fb.watch', 'www.fb.watch',
]);

/** A video, reel, photo or post id: digits. */
const NUMERIC = '\\d{5,25}';
/** A post id the site hides behind a token (`pfbid0…`), as the share button copies it. */
const PFBID = 'pfbid0[A-Za-z0-9]{20,90}';
const POST_ID = `(?:${NUMERIC}|${PFBID})`;
/** A page's or person's name in a URL. */
const NAME = '[A-Za-z0-9.\\-_]{1,80}';
/** What the app's share button copies: `/share/r/<code>/` for a reel, `/share/p/` for a post, `/share/v/` for a video. */
const SHARE_PATH = /^\/share\/(?:([a-z])\/)?([A-Za-z0-9_-]{4,40})\/?$/;
const FB_WATCH_PATH = /^\/([A-Za-z0-9_-]{4,40})\/?$/;
const REEL_PATH = new RegExp(`^/reels?/(${NUMERIC})(?:/|$)`);
/** `/<page>/videos/<id>/`, also with a title slug or a `vb.<page>` segment in between. */
const VIDEOS_PATH = new RegExp(`^/(${NAME})/videos/(?:[^/]+/)*?(${NUMERIC})/?$`);
const POSTS_PATH = new RegExp(`^/(${NAME})/posts/(${POST_ID})(?:/|$)`);
const GROUP_POST_PATH = new RegExp(`^/groups/(${NAME})/(?:posts|permalink)/(${NUMERIC})(?:/|$)`);
/** `/stories/<bucket>/` and `/stories/<bucket>/<card>/`: a person's stories, opened at one card. */
const STORIES_PATH = new RegExp(`^/stories/(${NUMERIC})(?:/([^/]{8,600}))?/?$`);
/** A story card's id: base64 (`S:_ISC:<id>`), as the story viewer's address shows it. */
const STORY_CARD = /^[A-Za-z0-9+/=]{8,512}$/;

/** First path segments that are pages of Facebook's own, never a page or a person. */
const RESERVED = new Set(['groups', 'share', 'watch', 'reel', 'reels', 'photo', 'photos', 'events', 'marketplace', 'gaming', 'stories', 'login', 'pages']);

/**
 * What a link names: a reel; any other video; a post (a page's, a person's or a group's); a share
 * link, which names one of those only after Facebook redirects it; or a person's stories.
 */
export type FacebookLinkKind = 'reel' | 'video' | 'post' | 'share' | 'story';

/**
 * Which of a person's stories a story link takes. "" (the link as Facebook gives it): a menu of
 * them all to choose from; `one`: only the card it names; `all`: every one. The last two exist
 * only in links Yobi writes, behind the menu's buttons.
 */
export type FacebookStoryPick = '' | 'one' | 'all';

/** Yobi's own query parameter on a story link: the menu's choice, which Facebook ignores. */
const STORY_PICK_PARAM = 'yobi';

export interface FacebookStoryRef {
  /** The story bucket's id, the first part of the link. */
  bucket: string;
  /** The card the link opens at; "" for none. */
  card: string;
  pick: FacebookStoryPick;
}

export interface FacebookRef {
  kind: FacebookLinkKind;
  /** The link to read, rebuilt from the parts below: nothing else the person typed reaches a request. */
  url: string;
  /** The video id, the post id (`pfbid0…` or digits), the share code, or a story's card (else its bucket). */
  id: string;
  /** The page or person the URL names; "" where it names none. */
  author: string;
  /** A story link's parts. */
  story?: FacebookStoryRef;
}

export function isFacebookHost(host: string): boolean {
  return FACEBOOK_HOSTS.has(host.toLowerCase());
}

/** A page's or person's name in their profile link, which Yobi shows as "@"; "" for a numbered profile. */
export function facebookHandleOf(url: string): string {
  const match = /^https:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.]{2,80})\/?$/.exec(url);
  return match && !['profile.php', 'people'].includes(match[1]) ? match[1] : '';
}

export function facebookReelLink(id: string): string {
  return `https://www.facebook.com/reel/${id}/`;
}

/** A video's own page: Facebook redirects it to the page's `/videos/` URL. */
export function facebookVideoLink(id: string): string {
  return `https://www.facebook.com/watch/?v=${id}`;
}

/**
 * A story link: the page to read is the same for every pick (`pick` ""), the choice rides along
 * as Yobi's own parameter. `/` and `+` in a card's base64 are escaped so it stays one path segment.
 */
export function facebookStoryLink(bucket: string, card: string, pick: FacebookStoryPick = ''): string {
  const segment = card ? `${card.replace(/\//g, '%2F').replace(/\+/g, '%2B')}/` : '';
  return `https://www.facebook.com/stories/${bucket}/${segment}${pick ? `?${STORY_PICK_PARAM}=${pick}` : ''}`;
}

function storyRef(bucket: string, rawCard: string, url: URL): FacebookRef | null {
  let card = '';
  if (rawCard) {
    try {
      card = decodeURIComponent(rawCard);
    } catch {
      return null;
    }
    if (!STORY_CARD.test(card)) return null;
  }
  const asked = url.searchParams.get(STORY_PICK_PARAM) ?? '';
  // "one" names a card: without one it is the menu, as the link alone would be.
  const pick: FacebookStoryPick = asked === 'all' ? 'all' : asked === 'one' && card ? 'one' : '';
  return {
    kind: 'story',
    url: facebookStoryLink(bucket, card, pick),
    id: card || bucket,
    author: '',
    story: { bucket, card, pick },
  };
}

function idParam(url: URL, name: string): string {
  const value = url.searchParams.get(name) ?? '';
  return new RegExp(`^${POST_ID}$`).test(value) ? value : '';
}

function videoRef(id: string, author = ''): FacebookRef {
  return { kind: 'video', url: facebookVideoLink(id), id, author };
}

function postRef(url: string, id: string, author: string): FacebookRef {
  return { kind: 'post', url, id, author };
}

function readPath(url: URL): FacebookRef | null {
  const path = url.pathname;
  if (url.hostname.toLowerCase().replace(/^www\./, '') === 'fb.watch') {
    const code = FB_WATCH_PATH.exec(path)?.[1];
    return code ? { kind: 'share', url: `https://fb.watch/${code}/`, id: code, author: '' } : null;
  }
  const share = SHARE_PATH.exec(path);
  if (share) {
    const type = share[1] ? `${share[1]}/` : '';
    return { kind: 'share', url: `https://www.facebook.com/share/${type}${share[2]}/`, id: share[2], author: '' };
  }
  const reel = REEL_PATH.exec(path);
  if (reel) return { kind: 'reel', url: facebookReelLink(reel[1]), id: reel[1], author: '' };
  const stories = STORIES_PATH.exec(path);
  if (stories) return storyRef(stories[1], stories[2] ?? '', url);
  if (/^\/watch\/?$/.test(path) || path === '/video.php') {
    const id = url.searchParams.get('v') ?? '';
    return new RegExp(`^${NUMERIC}$`).test(id) ? videoRef(id) : null;
  }
  const video = VIDEOS_PATH.exec(path);
  if (video && !RESERVED.has(video[1].toLowerCase())) return videoRef(video[2], video[1]);
  const group = GROUP_POST_PATH.exec(path);
  if (group) return postRef(`https://www.facebook.com/groups/${group[1]}/posts/${group[2]}/`, group[2], '');
  if (path === '/permalink.php' || path === '/story.php') {
    const story = idParam(url, 'story_fbid');
    const owner = url.searchParams.get('id') ?? '';
    if (!story || !new RegExp(`^${NUMERIC}$`).test(owner)) return null;
    return postRef(`https://www.facebook.com/permalink.php?story_fbid=${story}&id=${owner}`, story, '');
  }
  const post = POSTS_PATH.exec(path);
  if (post && !RESERVED.has(post[1].toLowerCase())) {
    return postRef(`https://www.facebook.com/${post[1]}/posts/${post[2]}/`, post[2], post[1]);
  }
  return null;
}

/**
 * A Facebook reel (`/reel/<id>`), video (`/watch?v=`, `/<page>/videos/…/<id>`, `/video.php?v=`),
 * post (`/<page>/posts/<id|pfbid…>`, `/permalink.php`, `/story.php`, a group's
 * `/groups/<group>/posts/<id>`), share link (`/share/r|p|v/<code>`, `fb.watch/<code>`), or a
 * person's stories (`/stories/<bucket>/`, `/stories/<bucket>/<card>/`).
 */
export function parseFacebookUrl(raw: string): FacebookRef | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!isFacebookHost(url.hostname) || url.username || url.password || url.port) return null;
  return readPath(url);
}

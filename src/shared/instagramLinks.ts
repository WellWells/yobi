/** instagram.com and the hosts that redirect to it. */
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am']);

/** Instagram usernames: letters, digits, dots and underscores, up to 30. */
const USERNAME = '[A-Za-z0-9._]{1,30}';
/** A post's shortcode: URL-safe base64, 11 characters for a public post, longer for a private one. */
const CODE = '[A-Za-z0-9_-]{5,60}';

const POST_PATH = new RegExp(`^/(?:(${USERNAME})/)?(p|reels?|tv)/(${CODE})(?:/|$)`);
const STORY_PATH = new RegExp(`^/stories/(${USERNAME})/(\\d{5,25})(?:/|$)`);
const STORIES_PATH = new RegExp(`^/stories/(${USERNAME})/?$`);
const HIGHLIGHT_PATH = /^\/stories\/highlights\/(\d{5,25})(?:\/|$)/;
/** What the app's share button copies for a highlight: base64 of `highlight:<id>`. */
const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{8,80}=*)(?:\/|$)/;
/** An account's profile: its name alone (Instagram's own grid tabs, `/reels/` and `/tagged/`, too). */
const PROFILE_PATH = new RegExp(`^/(${USERNAME})(?:/(?:(?:reels|tagged)/?)?)?$`);

/** First path segments that are pages of Instagram's own, never an account. */
const RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 's', 'direct', 'about', 'legal',
  'developer', 'web', 'privacy', 'terms', 'challenge', 'emails', 'api', 'static', 'oauth', 'session',
  'graphql', 'ajax', 'qr', 'nametag', 'create', 'topics', 'directory', 'download', 'lite', 'press',
]);

export function isInstagramHost(host: string): boolean {
  return INSTAGRAM_HOSTS.has(host.toLowerCase());
}

/**
 * What a link names: one post or reel; one story; every story an account has up now; a
 * highlight, a set of old stories the account keeps on its profile; or the account's profile.
 */
export type InstagramLinkKind = 'post' | 'story' | 'stories' | 'highlight' | 'profile';

/**
 * Which items a story, stories or highlight link takes, as Facebook's stories do. Absent (the link
 * as Instagram gives it): a menu of them all to choose from; `one`: only the story it names; `all`:
 * every one. Both exist only in links Yobi writes, behind the menu's buttons.
 */
export type InstagramStoryPick = 'one' | 'all';

/** Yobi's own query parameter on a story link: the menu's choice, which Instagram ignores. */
const STORY_PICK_PARAM = 'yobi';

export interface InstagramRef {
  kind: InstagramLinkKind;
  /** The link to read, rebuilt from the parts below: nothing else the person typed reaches a request. */
  url: string;
  /** The shortcode, the story's media id, the account (`stories`), or the highlight's id. */
  id: string;
  /** "" where the link names no account. */
  author: string;
  /** A story link's choice from the menu; absent for the menu itself and for a post. */
  pick?: InstagramStoryPick;
  /** The story `one` takes: a story link's own id, or the highlight item its link names. */
  item?: string;
}

/** Instagram's own parameter naming one item of a highlight (its share links carry it too). */
const HIGHLIGHT_ITEM_PARAM = 'story_media_id';
const MEDIA_ID = /^\d{5,25}$/;

function decodeShareId(token: string): string {
  try {
    const text = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    return /^highlight:(\d{5,25})$/.exec(text)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function instagramPostLink(code: string, reel = false): string {
  return `https://www.instagram.com/${reel ? 'reel' : 'p'}/${code}/`;
}

function withPick(link: string, pick: InstagramStoryPick | undefined): string {
  return pick ? `${link}?${STORY_PICK_PARAM}=${pick}` : link;
}

export function instagramStoryLink(author: string, mediaId: string, pick?: InstagramStoryPick): string {
  return withPick(`https://www.instagram.com/stories/${author}/${mediaId}/`, pick);
}

/** An account's current stories; `pick` `all` takes them all, absent offers the menu. */
export function instagramStoriesLink(author: string, pick?: 'all'): string {
  return withPick(`https://www.instagram.com/stories/${author}/`, pick);
}

/** An account's profile: alone, a menu of its latest posts; `all` takes every one of them. */
export function instagramProfileLink(author: string, pick?: 'all'): string {
  return withPick(`https://www.instagram.com/${author}/`, pick);
}

/** A highlight; `one` takes the item `item` names (and only with one), `all` every item, absent offers the menu. */
export function instagramHighlightLink(id: string, pick?: InstagramStoryPick, item = ''): string {
  const link = `https://www.instagram.com/stories/highlights/${id}/`;
  if (pick !== 'one') return withPick(link, pick);
  return MEDIA_ID.test(item) ? `${link}?${HIGHLIGHT_ITEM_PARAM}=${item}&${STORY_PICK_PARAM}=one` : link;
}

/** The menu's choice a link carries: `one` only where it names a story, `all` anywhere. */
function pickOf(url: URL, names: 'story' | 'set'): InstagramStoryPick | undefined {
  const asked = url.searchParams.get(STORY_PICK_PARAM);
  if (asked === 'all') return 'all';
  return asked === 'one' && names === 'story' ? 'one' : undefined;
}

function storyRef(
  kind: InstagramLinkKind, url: string, id: string, author: string, pick: InstagramStoryPick | undefined, item = '',
): InstagramRef {
  return { kind, url, id, author, ...(pick ? { pick } : {}), ...(pick === 'one' ? { item } : {}) };
}

/**
 * An Instagram post (`/p/…`, `/reel/…`, `/tv/…`, also under an account's name), a story
 * (`/stories/<account>/<id>/`), an account's current stories (`/stories/<account>/`) or a
 * highlight (`/stories/highlights/<id>/`, or the `/s/…` share link the app copies for one).
 */
export function parseInstagramUrl(raw: string): InstagramRef | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!isInstagramHost(url.hostname) || url.username || url.password || url.port) return null;
  const path = url.pathname;
  const highlight = HIGHLIGHT_PATH.exec(path);
  if (highlight) return highlightRef(highlight[1], url);
  const story = STORY_PATH.exec(path);
  if (story) {
    const pick = pickOf(url, 'story');
    return storyRef('story', instagramStoryLink(story[1], story[2], pick), story[2], story[1], pick, story[2]);
  }
  const stories = STORIES_PATH.exec(path);
  if (stories && !RESERVED.has(stories[1].toLowerCase())) {
    const pick = pickOf(url, 'set');
    return storyRef('stories', instagramStoriesLink(stories[1], pick === 'all' ? pick : undefined), stories[1], stories[1], pick);
  }
  const share = SHARE_PATH.exec(path);
  if (share) {
    const id = decodeShareId(share[1]);
    return id ? highlightRef(id, url) : null;
  }
  const post = POST_PATH.exec(path);
  if (post && !(post[1] && RESERVED.has(post[1].toLowerCase()))) {
    return { kind: 'post', url: instagramPostLink(post[3], post[2] !== 'p' && post[2] !== 'tv'), id: post[3], author: post[1] ?? '' };
  }
  const profile = PROFILE_PATH.exec(path);
  if (profile && !RESERVED.has(profile[1].toLowerCase())) {
    const pick = pickOf(url, 'set') === 'all' ? 'all' : undefined;
    return storyRef('profile', instagramProfileLink(profile[1], pick), profile[1], profile[1], pick);
  }
  return null;
}

function highlightRef(id: string, url: URL): InstagramRef {
  const item = url.searchParams.get(HIGHLIGHT_ITEM_PARAM) ?? '';
  // `one` names an item only with one; a share link's `story_media_id` alone still offers the menu.
  const pick = pickOf(url, MEDIA_ID.test(item) ? 'story' : 'set');
  return storyRef('highlight', instagramHighlightLink(id, pick, item), id, '', pick, item);
}

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The media id a shortcode stands for: its first 11 characters in base 64 (a private post's
 * longer code adds a suffix that is not part of the id).
 */
export function instagramMediaId(code: string): string {
  let id = 0n;
  for (const char of code.slice(0, 11)) {
    const digit = SHORTCODE_ALPHABET.indexOf(char);
    if (digit < 0) return '';
    id = id * 64n + BigInt(digit);
  }
  return id.toString();
}

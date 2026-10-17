import { parseFacebookUrl } from '../facebookLinks';
import { BILIBILI_SHARE_TITLE, parseBilibiliUrl } from './bilibiliLinks';
import { parseDcardUrl } from './dcardLinks';
import { parseInstagramUrl } from '../instagramLinks';
import { parseM3u8Url } from './m3u8Links';
import { parseThreadsPostUrl } from '../threadsLinks';
import { parsePttUrl } from './pttLinks';
import { parseRedditUrl } from './redditLinks';
import { parseSoundcloudUrl } from './soundcloudLinks';
import { parseTikTokUrl } from './tiktokLinks';
import { parseVimeoUrl } from './vimeoLinks';
import { parseXPostUrl } from '../xHandles';
import { isYoutubeMusicUrl, strictYoutubeVideoId, youtubeWatchUrl } from '../youtubeUrl';
import type { LinkMatch, LinkRef, LinkSiteRow, PostRef, PostRow, PostSiteId, VideoRef, VideoRow, VideoSiteId } from './types';

function postRef(site: PostSiteId, ref: { url: string; id: string; author: string; kind?: string }): PostRef {
  return { site, shape: 'post', url: ref.url, id: ref.id, author: ref.author, ...(ref.kind ? { kind: ref.kind } : {}) };
}

/** A YouTube video by its id, the link rebuilt as the standard watch URL. */
export function youtubeVideoRef(id: string): VideoRef {
  return { site: 'youtube', shape: 'video', url: youtubeWatchUrl(id), id, author: '' };
}

/*
 * Each post row checks the host by pattern before its parser runs, so a token naming another
 * site's host is never handed to this site's parser.
 */
const X_ROW: PostRow = {
  id: 'x',
  label: 'X',
  shape: 'post',
  match(token) {
    if (!/(?:^|[./])(?:x|twitter)\.com\//i.test(token)) return null;
    const ref = parseXPostUrl(token);
    return ref ? postRef('x', { url: `https://x.com/${ref.author || 'i'}/status/${ref.id}`, id: ref.id, author: ref.author }) : null;
  },
};

const THREADS_ROW: PostRow = {
  id: 'threads',
  label: 'Threads',
  shape: 'post',
  match(token) {
    if (!/(?:^|[./])threads\.(?:com|net)\//i.test(token)) return null;
    const ref = parseThreadsPostUrl(token);
    return ref ? postRef('threads', ref) : null;
  },
};

const INSTAGRAM_ROW: PostRow = {
  id: 'instagram',
  label: 'Instagram',
  shape: 'post',
  match(token) {
    if (!/(?:^|[./])(?:instagram\.com|instagr\.am)\//i.test(token)) return null;
    const ref = parseInstagramUrl(token);
    return ref ? postRef('instagram', ref) : null;
  },
  // A story, an account's stories or a highlight: media only, no caption or comments.
  mediaOnly: (ref) => ref.kind !== 'post' && ref.kind !== 'profile',
  account: (ref) => ref.kind === 'profile',
};

const FACEBOOK_ROW: PostRow = {
  id: 'facebook',
  label: 'Facebook',
  shape: 'post',
  match(token) {
    if (!/(?:^|[./])(?:facebook\.com|fb\.com|fb\.watch)\//i.test(token)) return null;
    const ref = parseFacebookUrl(token);
    return ref ? postRef('facebook', ref) : null;
  },
  // A person's stories: media only, no caption or comments.
  mediaOnly: (ref) => ref.kind === 'story',
};

/*
 * A TikTok video or photo post, or a share link: taken before it is resolved, as a Facebook share
 * link is — the reader follows it and turns away one that leads to no post. A video is a post
 * here, not a quality menu: TikTok serves one picture size, so there is nothing to choose.
 */
const TIKTOK_ROW: PostRow = {
  id: 'tiktok',
  label: 'TikTok',
  shape: 'post',
  match(token) {
    if (!/(?:^|[./])tiktok\.com\//i.test(token)) return null;
    const ref = parseTikTokUrl(token);
    return ref ? postRef('tiktok', ref) : null;
  },
};

/*
 * A PTT article, or a mirror's copy of one (pttweb.cc, moptt.tw) read on PTT itself: its text,
 * pictures and push tally forwarded; its pushes analyzed.
 */
const PTT_ROW: PostRow = {
  id: 'ptt',
  label: 'PTT',
  shape: 'post',
  match(token) {
    if (!/(?:^|[./])(?:ptt\.cc|pttweb\.cc|moptt\.tw)\//i.test(token)) return null;
    const ref = parsePttUrl(token);
    return ref ? postRef('ptt', ref) : null;
  },
  pushes: true,
};

/*
 * A Dcard post, a floor of it or a persona's post: the link rebuilt without its share parameters.
 * Its comments are what "analyze" is for, so it is never media-only: the 100 most-liked and up to
 * 10 replies under each of the top 3.
 */
const DCARD_ROW: PostRow = {
  id: 'dcard',
  label: 'Dcard',
  shape: 'post',
  analysisReplies: 130,
  match(token) {
    if (!/(?:^|[./])dcard\.tw\//i.test(token)) return null;
    const ref = parseDcardUrl(token);
    return ref ? postRef('dcard', ref) : null;
  },
};

/*
 * A Reddit post (text, a picture, a gallery or a video), a share link or a v.redd.it video: taken
 * before a share link is resolved, as a TikTok one is — the reader follows it and turns away one
 * that leads to no post. Its text and media forwarded; the comments its page carries analyzed —
 * the first 25, all the page holds signed out.
 */
const REDDIT_ROW: PostRow = {
  id: 'reddit',
  label: 'Reddit',
  shape: 'post',
  analysisReplies: 25,
  match(token) {
    if (!/(?:^|[./])(?:reddit\.com|redd\.it)\//i.test(token)) return null;
    const ref = parseRedditUrl(token);
    return ref ? postRef('reddit', ref) : null;
  },
};

/*
 * A YouTube Music link is the same video under the same watch URL; its kind `music` makes the
 * link alone the MP3 rather than the menu (`parseVideoInput`).
 */
const YOUTUBE_ROW: VideoRow = {
  id: 'youtube',
  label: 'YouTube',
  shape: 'video',
  summary: true,
  subtitles: true,
  match(token) {
    const id = strictYoutubeVideoId(token);
    if (!id) return null;
    return isYoutubeMusicUrl(token) ? { ...youtubeVideoRef(id), kind: 'music' } : youtubeVideoRef(id);
  },
};

/**
 * A bilibili video or `b23.tv` share link. A share link is taken as a video before it is resolved
 * (`match` cannot wait on the network): `info` resolves it and turns away one that does not lead
 * to a single video. Its kind is `short` and its id the share code until then.
 */
export function bilibiliVideoRef(token: string): VideoRef | null {
  const link = parseBilibiliUrl(token);
  if (!link) return null;
  if (link.kind === 'short') return { site: 'bilibili', shape: 'video', url: link.url, id: link.id, author: '', kind: 'short' };
  const variant = link.part > 1 ? { variant: `p=${link.part}` } : {};
  return { site: 'bilibili', shape: 'video', url: link.url, id: link.id, author: '', ...variant };
}

/*
 * "summary" is the site's: whether a given video has one is the read's (`VideoInfo.summary`),
 * false while signed out, when bilibili gives no captions.
 */
const BILIBILI_ROW: VideoRow = {
  id: 'bilibili',
  label: 'bilibili',
  shape: 'video',
  summary: true,
  subtitles: true,
  match: bilibiliVideoRef,
  shareTitle: BILIBILI_SHARE_TITLE,
};

/**
 * A SoundCloud track, playlist or `on.soundcloud.com` share link, its kind `track`, `set` or
 * `short`. A playlist and a share link are taken before anything is read: `info` turns away a
 * playlist with a note (one track at a time) and resolves a share link.
 */
export function soundcloudRef(token: string): VideoRef | null {
  const link = parseSoundcloudUrl(token);
  return link ? { site: 'soundcloud', shape: 'video', url: link.url, id: link.id, author: link.artist, kind: link.kind } : null;
}

/* Sound only: the menu is the MP3, with no qualities, summary or subtitles. */
const SOUNDCLOUD_ROW: VideoRow = {
  id: 'soundcloud',
  label: 'SoundCloud',
  shape: 'video',
  summary: false,
  subtitles: false,
  audioOnly: true,
  match: soundcloudRef,
};

/** A Vimeo video, the link rebuilt as `https://vimeo.com/<id>` (+ an unlisted video's hash). */
export function vimeoVideoRef(token: string): VideoRef | null {
  const link = parseVimeoUrl(token);
  return link ? { site: 'vimeo', shape: 'video', url: link.url, id: link.id, author: '' } : null;
}

/*
 * No "summary": only the quality menu, the MP3 and the subtitles (.srt) from the video's own
 * caption tracks, which a given video may not have (`VideoInfo.subtitles`).
 */
const VIMEO_ROW: VideoRow = {
  id: 'vimeo',
  label: 'Vimeo',
  shape: 'video',
  summary: false,
  subtitles: true,
  match: vimeoVideoRef,
};

/** A bare `.m3u8` playlist link on any host, its id a hash of the link (`m3u8Links.ts`). */
export function m3u8VideoRef(token: string): VideoRef | null {
  const link = parseM3u8Url(token);
  return link ? { site: 'm3u8', shape: 'video', url: link.url, id: link.id, author: '' } : null;
}

/*
 * The stream itself, not a site: no "summary" or subtitles, only the quality menu and the MP3.
 * Last, so a site's row always takes its own links first.
 */
const M3U8_ROW: VideoRow = {
  id: 'm3u8',
  label: 'm3u8',
  shape: 'video',
  summary: false,
  subtitles: false,
  match: m3u8VideoRef,
};

/** Every link site, in the order a token is tried against them. The order is behaviour. */
export const LINK_SITE_ROWS: readonly LinkSiteRow[] = [
  X_ROW, THREADS_ROW, INSTAGRAM_ROW, FACEBOOK_ROW, TIKTOK_ROW, PTT_ROW, DCARD_ROW, REDDIT_ROW, YOUTUBE_ROW, BILIBILI_ROW, SOUNDCLOUD_ROW, VIMEO_ROW, M3U8_ROW,
];

const POST_ROWS = LINK_SITE_ROWS.filter((row): row is PostRow => row.shape === 'post');
const VIDEO_ROWS = LINK_SITE_ROWS.filter((row): row is VideoRow => row.shape === 'video');

/** The first token any row takes, and the other tokens as the prompt. */
function scan<R extends LinkRef>(text: string, take: (token: string) => R | null): LinkMatch<R> | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (const [index, token] of tokens.entries()) {
    const ref = take(token);
    if (!ref) continue;
    const prompt = [...tokens.slice(0, index), ...tokens.slice(index + 1)].join(' ').trim();
    return { ref, prompt };
  }
  return null;
}

function firstMatch<R>(rows: ReadonlyArray<{ match(token: string): R | null }>, token: string): R | null {
  for (const row of rows) {
    const ref = row.match(token);
    if (ref) return ref;
  }
  return null;
}

/**
 * The first post link in `text` and the words around it. Telegram's `<link>` is unwrapped for a
 * post, never for a video.
 */
export function matchPostLink(text: string): LinkMatch<PostRef> | null {
  return scan(text, (token) => firstMatch(POST_ROWS, token.replace(/^<|>$/g, '')));
}

/** The video a single token links to, whichever video row takes it; null when none does. */
export function matchVideoRef(token: string): VideoRef | null {
  return firstMatch(VIDEO_ROWS, token);
}

/** Whether `site`'s menu offers "summary" (its row's `summary`). */
export function videoHasSummary(site: VideoSiteId): boolean {
  return VIDEO_ROWS.some((row) => row.id === site && row.summary);
}

/** Whether `site`'s menu offers "subtitles" (its row's `subtitles`). */
export function videoHasSubtitles(site: VideoSiteId): boolean {
  return VIDEO_ROWS.some((row) => row.id === site && row.subtitles);
}

/** Whether `site` has sound only (its row's `audioOnly`): the menu is its MP3 alone. */
export function videoIsAudioOnly(site: VideoSiteId): boolean {
  return VIDEO_ROWS.some((row) => row.id === site && row.audioOnly === true);
}

/**
 * `text` with a video row's own share title taken out (the bracketed title a site's share button
 * puts before a `b23.tv` link, the row's `shareTitle`): the first such block that stands directly
 * before — whitespace at most between — a link that row takes. This is the one exception to
 * "anything beside a link is a question for the agent": any other block, one after the link, or
 * one before another site's link stays as written, words beside the link.
 */
export function withoutShareTitle(text: string): string {
  for (const row of VIDEO_ROWS) {
    if (!row.shareTitle) continue;
    const flags = row.shareTitle.flags.includes('g') ? row.shareTitle.flags : `${row.shareTitle.flags}g`;
    const block = new RegExp(String.raw`(?:${row.shareTitle.source})\s*(?=(\S+))`, flags);
    for (const found of text.matchAll(block)) {
      if (!row.match(found[1] ?? '')) continue;
      return `${text.slice(0, found.index)} ${text.slice(found.index + found[0].length)}`;
    }
  }
  return text;
}

/**
 * The link a message is about: a post link anywhere in it wins over a video link ("YouTube link +
 * X link" is an X post with words); only a message with no post link is looked at for a video,
 * its site's share title read as part of the link (`withoutShareTitle`). A second link is just a
 * word beside the first, which makes the message the agent's.
 */
export function matchLink(text: string): LinkMatch | null {
  return matchPostLink(text) ?? scan(withoutShareTitle(text), matchVideoRef);
}

export function rowById(id: string): LinkSiteRow | undefined {
  return LINK_SITE_ROWS.find((row) => row.id === id);
}

/** The site's own name (its row's `label`), the id itself for one the table does not know. */
export function siteLabel(id: string): string {
  return rowById(id)?.label ?? id;
}

/**
 * Whether a post link carries media only (an Instagram story): no caption or replies to analyze,
 * so no "analyze" button. A link its row cannot read back counts as one with no kind.
 */
export function isMediaOnlyPost(site: PostSiteId, url: string): boolean {
  const row = rowById(site);
  if (row?.shape !== 'post' || !row.mediaOnly) return false;
  return row.mediaOnly(row.match(url) ?? postRef(site, { url, id: '', author: '' }));
}

/** Whether a post link names a whole account (an Instagram profile): its "analyze" sums up the account. */
export function isAccountPost(site: PostSiteId, url: string): boolean {
  const row = rowById(site);
  if (row?.shape !== 'post' || !row.account) return false;
  const ref = row.match(url);
  return ref ? row.account(ref) : false;
}

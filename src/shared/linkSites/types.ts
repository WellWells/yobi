/** The sites whose links Yobi reads as a post: text, media and replies. */
export type PostSiteId = 'x' | 'threads' | 'instagram' | 'facebook' | 'tiktok' | 'ptt' | 'dcard' | 'reddit';
/**
 * The sites whose links Yobi reads as a video with a quality menu (SoundCloud's: its MP3 alone),
 * and a bare HLS playlist link on any host (`m3u8`).
 */
export type VideoSiteId = 'youtube' | 'bilibili' | 'soundcloud' | 'vimeo' | 'm3u8';
export type LinkSiteId = PostSiteId | VideoSiteId;

interface RefBase {
  /** The link rebuilt from its id: nothing else the person typed reaches a request. */
  url: string;
  id: string;
  /** "" where the link names no account. */
  author: string;
  /**
   * The site parser's own kind of link (an Instagram `story`, a Facebook `share`, a TikTok
   * `photo`, a YouTube Music `music`), when it has one.
   */
  kind?: string;
}

export interface PostRef extends RefBase {
  site: PostSiteId;
  shape: 'post';
}

export interface VideoRef extends RefBase {
  site: VideoSiteId;
  shape: 'video';
  /**
   * Which file of the id this link is, when one id holds several (a bilibili part, `p=2`): part
   * of the download's reuse key. Absent for a site with one file per id (YouTube).
   */
  variant?: string;
}

export type LinkRef = PostRef | VideoRef;

/** A link found in a message and what the person wrote around it ("" for a bare link). */
export interface LinkMatch<R extends LinkRef = LinkRef> {
  ref: R;
  prompt: string;
}

export interface PostRow {
  id: PostSiteId;
  /** The site's own name, never translated. */
  label: string;
  shape: 'post';
  /** One whitespace-free token, already out of Telegram's `<…>`; null when it is not this site's post. */
  match(token: string): PostRef | null;
  /** A link with media only, no caption or replies to analyze (an Instagram story). */
  mediaOnly?(ref: PostRef): boolean;
  /** A link naming a whole account (an Instagram profile): a menu of its posts, an analysis of the account. */
  account?(ref: PostRef): boolean;
  /**
   * Its replies are pushes (PTT's push, boo and arrow marks): hundreds of one-line verdicts under an article. Its
   * "analyze" reads them by a character budget, sampled when they do not fit, with a prompt of
   * their own.
   */
  pushes?: boolean;
  /**
   * How many replies the site's "analyze" reads at most, when it is not the usual 40 (Dcard: its
   * 100 most-liked comments and the replies under the top three). Only this site's prompt grows.
   */
  analysisReplies?: number;
}

export interface VideoRow {
  id: VideoSiteId;
  label: string;
  shape: 'video';
  /** One whitespace-free token exactly as typed; null when it is not this site's video. */
  match(token: string): VideoRef | null;
  /**
   * Whether the menu offers "summary": the site's adapter reads the video's own words
   * (`VIDEO_SITES[site].transcript`). Without it the summary word beside a link is not the menu's,
   * and the site's built-ins have no summary branch.
   */
  summary: boolean;
  /**
   * Whether the menu offers "subtitles" (an .srt file Yobi builds from the video's timed captions,
   * `VideoInfo.subtitles`). Without it the subtitles word beside a link is not the menu's.
   */
  subtitles: boolean;
  /**
   * The site has sound only (SoundCloud): its menu offers the MP3 alone, and a quality word beside
   * its link (720, best) is not the menu's.
   */
  audioOnly?: boolean;
  /**
   * The title block the site's own share button writes before its link (bilibili's bracketed
   * title ending in the site name), matched as one block: when it stands directly before a link
   * this row takes, it is read as part of that link, not as words beside it.
   */
  shareTitle?: RegExp;
}

export type LinkSiteRow = PostRow | VideoRow;

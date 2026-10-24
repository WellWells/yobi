import type { SiteDownloadHooks } from '../../downloader/downloadVideo';
import type { CookieSource } from '../../downloader/siteCookies';
import type { FetchLimit } from '../../downloader/streamTypes';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import type { SizeLimit, YtdlChoice, YtdlDestination, YtdlPick, YtdlProgressSample } from '../../../shared/ytdl';
import type { VideoRef } from '../../../shared/linkSites/types';
import type { ReadAccess } from './readAccess';
import type { SubtitleCue } from './srt';

/*
 * The shape of a video site's adapter, apart from the table (`videoSites.ts`) so each site's own
 * module can implement it without importing the table that imports it.
 */

/** One subtitle track as read, with the site's timing. */
export interface TimedSubtitles {
  /** The track's language as the site codes it (`en`, `zh-Hant`, `ai-zh`). */
  language: string;
  /** Machine-made: YouTube's automatic captions, bilibili's AI subtitles. */
  auto: boolean;
  cues: SubtitleCue[];
}

/** A video as the menu shows it, whichever site it is on. */
export interface VideoInfo {
  ref: VideoRef;
  title: string;
  channel: string;
  durationS: number;
  /** The cover image's URL; "" when the site gave none. */
  cover: string;
  /**
   * Whether this video can be summed up now: the menu draws "summary" (and says summaries still
   * work while downloads are paused) only then. Never true for a row without `summary`; a site
   * whose words need a sign-in (bilibili) says false while signed out.
   */
  summary: boolean;
  /**
   * No summary because the site gives a video's words only to a signed-in account and this read
   * was signed out: the menu says so in one line (bilibili).
   */
  summaryNeedsSignIn?: boolean;
  /**
   * This video is one part of several under one id (a bilibili video in parts — episodes, or the
   * same video in several languages): which one, of how many. Only that part is downloaded, and
   * the menu says so. Absent for a video in one part.
   */
  part?: { index: number; total: number };
  /**
   * Reads this video's subtitles with their timing, for an .srt file; present exactly when the
   * video has subtitles to read now (the menu draws its "subtitles" button only then). Never on a
   * row without `subtitles`; bilibili leaves it out while signed out. Needs no download tools.
   * Throws the `FlowUserError` the person can act on; empty `cues` when the track had no words.
   */
  subtitles?(signal?: AbortSignal): Promise<TimedSubtitles>;
  /**
   * The qualities offered, smallest first, each with a size estimate for what a download to
   * `destination` would most likely pick; under 360p only with `includeSmall` or when nothing larger exists.
   * `limitBytes` is the most the file may be for this person (`downloadLimitBytes`; left out = the
   * Bot API's limit): a site that can swap in a low AAC (`withLowAudio`) prices against it.
   */
  choices(destination: YtdlDestination, includeSmall?: boolean, limitBytes?: SizeLimit): YtdlChoice[];
}

/** What a site that downloads by itself (`VideoSite.download`) is asked for. */
export interface SelfDownloadRequest {
  /** The read that offered the menu (`info`); `info.ref` is the video to download. */
  info: VideoInfo;
  /** A quality the menu offered (the short side), `best`, or `mp3` (the sound alone). */
  pick: YtdlPick;
  destination: YtdlDestination;
  /** `youtube_download`'s job folder: everything is written here, the file included. */
  jobDir: string;
  signal?: AbortSignal;
  /**
   * The most the download may receive, counted as the bytes arrive (`downloadStreams`'
   * `fetchLimit`): the menu's sizes are the playlist's word, this holds the stream to what it
   * really sends. Every site hands it on; none = no limit.
   */
  fetchLimit?: FetchLimit;
  /** Bytes so far against a total (the estimate, when the site has one): the step's progress bar. */
  onProgress?: (sample: YtdlProgressSample) => void;
  /** Fetching is done and FFmpeg is putting the file together. */
  onPostprocess?: () => void;
  onLog?: (line: string) => void;
}

/** The parts of a video site that do not depend on how it downloads. */
export interface VideoSiteBase {
  /**
   * The menu's read (title, channel, length, cover, qualities with their sizes, whether summary
   * and subtitles are offered). Throws the `FlowUserError` the person can act on: unreadable,
   * live, not started, restricted. `access.signIn` of `none`: a site with a sign-in in Settings
   * (bilibili) reads without it, and offers nothing only it gives (a video's download never needs
   * it); `full`, `others` or absent: used when signed in.
   */
  info(ref: VideoRef, signal?: AbortSignal, access?: Pick<ReadAccess, 'signIn'>): Promise<VideoInfo>;
  /**
   * The video's own words, or null when there are none. Present exactly when the site's row has
   * `summary` (the menu's "summary" button and the built-ins' summary branch). `access` as `info`'s.
   */
  transcript?(ref: VideoRef, signal?: AbortSignal, access?: Pick<ReadAccess, 'signIn'>): Promise<string | null>;
  /** The cover saved for the desktop chat's menu (a local file), or "" when there is none to show. */
  chatCover?(info: VideoInfo): Promise<string>;
}

/**
 * A site yt-dlp downloads: what a download asks yt-dlp for, with its cookies. How yt-dlp's
 * failures read and how its log is masked are the site's own hooks (`SiteDownloadHooks`;
 * YouTube's reading by default).
 */
export interface YtdlpVideoSite extends VideoSiteBase, Omit<SiteDownloadHooks, 'refreshBlocked'> {
  /**
   * The site's own yt-dlp options for downloading `ref` (the one `info` returned) at a quality
   * the menu offered (or `best`), or its sound alone as an MP3 (`mp3`, the shared `mp3Args` after
   * the site's own audio selector), going to `destination`: format selector, merge format.
   * `lowAudio`: the menu priced this Telegram quality with the low AAC (`YtdlChoice.lowAudio`), so
   * ask for that first. Never `--` or a cookie option (`cookies` hands those over); throws for a
   * link or quality the site does not take.
   */
  downloadArgs(ref: VideoRef, quality: YtdlPick, destination: YtdlDestination, lowAudio?: boolean): readonly string[];
  download?: never;
  /**
   * Whose cookies yt-dlp gets for this site's reads and downloads (`cookies` of `runYtdlpJson` and
   * `runYtdlpDownload`), each call writing its own file; none for a site yt-dlp reads signed out.
   */
  cookies?: CookieSource;
  /**
   * A `blocked` download of `ref` the site can lift itself (bilibili: reload that video's page).
   * True = try once more.
   */
  refreshBlocked?(ref: VideoRef, signal?: AbortSignal): Promise<boolean>;
}

/**
 * A site that reads its own streams (HLS, DASH, a progressive file) and downloads them itself,
 * usually through `downloadStreams` (`downloader/streamDownload.ts`); no yt-dlp is involved.
 * Everything else — the quality menu, the size limits, the MP3 choice,
 * subtitles, saving to Downloads/Yobi, reuse, usage counts and progress — is `youtube_download`'s,
 * as for any other site.
 */
export interface SelfDownloadVideoSite extends VideoSiteBase {
  /**
   * Downloads `request.info.ref` at the pick the menu offered into `request.jobDir` and returns
   * the file (an `.mp4`, or for `mp3` an `.mp3`; its extension names the saved file), checked to
   * hold what it should. Throws the stream errors; `downloadSiteVideo` words them
   * (`streamFailure`), holds the app-wide download slot and makes a Stop an AbortError.
   */
  download(request: SelfDownloadRequest): Promise<YtdlDownloadResult>;
  downloadArgs?: never;
  cookies?: never;
  classify?: never;
  mask?: never;
  refreshBlocked?: never;
}

/** One video site: its info for the menu, its download, and its transcript when it has one. */
export type VideoSite = YtdlpVideoSite | SelfDownloadVideoSite;

import { fetchYoutubeVideo } from '../../youtubeTranscript';
import { pickCaptionTrack, readYoutubeCaptions } from '../../youtubeCaptions';
import { fetchYoutubeLinkCard, fetchYoutubeVideoInfo } from '../../youtubeVideoInfo';
import type { YoutubeCaptionTrack, YoutubeLinkCard, YoutubeVideoInfo } from '../../youtubeVideoInfo';
import { youtubeCoverForChat } from '../../chatMedia';
import type { SiteDownloadHooks, VideoDownloadOptions } from '../../downloader/downloadVideo';
import { streamFailure } from '../../downloader/streamFailure';
import { StreamTooLargeError, streamAbortError } from '../../downloader/streamTypes';
import type { FetchLimit } from '../../downloader/streamTypes';
import { withDownloadSlot } from '../../downloader/ytdlpInvoke';
import { downloadVideo } from '../../youtubeDownload';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import { youtubeSiteArgs } from '../../youtubeDownload/ytdlArgs';
import { errorText } from '../../../shared/errorText';
import { buildYtdlChoices } from '../../../shared/ytdl';
import type { YtdlDestination, YtdlPick } from '../../../shared/ytdl';
import { siteLabel } from '../../../shared/linkSites/rows';
import type { VideoRef, VideoSiteId } from '../../../shared/linkSites/types';
import { FlowUserError } from '../userError';
import { bilibiliVideo } from './bilibiliVideo';
import { m3u8Video } from './m3u8Video';
import { soundcloudTrack } from './soundcloudTrack';
import { cuesFromJson3 } from './srt';
import { vimeoVideo } from './vimeoVideo';
import type { SelfDownloadVideoSite, TimedSubtitles, VideoInfo, VideoSite, YtdlpVideoSite } from './videoSiteTypes';

export type { VideoInfo, VideoSite } from './videoSiteTypes';

/*
 * A pasted video link, whichever site it is on: what the quality menu shows and what a download
 * asks yt-dlp for. Post sites have their readers in `postReader.ts`.
 */

async function readYoutubeInfo(videoId: string, signal?: AbortSignal): Promise<YoutubeVideoInfo> {
  const site = siteLabel('youtube');
  let info: YoutubeVideoInfo;
  try {
    info = await fetchYoutubeVideoInfo(videoId, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site }, `Could not read the YouTube video: ${reason}`);
  }
  if (info.playability === 'live') {
    throw new FlowUserError('flow.error.ytdlLive', {}, 'The YouTube video is a live stream');
  }
  if (info.playability === 'upcoming') {
    throw new FlowUserError('flow.error.ytdlUpcoming', {}, 'The YouTube video has not started yet');
  }
  if (info.playability === 'unplayable') {
    const reason = info.reason || 'unavailable';
    throw new FlowUserError('flow.error.ytdlRestricted', { reason, site }, `YouTube does not play this video: ${reason}`);
  }
  return info;
}

/** A site turning the video page away for now (YouTube's bot check), in the words a download refusal uses. */
export function videoPageHeldBack(site: VideoSiteId, detail: string): FlowUserError {
  const label = siteLabel(site);
  return new FlowUserError('flow.error.ytdlBlocked', { site: label }, `${label} held the video page back for now (${detail})`);
}

/**
 * Every read met the bot check: the link card's title, channel and cover, marked `partial` (no
 * length, qualities or subtitles). Without even that, the read is refused.
 */
async function botCheckedInfo(ref: VideoRef, signal?: AbortSignal): Promise<VideoInfo> {
  let card: YoutubeLinkCard;
  try {
    card = await fetchYoutubeLinkCard(ref.id, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw videoPageHeldBack('youtube', `bot check, and no link card: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    ref,
    title: card.title,
    channel: card.channel,
    durationS: 0,
    cover: card.image,
    summary: true,
    partial: true,
    choices: () => [],
  };
}

/** YouTube's player response, read without the download tools (`ytInitialPlayerResponse`). */
async function youtubeInfo(ref: VideoRef, signal?: AbortSignal): Promise<VideoInfo> {
  const info = await readYoutubeInfo(ref.id, signal);
  if (info.playability === 'botCheck') return botCheckedInfo(ref, signal);
  const track = pickCaptionTrack(info.captionTracks, info.defaultCaptionTrack);
  return {
    ref,
    title: info.title,
    channel: info.channel,
    durationS: info.durationSec,
    cover: info.image,
    summary: true,
    ...(track ? { subtitles: (signal?: AbortSignal) => youtubeSubtitles(ref, track, signal) } : {}),
    choices: (destination, includeSmall = false, limitBytes) => buildYtdlChoices(info.formats, destination, includeSmall, info.durationSec, limitBytes),
  };
}

/** The chosen track's timed captions, read through the watch page's own player (`youtubeCaptions.ts`). */
async function youtubeSubtitles(ref: VideoRef, track: YoutubeCaptionTrack, signal?: AbortSignal): Promise<TimedSubtitles> {
  let file: unknown;
  try {
    file = await readYoutubeCaptions(ref.id, track, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new FlowUserError('flow.error.subtitlesUnreadable', { site: siteLabel('youtube') }, `Could not read the YouTube captions: ${reason}`);
  }
  return { language: track.languageCode, auto: track.asr, cues: cuesFromJson3(file) };
}

/*
 * The `youtube` skill reads captions through `fetchYoutubeVideo` itself, since it also needs the
 * title and the Gemini fallback; this is the plain read a site-neutral caller goes through.
 */
async function youtubeTranscript(ref: VideoRef): Promise<string | null> {
  const result = await fetchYoutubeVideo(ref.url).catch(() => null);
  return result?.ok ? result.transcript : null;
}

/**
 * Every video row's adapter. Exhaustive: a video row added to the link-site table without one
 * here fails typecheck.
 */
export const VIDEO_SITES: Record<VideoSiteId, VideoSite> = {
  youtube: {
    info: youtubeInfo,
    // The canonical watch URL is checked again there: nothing else reaches yt-dlp.
    downloadArgs: (ref, quality, destination, lowAudio) => youtubeSiteArgs(ref.url, quality, destination, lowAudio),
    transcript: youtubeTranscript,
    chatCover: (info) => youtubeCoverForChat(info.ref.id, info.cover),
  },
  bilibili: bilibiliVideo,
  soundcloud: soundcloudTrack,
  vimeo: vimeoVideo,
  m3u8: m3u8Video,
};

/**
 * Whether a yt-dlp that cannot read `site` pauses its downloads: not for a site Yobi downloads
 * itself first (`directDownload`), whose own download does not need yt-dlp.
 */
export function pausesForYtdlp(site: VideoSiteId): boolean {
  return VIDEO_SITES[site].directDownload === undefined;
}

export type SiteVideoDownload = Omit<VideoDownloadOptions, 'url' | 'siteArgs' | 'cookies' | 'pausable' | keyof SiteDownloadHooks> & {
  /** The read that offered the menu: a site that downloads itself gets it (and reads it again without one). */
  info?: VideoInfo;
  /**
   * The menu priced this Telegram quality with the low AAC (`YtdlChoice.lowAudio`): handed to the
   * site's `downloadArgs`. Only yt-dlp sites set it; a self-downloading site's menu never does.
   */
  lowAudio?: boolean;
  /**
   * The most a self-downloading site may receive, counted as the bytes arrive
   * (`SelfDownloadRequest.fetchLimit`). The yt-dlp path never sees it.
   */
  fetchLimit?: FetchLimit;
};

/**
 * A site that downloads itself, holding the app-wide download slot as a yt-dlp download does;
 * its failures worded as yt-dlp's are (`streamFailure`), a Stop an AbortError naming the site.
 */
async function selfDownload(
  site: SelfDownloadVideoSite,
  ref: VideoRef,
  pick: YtdlPick,
  destination: YtdlDestination,
  run: SiteVideoDownload,
): Promise<YtdlDownloadResult> {
  const label = siteLabel(ref.site);
  const { signal } = run;
  return withDownloadSlot(label, signal, async () => {
    try {
      const info = run.info ?? await site.info(ref, signal);
      return await site.download({
        info,
        pick,
        destination,
        jobDir: run.jobDir,
        ...(signal ? { signal } : {}),
        ...(run.fetchLimit ? { fetchLimit: run.fetchLimit } : {}),
        ...(run.onProgress ? { onProgress: run.onProgress } : {}),
        ...(run.onPostprocess ? { onPostprocess: run.onPostprocess } : {}),
        ...(run.onLog ? { onLog: run.onLog } : {}),
      });
    } catch (err) {
      if (signal?.aborted) throw streamAbortError(label);
      throw streamFailure(err, label);
    }
  });
}

/**
 * A yt-dlp site's own first try (`directDownload`), holding the app-wide download slot as yt-dlp
 * does. Null when it failed in a way yt-dlp may not (the reason logged): yt-dlp is asked next. A
 * Stop is an AbortError naming the site; the size limit and the person's own errors
 * (`FlowUserError`) are final, since yt-dlp would meet them too.
 */
async function directFirst(
  direct: NonNullable<YtdlpVideoSite['directDownload']>,
  site: YtdlpVideoSite,
  ref: VideoRef,
  pick: YtdlPick,
  destination: YtdlDestination,
  run: SiteVideoDownload,
): Promise<YtdlDownloadResult | null> {
  const label = siteLabel(ref.site);
  const { signal } = run;
  return withDownloadSlot(label, signal, async () => {
    try {
      // Without the menu's read, read again signed out: a download never needs the sign-in.
      const info = run.info ?? await site.info(ref, signal, { signIn: 'none' });
      return await direct.call(site, {
        info,
        pick,
        destination,
        jobDir: run.jobDir,
        ...(signal ? { signal } : {}),
        ...(run.lowAudio ? { lowAudio: true } : {}),
        ...(run.fetchLimit ? { fetchLimit: run.fetchLimit } : {}),
        ...(run.onProgress ? { onProgress: run.onProgress } : {}),
        ...(run.onPostprocess ? { onPostprocess: run.onPostprocess } : {}),
        ...(run.onLog ? { onLog: run.onLog } : {}),
      });
    } catch (err) {
      if (signal?.aborted) throw streamAbortError(label);
      if (err instanceof StreamTooLargeError || err instanceof FlowUserError) throw err;
      run.onLog?.(`[Ytdl] ${label}: Yobi's own download failed (${errorText(err)}) — trying yt-dlp`);
      return null;
    }
  });
}

/**
 * Downloads `ref` (the one its site's `info` returned, so the link is the site's canonical one):
 * by the site itself when it has `download`, else through the site-neutral `downloadVideo` with
 * the site's yt-dlp options, cookies and failure hooks — after the site's own `directDownload`
 * when it has one and that failed. `mp3` is the sound alone, which needs no picture.
 */
export async function downloadSiteVideo(
  ref: VideoRef,
  quality: YtdlPick,
  destination: YtdlDestination,
  options: SiteVideoDownload,
): Promise<YtdlDownloadResult> {
  const site = VIDEO_SITES[ref.site];
  if (site.download) return selfDownload(site, ref, quality, destination, options);
  if (site.directDownload) {
    const done = await directFirst(site.directDownload, site, ref, quality, destination, options);
    if (done) return done;
  }
  // The yt-dlp path never sees the read.
  const { info: _info, fetchLimit: _fetchLimit, lowAudio, ...run } = options;
  const refresh = site.refreshBlocked;
  return downloadVideo(ref.site, {
    ...run,
    url: ref.url,
    ...(quality === 'mp3' ? { audioOnly: true } : {}),
    siteArgs: () => (lowAudio ? site.downloadArgs(ref, quality, destination, true) : site.downloadArgs(ref, quality, destination)),
    ...(site.cookies ? { cookies: site.cookies } : {}),
    ...(site.classify ? { classify: site.classify } : {}),
    ...(site.mask ? { mask: site.mask } : {}),
    // The hook reloads the page of the video being downloaded, so it is handed that video.
    ...(refresh ? { refreshBlocked: (signal?: AbortSignal) => refresh.call(site, ref, signal) } : {}),
    ...(site.directDownload ? { pausable: false } : {}),
  });
}

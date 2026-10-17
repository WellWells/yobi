import { fetchYoutubeVideo } from '../../youtubeTranscript';
import { pickCaptionTrack, readYoutubeCaptions } from '../../youtubeCaptions';
import { fetchYoutubeVideoInfo } from '../../youtubeVideoInfo';
import type { YoutubeCaptionTrack, YoutubeVideoInfo } from '../../youtubeVideoInfo';
import { youtubeCoverForChat } from '../../chatMedia';
import type { SiteDownloadHooks, VideoDownloadOptions } from '../../downloader/downloadVideo';
import { streamFailure } from '../../downloader/streamFailure';
import { streamAbortError } from '../../downloader/streamTypes';
import type { FetchLimit } from '../../downloader/streamTypes';
import { withDownloadSlot } from '../../downloader/ytdlpInvoke';
import { downloadVideo } from '../../youtubeDownload';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import { youtubeSiteArgs } from '../../youtubeDownload/ytdlArgs';
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
import type { SelfDownloadVideoSite, TimedSubtitles, VideoInfo, VideoSite } from './videoSiteTypes';

export type { VideoInfo, VideoSite } from './videoSiteTypes';

/*
 * A pasted video link, whichever site it is on: what the quality menu shows and what a download
 * asks yt-dlp for. Post sites have their readers in `postReader.ts`.
 */

async function readYoutubeInfo(videoId: string): Promise<YoutubeVideoInfo> {
  const site = siteLabel('youtube');
  let info: YoutubeVideoInfo;
  try {
    info = await fetchYoutubeVideoInfo(videoId);
  } catch (err) {
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

/** YouTube's player response, read without the download tools (`ytInitialPlayerResponse`). */
async function youtubeInfo(ref: VideoRef): Promise<VideoInfo> {
  const info = await readYoutubeInfo(ref.id);
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

export type SiteVideoDownload = Omit<VideoDownloadOptions, 'url' | 'siteArgs' | 'cookies' | keyof SiteDownloadHooks> & {
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
 * Downloads `ref` (the one its site's `info` returned, so the link is the site's canonical one):
 * by the site itself when it has `download`, else through the site-neutral `downloadVideo` with
 * the site's yt-dlp options, cookies and failure hooks. `mp3` is the sound alone, which needs no picture.
 */
export function downloadSiteVideo(
  ref: VideoRef,
  quality: YtdlPick,
  destination: YtdlDestination,
  options: SiteVideoDownload,
): Promise<YtdlDownloadResult> {
  const site = VIDEO_SITES[ref.site];
  if (site.download) return selfDownload(site, ref, quality, destination, options);
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
  });
}

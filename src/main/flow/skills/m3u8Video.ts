import { downloadStreams } from '../../downloader/streamDownload';
import { estimateBytes, renditionChoices, renditionFor } from '../../downloader/streamChoices';
import { readHlsMedia } from '../../downloader/streamRead';
import { ProtectedStreamError, StreamFormatError } from '../../downloader/streamTypes';
import { YtdlError, ytdlFailureMessage } from '../../youtubeDownload/ytdlErrors';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import { errorText } from '../../../shared/errorText';
import { MP3_BITRATE_KBPS } from '../../../shared/ytdl';
import { siteLabel } from '../../../shared/linkSites/rows';
import { parseM3u8Url } from '../../../shared/linkSites/m3u8Links';
import type { M3u8Link } from '../../../shared/linkSites/m3u8Links';
import type { VideoRef } from '../../../shared/linkSites/types';
import { FlowUserError } from '../userError';
import { PrivateAddressError, defaultM3u8Deps, m3u8Request, offerable, readM3u8Renditions, soundIsAac, soundSource } from './m3u8Streams';
import type { M3u8Deps, M3u8Read } from './m3u8Streams';
import type { SelfDownloadRequest, SelfDownloadVideoSite, VideoInfo } from './videoSiteTypes';

/*
 * A bare `.m3u8` link, so a playlist pasted alone becomes an MP4: the quality menu and the MP3 as any video site's, downloaded by Yobi itself (`downloadStreams`,
 * no yt-dlp). There is no site to read a title, channel or cover from: the playlist's file name
 * is the title and its host stands where a channel would. Refused before the menu, as for every
 * segmented stream: any key (AES-128 included), a live playlist, and — this row's own — a link
 * or redirect to this computer or the local network (`flow.error.streamPrivateAddress`).
 */

function site(): string {
  return siteLabel('m3u8');
}

function privateAddress(err: PrivateAddressError): FlowUserError {
  return new FlowUserError('flow.error.streamPrivateAddress', {}, `The m3u8 link leads to a private address (${err.message})`);
}

/** A failure while reading the playlists for the menu, in the person's words. */
function infoFailure(err: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted || err instanceof FlowUserError) return err;
  if (err instanceof PrivateAddressError) return privateAddress(err);
  if (err instanceof ProtectedStreamError) {
    return new FlowUserError('flow.error.videoDrm', { site: site() }, `The m3u8 stream is protected (${err.scheme})`);
  }
  if (err instanceof StreamFormatError && err.live) return new FlowUserError('flow.error.ytdlLive', {}, 'The m3u8 stream is live');
  return new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `Could not read the m3u8 playlist: ${errorText(err)}`);
}

/** What the menu's read found, for the download that follows it (`SelfDownloadRequest.info`). */
const reads = new WeakMap<VideoInfo, M3u8Read>();

let deps: M3u8Deps = defaultM3u8Deps;

/** Swaps the probe and the tools check; null restores them. */
export function setM3u8Deps(next: Partial<M3u8Deps> | null): void {
  deps = next ? { ...defaultM3u8Deps, ...next } : defaultM3u8Deps;
}

function linkOf(ref: VideoRef): M3u8Link {
  const link = parseM3u8Url(ref.url);
  if (!link) throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, `${ref.url} is not an m3u8 link`);
  return link;
}

async function m3u8Info(ref: VideoRef, signal?: AbortSignal): Promise<VideoInfo> {
  const link = linkOf(ref);
  let read: M3u8Read;
  try {
    read = await readM3u8Renditions(link.url, m3u8Request(signal), deps);
  } catch (err) {
    throw infoFailure(err, signal);
  }
  const videos = offerable(read.renditions);
  // Only a stream known to have no picture (a radio show) gets a menu of the MP3 alone; one whose
  // picture is not H.264, or could not be read, is refused rather than silently offered as sound.
  const soundOnly = read.renditions.every((r) => r.video === false);
  if (videos.length === 0 && read.complete && !soundOnly) {
    throw new FlowUserError('flow.error.ytdlInfoUnreadable', { site: site() }, 'The m3u8 stream has no H.264 rendition');
  }
  const { durationS } = read;
  const aac = soundIsAac(videos);
  const info: VideoInfo = {
    ref: { site: 'm3u8', shape: 'video', url: link.url, id: link.id, author: '' },
    title: link.name,
    channel: link.host,
    durationS,
    cover: '',
    summary: false,
    // A variant's BANDWIDTH covers its sound, separate or not, so nothing is added for it.
    choices: (_destination, includeSmall = false) => renditionChoices(videos, 0, durationS, { includeSmall, aac }),
  };
  reads.set(info, read);
  return info;
}

async function download(request: SelfDownloadRequest, read: M3u8Read): Promise<YtdlDownloadResult> {
  const { info, pick, signal } = request;
  const streams = m3u8Request(signal);
  const common = {
    label: site(),
    jobDir: request.jobDir,
    request: streams,
    ...(request.fetchLimit ? { fetchLimit: request.fetchLimit } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
    ...(request.onPostprocess ? { onPostprocess: request.onPostprocess } : {}),
    ...(request.onLog ? { onLog: request.onLog } : {}),
  };
  const { durationS } = info;
  if (pick === 'mp3') {
    const sound = soundSource(read.renditions);
    if (!sound) throw new FlowUserError('flow.error.videoNoSound', { site: site() }, 'The m3u8 stream has no sound');
    const plan = 'audio' in sound ? { audio: await readHlsMedia(sound.audio, streams) } : { video: sound.media };
    return downloadStreams({
      ...common,
      ...plan,
      output: 'mp3',
      mp3: { bitrateKbps: MP3_BITRATE_KBPS[request.destination], title: info.title, artist: '' },
    });
  }
  const rendition = renditionFor(offerable(read.renditions), pick);
  if (!rendition) throw new YtdlError('formatMissing', ytdlFailureMessage('formatMissing', site()));
  const audio = rendition.audio ? await readHlsMedia(rendition.audio, streams) : undefined;
  return downloadStreams({
    ...common,
    video: rendition.media,
    ...(audio ? { audio } : {}),
    output: 'mp4',
    estimateBytes: estimateBytes(rendition.bandwidth, durationS),
  });
}

async function m3u8Download(request: SelfDownloadRequest): Promise<YtdlDownloadResult> {
  const read = reads.get(request.info) ?? reads.get(await m3u8Info(request.info.ref, request.signal));
  if (!read) throw new Error('The m3u8 read went missing');
  try {
    return await download(request, read);
  } catch (err) {
    if (err instanceof PrivateAddressError) throw privateAddress(err);
    throw err;
  }
}

export const m3u8Video: SelfDownloadVideoSite = {
  info: m3u8Info,
  download: m3u8Download,
};

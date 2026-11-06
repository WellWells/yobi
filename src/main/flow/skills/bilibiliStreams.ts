import { MirrorLinks } from '../../downloader/mirrorFetch';
import { downloadStreams } from '../../downloader/streamDownload';
import type { StreamDownloadRequest } from '../../downloader/streamDownload';
import type { FetchLike, StreamRequestOptions } from '../../downloader/streamFetch';
import { StreamFormatError, StreamRefusedError, progressivePlan } from '../../downloader/streamTypes';
import type { SegmentPlan } from '../../downloader/streamTypes';
import { userAgentForUrl } from '../../userAgent';
import type { YtdlDownloadResult } from '../../youtubeDownload';
import { LOW_AAC_MAX_KBPS, MP3_BITRATE_KBPS } from '../../../shared/ytdl';
import type { YtdlPick } from '../../../shared/ytdl';
import { siteLabel } from '../../../shared/linkSites/rows';
import { avcStreams, playurlTimelength, streamBytes } from './bilibiliParse';
import type { AvcStream } from './bilibiliParse';
import { arr, num, obj, str } from './jsonPick';
import type { Json } from './jsonPick';
import type { DirectDownloadRequest } from './videoSiteTypes';

/*
 * A bilibili download Yobi fetches itself before yt-dlp is asked: the streams of the
 * quality list the menu read (`playurl`, the reader's window), each from its `base_url` and, when
 * that host refuses or does not answer, the `backup_url`s on bilibili's other CDNs — what the
 * site's own player does. yt-dlp only ever asks a stream's first address, and the
 * Tencent EdgeOne host (`upos-sz-mirrorcosov.bilivideo.com`) answers it with HTTP 567
 * (yt-dlp#17847) while the Akamai backup serves the same file. H.264 with AAC only, the stream
 * a quality gets chosen as the menu priced it (`avcStreams`), the sound as yt-dlp's options pick it.
 */

const HOME = 'https://www.bilibili.com/';

/**
 * bilibili's own CDN (`upos-*.bilivideo.com`, the PCDN under `bilivideo.cn`), its Akamai mirror
 * (`upos-*.akamaized.net` only: the rest of akamaized.net is anyone's) and its cover host.
 */
export function isBilibiliMediaHost(host: string): boolean {
  const h = host.toLowerCase();
  return /(^|\.)bilivideo\.(?:com|cn)$/.test(h) || /^upos-[a-z0-9-]+\.akamaized\.net$/.test(h) || /(^|\.)hdslb\.com$/.test(h);
}

/** A stream's addresses in the player's order: `base_url`, then its `backup_url`s (both spellings). */
export function streamUrls(entry: Json): string[] {
  const base = str(entry.base_url) || str(entry.baseUrl);
  const backups = [...arr(entry.backup_url), ...arr(entry.backupUrl)].map(str);
  return [...new Set([base, ...backups].filter(Boolean))];
}

function audioEntries(playurl: unknown): Json[] {
  return arr(obj(obj(obj(playurl)?.data)?.dash)?.audio).map(obj).filter((a): a is Json => a !== undefined);
}

function largest(entries: readonly Json[]): Json | null {
  return entries.reduce<Json | null>((best, entry) => (!best || num(entry.bandwidth) > num(best.bandwidth) ? entry : best), null);
}

/** Which sound a download takes. */
export type BilibiliSound = 'aac' | 'lowAac' | 'any';

/**
 * The sound of `dash.audio[]` a download takes: `aac` the largest AAC (yt-dlp's `ba[acodec^=mp4a]`);
 * `lowAac` the largest at or under `LOW_AAC_MAX_KBPS` (a Telegram quality priced with it), else as
 * `aac`; `any` (the MP3's source) the largest AAC, else the largest of any codec. Null when none.
 */
export function pickBilibiliSound(playurl: unknown, sound: BilibiliSound): Json | null {
  const all = audioEntries(playurl);
  const aac = all.filter((a) => str(a.codecs).startsWith('mp4a'));
  if (sound === 'lowAac') {
    const low = largest(aac.filter((a) => num(a.bandwidth) > 0 && num(a.bandwidth) <= LOW_AAC_MAX_KBPS * 1_000));
    if (low) return low;
  }
  return largest(aac) ?? (sound === 'any' ? largest(all) : null);
}

/** The H.264 stream the menu priced at `pick` lines, or the one with the most lines for `best`; null when there is none. */
export function pickBilibiliPicture(playurl: unknown, pick: Exclude<YtdlPick, 'mp3'>): AvcStream | null {
  const streams = avcStreams(playurl);
  if (pick === 'best') return streams.at(-1) ?? null;
  return streams.find((stream) => stream.lines === pick) ?? null;
}

/** What `downloadBilibiliStreams` is handed besides the request: the read and the fetch (Node's by default). */
export interface BilibiliStreamsDeps {
  fetch: FetchLike;
  download: (request: StreamDownloadRequest) => Promise<YtdlDownloadResult>;
}

const defaultDeps: BilibiliStreamsDeps = { fetch: (url, init) => fetch(url, init), download: downloadStreams };

/**
 * Downloads `request.info`'s video from `playurl` (the read that offered the menu) into the job
 * folder: an MP4 of the picked quality's H.264 stream and its AAC, or an MP3 of the sound. Throws
 * the stream errors (`StreamFormatError` when the list has no such stream) and an AbortError on
 * Stop, as `downloadStreams` does; the caller hands anything but a Stop or the size limit to yt-dlp.
 */
export async function downloadBilibiliStreams(
  request: DirectDownloadRequest,
  playurl: unknown,
  deps: BilibiliStreamsDeps = defaultDeps,
): Promise<YtdlDownloadResult> {
  const { info, pick, destination, signal } = request;
  const label = siteLabel('bilibili');
  const links = new MirrorLinks({ isAllowedHost: isBilibiliMediaHost, label, ...(request.onLog ? { onLog: request.onLog } : {}) });
  const streams: StreamRequestOptions = {
    isAllowedHost: isBilibiliMediaHost,
    // The CDN refuses a request without bilibili's Referer; the player's carries the site's origin.
    headers: { 'User-Agent': userAgentForUrl(HOME), Referer: HOME },
    fetch: links.fetch(deps.fetch),
    ...(signal ? { signal } : {}),
  };
  const plan = (entry: Json, what: string): SegmentPlan => {
    const url = links.add(streamUrls(entry));
    if (!url) throw new StreamRefusedError(`bilibili gave no address Yobi may fetch for the ${what}`);
    return progressivePlan(url, info.durationS);
  };
  const common = {
    label,
    jobDir: request.jobDir,
    request: streams,
    ...(request.fetchLimit ? { fetchLimit: request.fetchLimit } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
    ...(request.onPostprocess ? { onPostprocess: request.onPostprocess } : {}),
    ...(request.onLog ? { onLog: request.onLog } : {}),
  };
  if (pick === 'mp3') {
    const sound = pickBilibiliSound(playurl, 'any');
    if (!sound) throw new StreamFormatError(`bilibili listed no sound for ${info.ref.id}`);
    return deps.download({
      ...common,
      audio: plan(sound, 'sound'),
      output: 'mp3',
      mp3: { bitrateKbps: MP3_BITRATE_KBPS[destination], title: info.title, artist: info.channel, ...(info.cover ? { coverUrl: info.cover } : {}) },
    });
  }
  const picture = pickBilibiliPicture(playurl, pick);
  const sound = pickBilibiliSound(playurl, request.lowAudio && destination === 'telegram' ? 'lowAac' : 'aac');
  if (!picture || !sound) throw new StreamFormatError(`bilibili listed no H.264 stream at ${pick} with AAC sound for ${info.ref.id}`);
  return deps.download({
    ...common,
    video: plan(picture.entry, `${picture.lines}p picture`),
    audio: plan(sound, 'sound'),
    output: 'mp4',
    estimateBytes: streamBytes(picture.bandwidth + num(sound.bandwidth), playurlTimelength(playurl, info.durationS)),
  });
}

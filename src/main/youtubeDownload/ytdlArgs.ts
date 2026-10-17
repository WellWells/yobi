import { LOW_AAC_MAX_KBPS, MP3_BITRATE_KBPS } from '../../shared/ytdl';
import type { YtdlDestination, YtdlPick } from '../../shared/ytdl';
import { mp3Args } from '../downloader/ytdlpArgs';

/*
 * YouTube's part of yt-dlp's command line: the canonical watch URL and a quality number, checked
 * here; the site-neutral rest (safety flags, JS runtime, progress, `--` before the URL) comes from
 * `downloader/ytdlpArgs.ts`. No text a user or a bot message typed becomes an argument.
 */

export type { YtdlProgressLine } from '../downloader/ytdlpArgs';

const CANONICAL_WATCH_URL = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/;

/**
 * Telegram plays only H.264 + AAC inline, so it asks for those first; a local file takes the best
 * codec at that quality. A quality is matched by YouTube's own label (`1080p`, `1080p60`) and
 * then by height, never quietly lowered. `lowAudio` (Telegram only) asks for the low AAC first, by
 * bitrate among the stereo m4a tracks: `ba`, never `wa` — yt-dlp's ranking puts the original
 * language first, and "worst" would take an auto-dubbed track. Without one the usual chain follows.
 */
export function ytdlFormatSelector(quality: number | 'best', destination: YtdlDestination, lowAudio = false): string {
  const q = quality;
  const video = q === 'best' ? 'bv*' : `bv*[format_note^=${q}p]`;
  const common = q === 'best' ? 'bv*+ba/b' : `bv*[format_note^=${q}p]+ba/b[format_note^=${q}p]/bv*[height=${q}]+ba/b[height=${q}]`;
  if (destination !== 'telegram') return common;
  // yt-dlp ranks more channels higher and would pick a 5.1 AAC track, about three times the size
  // of stereo; the Telegram size estimate assumes stereo.
  const h264 = `${video}[vcodec^=avc1]`;
  const usual = `${h264}+ba[ext=m4a][audio_channels<=2]/${h264}+ba[ext=m4a]/${common}`;
  return lowAudio ? `${h264}+ba[ext=m4a][audio_channels<=2][abr<=${LOW_AAC_MAX_KBPS}]/${usual}` : usual;
}

/**
 * The MP3: the best sound YouTube has (Opus or AAC, the original language's track by yt-dlp's own
 * ranking), or the best file with sound when no audio-only one is listed.
 */
export const YOUTUBE_AUDIO_FORMAT = 'ba/b';

/** YouTube's own options; throws for anything but a canonical watch URL and a sane quality. */
export function youtubeSiteArgs(url: string, quality: YtdlPick, destination: YtdlDestination, lowAudio = false): string[] {
  if (!CANONICAL_WATCH_URL.test(url)) throw new Error('yt-dlp only takes a canonical YouTube watch URL');
  if (quality === 'mp3') return ['-f', YOUTUBE_AUDIO_FORMAT, ...mp3Args(MP3_BITRATE_KBPS[destination])];
  if (quality !== 'best' && (!Number.isInteger(quality) || quality < 1 || quality > 10_000)) {
    throw new Error(`invalid quality ${String(quality)}`);
  }
  return [
    '-f',
    ytdlFormatSelector(quality, destination, lowAudio),
    '--merge-output-format',
    destination === 'telegram' ? 'mp4' : 'mp4/mkv',
  ];
}

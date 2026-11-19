import { LOW_AAC_MAX_KBPS, MP3_BITRATE_KBPS, isChatDestination } from '../../shared/ytdl';
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
 * Every destination asks for the same file, H.264 first (it plays on an iPhone
 * or anywhere; a chat — Telegram, LINE PC — plays only it inline): with stereo AAC, then with any
 * AAC, then with any sound (the video stays H.264 when the AAC is missing), and any codec only at
 * a quality YouTube has no H.264 of (1440p and up). One file per video and quality is what
 * lets a download made for the computer be sent to a chat without downloading it again, and the
 * other way round (`job.json`'s `anyDestination`).
 * A quality is matched by YouTube's own label (`1080p`, `1080p60`) and then by height, never
 * quietly lowered. `lowAudio` (Telegram only) asks for the low AAC first, by bitrate among the
 * stereo m4a tracks: `ba`, never `wa` — yt-dlp's ranking puts the original language first, and
 * "worst" would take an auto-dubbed track. Without one the usual chain follows.
 */
export function ytdlFormatSelector(quality: number | 'best', destination: YtdlDestination, lowAudio = false): string {
  const q = quality;
  const video = q === 'best' ? 'bv*' : `bv*[format_note^=${q}p]`;
  const common = q === 'best' ? 'bv*+ba/b' : `bv*[format_note^=${q}p]+ba/b[format_note^=${q}p]/bv*[height=${q}]+ba/b[height=${q}]`;
  // yt-dlp ranks more channels higher and would pick a 5.1 AAC track, about three times the size
  // of stereo; the size estimate assumes stereo.
  const h264 = `${video}[vcodec^=avc1]`;
  const usual = `${h264}+ba[ext=m4a][audio_channels<=2]/${h264}+ba[ext=m4a]/${h264}+ba/${common}`;
  return lowAudio && isChatDestination(destination) ? `${h264}+ba[ext=m4a][audio_channels<=2][abr<=${LOW_AAC_MAX_KBPS}]/${usual}` : usual;
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
    isChatDestination(destination) ? 'mp4' : 'mp4/mkv',
  ];
}

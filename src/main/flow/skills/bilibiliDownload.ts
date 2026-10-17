import { parseResolvedBilibiliUrl } from '../../../shared/linkSites/bilibiliLinks';
import type { VideoRef } from '../../../shared/linkSites/types';
import { LOW_AAC_MAX_KBPS, MP3_BITRATE_KBPS } from '../../../shared/ytdl';
import type { YtdlDestination, YtdlPick } from '../../../shared/ytdl';
import { mp3Args } from '../../downloader/ytdlpArgs';

/*
 * What a bilibili download asks yt-dlp for: H.264 (`avc1`) with AAC (`mp4a`) pinned so Telegram
 * on iOS can play the file, no format id ever named (they differ per video), and the quality as
 * the short side (`-S res:N`) so a portrait video gets the size it was asked for.
 */

/** The page-check cookie yt-dlp needs signed out. */
export const BILIBILI_TOKEN_COOKIE = 'X-BILI-SEC-TOKEN';

/** H.264 video with AAC audio, nothing else; the second branch only if yt-dlp names no audio codec. */
export const BILIBILI_FORMAT = 'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*[vcodec^=avc1]+ba[ext=m4a]';

/**
 * A Telegram quality the menu priced with the low AAC (`YtdlChoice.lowAudio`): AAC at or under
 * `LOW_AAC_MAX_KBPS` first, by filter, then the usual chain.
 */
export const BILIBILI_LOW_AUDIO_FORMAT = `bv*[vcodec^=avc1]+ba[acodec^=mp4a][abr<=${LOW_AAC_MAX_KBPS}]/${BILIBILI_FORMAT}`;

/** The MP3's source: the AAC track the videos carry, or whatever sound there is. */
export const BILIBILI_AUDIO_FORMAT = 'ba[acodec^=mp4a]/ba';

/** The menu's qualities are lines (360, 1080, 2160…), never more than 8K. */
function isLines(quality: number): boolean {
  return Number.isInteger(quality) && quality >= 144 && quality <= 4_320;
}

/**
 * The yt-dlp options for downloading `ref` at `quality` (lines, the short side), `best`, or as an
 * MP3 at `destination`'s bitrate; `lowAudio` (Telegram only) with the low AAC. Throws for a link
 * that is not the canonical page of one video (what `info` returns) or a quality the menu never offers.
 */
export function bilibiliSiteArgs(
  ref: VideoRef,
  quality: YtdlPick,
  destination: YtdlDestination = 'local',
  lowAudio = false,
): string[] {
  const link = parseResolvedBilibiliUrl(ref.url);
  if (!link || link.url !== ref.url || link.id !== ref.id) throw new Error('not a bilibili video page');
  if (quality === 'mp3') return ['-f', BILIBILI_AUDIO_FORMAT, ...mp3Args(MP3_BITRATE_KBPS[destination])];
  if (quality !== 'best' && !isLines(quality)) throw new Error(`not a bilibili quality: ${quality}`);
  return [
    '-f',
    lowAudio && destination === 'telegram' ? BILIBILI_LOW_AUDIO_FORMAT : BILIBILI_FORMAT,
    ...(quality === 'best' ? [] : ['-S', `res:${quality}`]),
    '--merge-output-format',
    'mp4',
  ];
}

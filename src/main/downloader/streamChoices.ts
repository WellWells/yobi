import type { YtdlChoice } from '../../shared/ytdl';

/*
 * What a segmented-stream site's menu offers, before anything is downloaded: H.264 renditions
 * only (Telegram on iOS plays nothing else; AV1, HEVC and VP9 are never listed), named by their
 * short side as YouTube's and bilibili's are, each with a size estimate — bitrate × length — so
 * the menu can hide what a capped person may not download and ask before an over-limit one.
 */

/** A video rendition as an HLS variant or a DASH representation describes it. */
export interface StreamRendition {
  width?: number;
  height?: number;
  /** Bits per second; an HLS variant's `AVERAGE-BANDWIDTH` estimates better than its peak. */
  bandwidth: number;
  frameRate?: number;
  /** `avc1.64001f`, or an HLS variant's list (video and its muxed audio). */
  codecs: string | readonly string[];
}

const AUDIO_CODEC = /^(mp4a|ac-3|ec-3|opus|flac|mp3|vorbis)/i;

function codecList(codecs: string | readonly string[]): string[] {
  return (typeof codecs === 'string' ? codecs.split(',') : [...codecs]).map((c) => c.trim()).filter(Boolean);
}

/** Its video codec is H.264 (`avc1` / `avc3`); a rendition naming no codec is not assumed to be. */
export function isH264(codecs: string | readonly string[]): boolean {
  const video = codecList(codecs).find((c) => !AUDIO_CODEC.test(c));
  return video !== undefined && /^avc[13]\./i.test(video);
}

/** Its audio is AAC (`mp4a.40.*`), what an MP4 for Telegram carries. */
export function isAac(codecs: string | readonly string[]): boolean {
  return codecList(codecs).some((c) => /^mp4a\.40\./i.test(c));
}

/** Bitrate × length in bytes; null when either is unknown. */
export function estimateBytes(bandwidthBps: number, durationS: number): number | null {
  return bandwidthBps > 0 && durationS > 0 ? Math.round((bandwidthBps * durationS) / 8) : null;
}

/** The "p" people call a quality: the short side (a 1080×1920 portrait video is 1080p). */
export function shortSide(rendition: Pick<StreamRendition, 'width' | 'height'>): number | null {
  const sides = [rendition.width, rendition.height].filter((n): n is number => typeof n === 'number' && n > 0);
  return sides.length > 0 ? Math.min(...sides) : null;
}

/** Under this many lines a quality is listed only when nothing larger exists, as for YouTube. */
const SMALL_LINES = 360;

/** The H.264 renditions by quality, the larger bitrate kept where two share one. */
function byQuality<T extends StreamRendition>(videos: readonly T[]): Map<number, T> {
  const best = new Map<number, T>();
  for (const video of videos) {
    const lines = shortSide(video);
    if (lines === null || !isH264(video.codecs)) continue;
    const held = best.get(lines);
    if (!held || video.bandwidth > held.bandwidth) best.set(lines, video);
  }
  return best;
}

/**
 * The menu's qualities, smallest first: one per short side, its size the video's and
 * `audioBandwidthBps` (the separate sound's bitrate, 0 when muxed in) over `durationS`.
 * `aac` says the sound is AAC (Telegram plays it inline).
 */
export function renditionChoices(
  videos: readonly StreamRendition[],
  audioBandwidthBps: number,
  durationS: number,
  options: { includeSmall?: boolean; aac?: boolean } = {},
): YtdlChoice[] {
  const choices: YtdlChoice[] = [...byQuality(videos)].map(([lines, video]) => ({
    quality: lines,
    label: (video.frameRate ?? 0) > 30 ? `${lines}p${Math.round(video.frameRate ?? 0)}` : `${lines}p`,
    sizeBytes: estimateBytes(video.bandwidth + Math.max(0, audioBandwidthBps), durationS),
    portrait: (video.height ?? 0) > (video.width ?? 0),
    telegramPlayable: options.aac ?? true,
  }));
  choices.sort((a, b) => a.quality - b.quality);
  if (options.includeSmall) return choices;
  const large = choices.filter((c) => c.quality >= SMALL_LINES);
  return large.length > 0 ? large : choices;
}

/** The H.264 rendition a pick downloads: that quality (by short side), or the largest for `best`; null when there is none. */
export function renditionFor<T extends StreamRendition>(videos: readonly T[], pick: number | 'best'): T | null {
  const qualities = byQuality(videos);
  if (pick !== 'best') return qualities.get(pick) ?? null;
  const top = Math.max(...qualities.keys());
  return qualities.get(top) ?? null;
}

/** The sound to fetch: AAC, stereo before surround (phones play stereo; 5.1 triples the size), then the highest bitrate. */
export function bestAacAudio<T extends { bandwidth: number; codecs: string | readonly string[]; channels?: number }>(audios: readonly T[]): T | null {
  const aac = audios.filter((a) => isAac(a.codecs));
  const stereo = aac.filter((a) => (a.channels ?? 2) <= 2);
  const pool = stereo.length > 0 ? stereo : aac;
  return [...pool].sort((a, b) => b.bandwidth - a.bandwidth)[0] ?? null;
}

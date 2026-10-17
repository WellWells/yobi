import { fetchRawResponse } from './pageLoader';
import { userAgentForUrl } from './userAgent';
import { youtubeWatchUrl } from '../shared/youtubeUrl';
import type { YtFormat } from '../shared/ytdl';

export type YoutubePlayability = 'ok' | 'live' | 'upcoming' | 'unplayable';

export interface YoutubeVideoInfo {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  image: string;
  playability: YoutubePlayability;
  /** YouTube's own reason when the video cannot play (private, members-only, age gate…). */
  reason: string;
  formats: YtFormat[];
  /** The caption tracks the player offers, in its order. */
  captionTracks: YoutubeCaptionTrack[];
  /** The track YouTube itself picks for the video's default audio (an index into `captionTracks`); -1 when none. */
  defaultCaptionTrack: number;
}

export interface YoutubeCaptionTrack {
  /** `en`, `zh-TW`, `pt-BR`…; "" when the player gave none (such a track is never picked). */
  languageCode: string;
  /** YouTube's automatic (speech-recognised) captions, `kind: "asr"`. */
  asr: boolean;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    isLive?: boolean;
    isUpcoming?: boolean;
    thumbnail?: { thumbnails?: Array<{ url?: string }> };
  };
  streamingData?: { adaptiveFormats?: YtFormat[]; formats?: YtFormat[] };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{ languageCode?: string; kind?: string }>;
      audioTracks?: Array<{ defaultCaptionTrackIndex?: number }>;
      defaultAudioTrackIndex?: number;
    };
  };
}

/**
 * The caption tracks and YouTube's own pick among them: the default audio track's
 * `defaultCaptionTrackIndex`, the spoken language's track.
 */
function captionsOf(pr: PlayerResponse): Pick<YoutubeVideoInfo, 'captionTracks' | 'defaultCaptionTrack'> {
  const list = pr.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = (list?.captionTracks ?? [])
    .map((track) => ({ languageCode: typeof track.languageCode === 'string' ? track.languageCode : '', asr: track.kind === 'asr' }));
  const audio = list?.audioTracks?.[list.defaultAudioTrackIndex ?? 0];
  const index = audio?.defaultCaptionTrackIndex;
  const defaultCaptionTrack = typeof index === 'number' && index >= 0 && index < captionTracks.length ? index : -1;
  return { captionTracks, defaultCaptionTrack };
}

const MARKER = 'ytInitialPlayerResponse';

/**
 * The JSON object that starts at `start`, found by matching braces outside strings. A regex up
 * to the next `;` would stop inside a title that contains `};var`.
 */
export function readJsonObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** The player response embedded in a watch page, or `null` when the page has none. */
export function extractPlayerResponse(html: string): PlayerResponse | null {
  let from = 0;
  while (from < html.length) {
    const at = html.indexOf(MARKER, from);
    if (at < 0) return null;
    const brace = html.indexOf('{', at + MARKER.length);
    const between = html.slice(at + MARKER.length, brace);
    from = at + MARKER.length;
    if (brace < 0 || !/^\s*=\s*$/.test(between)) continue;
    const json = readJsonObject(html, brace);
    if (!json) return null;
    try {
      return JSON.parse(json) as PlayerResponse;
    } catch {
      return null;
    }
  }
  return null;
}

function playabilityOf(pr: PlayerResponse): YoutubePlayability {
  const details = pr.videoDetails ?? {};
  if (details.isUpcoming) return 'upcoming';
  if (details.isLive) return 'live';
  const status = pr.playabilityStatus?.status ?? '';
  if (status === 'OK') return 'ok';
  if (status === 'LIVE_STREAM_OFFLINE') return 'upcoming';
  return 'unplayable';
}

export function videoInfoFromPlayerResponse(pr: PlayerResponse, videoId: string): YoutubeVideoInfo {
  const details = pr.videoDetails ?? {};
  const thumbnails = details.thumbnail?.thumbnails ?? [];
  const formats = [...(pr.streamingData?.adaptiveFormats ?? []), ...(pr.streamingData?.formats ?? [])];
  return {
    videoId,
    title: (details.title ?? '').trim(),
    channel: (details.author ?? '').trim(),
    durationSec: Number(details.lengthSeconds) || 0,
    image: thumbnails.at(-1)?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    playability: playabilityOf(pr),
    reason: (pr.playabilityStatus?.reason ?? '').trim(),
    formats,
    ...captionsOf(pr),
  };
}

function isYoutubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

/**
 * Reads a video's details and formats from its watch page with one plain request: the page lists
 * every format with its size (no stream URLs; the download is yt-dlp's job). `SOCS=CAI` skips the
 * EU consent page.
 */
export async function fetchYoutubeVideoInfo(videoId: string): Promise<YoutubeVideoInfo> {
  const url = youtubeWatchUrl(videoId);
  const { status, text } = await fetchRawResponse(url, {
    headers: {
      'User-Agent': userAgentForUrl(url),
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'SOCS=CAI',
    },
    validateRedirectHost: (host) => {
      if (!isYoutubeHost(host)) throw new Error(`YouTube redirected to ${host}`);
    },
  });
  if (status >= 400) throw new Error(`YouTube answered HTTP ${status}`);
  const pr = extractPlayerResponse(text);
  if (!pr) throw new Error('No player response on the YouTube page');
  return videoInfoFromPlayerResponse(pr, videoId);
}

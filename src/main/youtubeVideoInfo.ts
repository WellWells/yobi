import { obj, str } from './flow/skills/jsonPick';
import { fetchRawResponse } from './pageLoader';
import { userAgentForUrl } from './userAgent';
import { youtubeWatchUrl } from '../shared/youtubeUrl';
import type { YtFormat } from '../shared/ytdl';

/** `botCheck`: YouTube asked this request to sign in ("confirm you're not a bot"), not the video. */
export type YoutubePlayability = 'ok' | 'live' | 'upcoming' | 'unplayable' | 'botCheck';

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
  playabilityStatus?: { status?: string; reason?: string; errorScreen?: { playerInterstitialRenderer?: unknown } };
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

/**
 * YouTube's bot check: a sign-in interstitial in the video's place and nothing about the video. It
 * is about the request, not the video — the same read a second later often plays. An age gate
 * shows the same interstitial but still carries the video's details; a private or removed video
 * shows an error message instead. Read from the shape, not the wording, which follows the language.
 */
function isBotCheck(pr: PlayerResponse): boolean {
  const status = pr.playabilityStatus;
  return status?.status === 'LOGIN_REQUIRED' && !pr.videoDetails && status.errorScreen?.playerInterstitialRenderer !== undefined;
}

function playabilityOf(pr: PlayerResponse): YoutubePlayability {
  const details = pr.videoDetails ?? {};
  if (details.isUpcoming) return 'upcoming';
  if (details.isLive) return 'live';
  const status = pr.playabilityStatus?.status ?? '';
  if (status === 'OK') return 'ok';
  if (status === 'LIVE_STREAM_OFFLINE') return 'upcoming';
  if (isBotCheck(pr)) return 'botCheck';
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

function stayOnYoutube(host: string): void {
  if (!isYoutubeHost(host)) throw new Error(`YouTube redirected to ${host}`);
}

/** How many times the watch page is read while YouTube answers with its bot check. */
export const BOT_CHECK_READS = 3;
/** The pause before reading again after a bot check. */
export const BOT_CHECK_PAUSE_MS = 800;

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readWatchPage(videoId: string, signal: AbortSignal | undefined): Promise<YoutubeVideoInfo> {
  const url = youtubeWatchUrl(videoId);
  const { status, text } = await fetchRawResponse(url, {
    headers: {
      'User-Agent': userAgentForUrl(url),
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'SOCS=CAI',
    },
    validateRedirectHost: stayOnYoutube,
    ...(signal ? { signal } : {}),
  });
  if (status >= 400) throw new Error(`YouTube answered HTTP ${status}`);
  const pr = extractPlayerResponse(text);
  if (!pr) throw new Error('No player response on the YouTube page');
  return videoInfoFromPlayerResponse(pr, videoId);
}

/**
 * Reads a video's details and formats from its watch page with one plain request: the page lists
 * every format with its size (no stream URLs; the download is yt-dlp's job). `SOCS=CAI` skips the
 * EU consent page. A bot check is read again, up to `BOT_CHECK_READS` times; the last one is
 * returned as `botCheck` when every read got it.
 */
export async function fetchYoutubeVideoInfo(videoId: string, signal?: AbortSignal): Promise<YoutubeVideoInfo> {
  let info = await readWatchPage(videoId, signal);
  for (let read = 1; read < BOT_CHECK_READS && info.playability === 'botCheck'; read++) {
    await pause(BOT_CHECK_PAUSE_MS, signal);
    info = await readWatchPage(videoId, signal);
  }
  return info;
}

/** What a link preview shows of a video: no length, formats or captions. */
export interface YoutubeLinkCard {
  title: string;
  channel: string;
  image: string;
}

function isYtimgUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'i.ytimg.com' || url.hostname.endsWith('.ytimg.com'));
  } catch {
    return false;
  }
}

/**
 * A video's title, channel and cover from YouTube's oEmbed endpoint, which answers while the watch
 * page is held behind the bot check. Throws when the video has none (removed, private) or the
 * answer is not one.
 */
export async function fetchYoutubeLinkCard(videoId: string, signal?: AbortSignal): Promise<YoutubeLinkCard> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`;
  const { status, text } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url) },
    validateRedirectHost: stayOnYoutube,
    ...(signal ? { signal } : {}),
  });
  if (status >= 400) throw new Error(`YouTube oEmbed answered HTTP ${status}`);
  let data: Record<string, unknown> | undefined;
  try {
    data = obj(JSON.parse(text));
  } catch {
    data = undefined;
  }
  const title = str(data?.title).trim();
  if (!title) throw new Error('YouTube oEmbed gave no title');
  const thumbnail = str(data?.thumbnail_url);
  return {
    title,
    channel: str(data?.author_name).trim(),
    image: isYtimgUrl(thumbnail) ? thumbnail : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

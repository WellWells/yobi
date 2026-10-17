import { arr, num, obj, str } from './jsonPick';

/*
 * Reads the player configuration (`window.playerConfig`) out of the HTML of Vimeo's embed player
 * page, without fetching anything. The JSON is parsed, never run.
 */

/** One caption track (`request.text_tracks[]`): a signed `captions.vimeo.com/….vtt` link. */
export interface VimeoTextTrack {
  language: string;
  label: string;
  url: string;
  /** Machine-made (not uploaded by the owner). */
  auto: boolean;
  default: boolean;
}

/** A progressive file (`request.files.progressive[]`): H.264 with AAC, one per size. */
export interface VimeoProgressive {
  url: string;
  width: number;
  height: number;
  fps: number;
}

export interface VimeoConfig {
  title: string;
  /** The owner's name. */
  channel: string;
  durationS: number;
  /** The thumbnail, https only; "" when there is none. */
  cover: string;
  /** The default CDN's HLS master with AV1, HEVC and Opus left out (`avc_url`); "" when there is none. */
  hlsUrl: string;
  progressive: VimeoProgressive[];
  textTracks: VimeoTextTrack[];
  /** The video is DRM-protected (`request.drm`): never downloaded. */
  drm: boolean;
  /** A live event that is on now, or not started yet; null for a video. */
  live: 'live' | 'upcoming' | null;
  /** Where fresh signed links come from (`request.config_refresh_url`); "" when none was given. */
  refreshUrl: string;
}

const CONFIG_MARKER = /window\.playerConfig\s*=\s*/;

/** The JSON object starting at `start` (a `{`), by matching braces outside strings; null when it never closes. */
function objectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** `window.playerConfig` from the player page's HTML, parsed; null when the page has none. */
export function playerConfigJson(html: string): unknown {
  const marker = CONFIG_MARKER.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') return null;
  const json = objectAt(html, start);
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** An https URL, resolved against `base` when relative (old configs wrote caption links that way); "" otherwise. */
function httpsUrl(raw: string, base?: string): string {
  if (!raw) return '';
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function hlsUrlOf(files: Record<string, unknown> | undefined): string {
  const hls = obj(files?.hls);
  const cdns = obj(hls?.cdns);
  if (!cdns) return '';
  const preferred = obj(cdns[str(hls?.default_cdn)]);
  const cdn = preferred ?? Object.values(cdns).map(obj).find(Boolean);
  return httpsUrl(str(cdn?.avc_url) || str(cdn?.url));
}

function progressiveOf(files: Record<string, unknown> | undefined): VimeoProgressive[] {
  return arr(files?.progressive).map(obj).flatMap((file) => {
    const url = httpsUrl(str(file?.url));
    // Only mp4 files: Vimeo's progressive transcodes are H.264 with AAC (`…-h264-<n>p/…mp4`).
    if (!file || !url || str(file.mime) !== 'video/mp4') return [];
    return [{ url, width: num(file.width), height: num(file.height), fps: num(file.fps) }];
  });
}

/** Uploaded by the owner unless the track says it was made by a machine. */
function isAutoTrack(track: Record<string, unknown>): boolean {
  return /\b(?:ai|auto|automatic|machine)/i.test(str(track.provenance));
}

function textTracksOf(request: Record<string, unknown> | undefined): VimeoTextTrack[] {
  return arr(request?.text_tracks).map(obj).flatMap((track) => {
    const url = httpsUrl(str(track?.url), 'https://player.vimeo.com/');
    if (!track || !url) return [];
    return [{
      language: str(track.lang),
      label: str(track.label),
      url,
      auto: isAutoTrack(track),
      default: track.default === true,
    }];
  });
}

function liveOf(video: Record<string, unknown> | undefined): VimeoConfig['live'] {
  const status = str(obj(video?.live_event)?.status);
  if (status === 'started') return 'live';
  if (status === 'pending' || status === 'unstarted') return 'upcoming';
  return null;
}

/** The player configuration, as Yobi uses it; null when it is not one (no `video` and `request`). */
export function readPlayerConfig(config: unknown): VimeoConfig | null {
  const root = obj(config);
  const video = obj(root?.video);
  const request = obj(root?.request);
  if (!video || !request) return null;
  const files = obj(request.files);
  const drm = request.drm !== undefined && request.drm !== null && request.drm !== false;
  return {
    title: str(video.title).trim(),
    channel: str(obj(video.owner)?.name).trim(),
    durationS: Math.max(0, Math.round(num(video.duration))),
    cover: httpsUrl(str(video.thumbnail_url)),
    hlsUrl: hlsUrlOf(files),
    progressive: progressiveOf(files),
    textTracks: textTracksOf(request),
    drm,
    live: liveOf(video),
    refreshUrl: httpsUrl(str(request.config_refresh_url)),
  };
}

/** Why the player page showed no configuration. */
export type VimeoPageFailure =
  /** Plays only on the site that embeds it (403, "cannot be played here"). */
  | 'embedOnly'
  /** Private, the owner's account suspended, or otherwise not shown (another 403 privacy page). */
  | 'unavailable'
  | 'notFound'
  /** A challenge Yobi's own request could not pass (Cloudflare's 401, a 429): a browser window may. */
  | 'challenge'
  | 'other';

export function pageFailure(status: number, html: string): VimeoPageFailure {
  if (status === 404 || /name:\s*'NotFoundError'/.test(html)) return 'notFound';
  if (status === 403 && /cannot be played here/i.test(html)) return 'embedOnly';
  if (status === 403 && /name:\s*'PrivacyError'/.test(html)) return 'unavailable';
  // Every page loads Cloudflare's precursor script; only the challenge itself shows Turnstile.
  if (status === 401 || status === 429 || (status === 403 && /turnstile/i.test(html))) return 'challenge';
  return 'other';
}

/**
 * The track an .srt is made from: the owner's default, else the first the owner uploaded, else the
 * default, else the first; null when there is none.
 */
export function pickTextTrack(tracks: readonly VimeoTextTrack[]): VimeoTextTrack | null {
  return tracks.find((t) => t.default && !t.auto)
    ?? tracks.find((t) => !t.auto)
    ?? tracks.find((t) => t.default)
    ?? tracks[0]
    ?? null;
}

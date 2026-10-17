import { arr, num, obj, str } from './jsonPick';

/*
 * SoundCloud's own web player, signed out, parsed without fetching anything: the public
 * `client_id` its scripts carry, and its API's track (`api-v2.soundcloud.com/resolve`) with the
 * streams it lists (`media.transcodings`). The endpoints are what yt-dlp (Unlicense) reads; no
 * code of it is copied.
 */

/** The hosts every SoundCloud request may go to: the site and its API, its CDNs and the newer stream host. */
export const SOUNDCLOUD_HOSTS = ['soundcloud.com', 'sndcdn.com', 'soundcloud.cloud'] as const;

/** `client_id:"<32 characters>"` in one of the web player's script bundles. */
const CLIENT_ID_RE = /client_id\s*:\s*"([0-9a-zA-Z]{32})"/;

/** The player's script bundles, as the home page lists them; only `*.sndcdn.com/assets/…js`. */
export function scriptAssets(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    try {
      const url = new URL(match[1]);
      if (url.protocol === 'https:' && /(^|\.)sndcdn\.com$/i.test(url.hostname) && /\/assets\/[^/]+\.js$/i.test(url.pathname)) {
        urls.push(url.toString());
      }
    } catch {
      // A relative or broken src is not a bundle Yobi reads.
    }
  }
  return urls;
}

/** The public client id in a script bundle; null when this bundle has none. */
export function findClientId(js: string): string | null {
  return CLIENT_ID_RE.exec(js)?.[1] ?? null;
}

/**
 * Whether the track plays whole: `ALLOW`, or `MONETIZE` (with ads); `SNIP` is the 30 s preview a
 * signed-out listener gets of a Go+ track; `BLOCK` does not play here at all.
 */
export type SoundcloudPolicy = 'play' | 'preview' | 'blocked';

/** One stream SoundCloud offers for a track. */
export interface SoundcloudStream {
  /** The API URL that answers with the signed stream URL (`{ url }`). */
  url: string;
  protocol: 'hls' | 'progressive';
  /** `aac_160k`, `mp3_0_0`… */
  preset: string;
  /** The source's bitrate, for the progress bar's total. */
  kbps: number;
}

export interface SoundcloudTrack {
  /** SoundCloud's own number for the track: the download's reuse key. */
  id: string;
  title: string;
  artist: string;
  durationS: number;
  /** The 500×500 artwork (the artist's picture when the track has none); "" when neither exists. */
  cover: string;
  /** The track's own page, private ones with their secret. */
  permalink: string;
  policy: SoundcloudPolicy;
  /** Handed back with a stream's request, as the web player does. */
  trackAuthorization: string;
  /** The best stream Yobi reads; null when there is none it can. */
  stream: SoundcloudStream | null;
  /** Only encrypted streams were offered (DRM): refused, never downloaded. */
  encryptedOnly: boolean;
}

/** What `resolve` answered: a track, a playlist, or something else (an artist, a page). */
export type SoundcloudResolved = { kind: 'track'; track: SoundcloudTrack } | { kind: 'playlist' } | { kind: 'other' };

function policyOf(raw: string): SoundcloudPolicy {
  if (raw === 'SNIP') return 'preview';
  if (raw === 'BLOCK') return 'blocked';
  return 'play';
}

/** The artwork at 500×500 (the API gives `-large`, 100×100), https only. */
export function artworkUrl(raw: string): string {
  if (!raw.startsWith('https://')) return '';
  return raw.replace(/-(?:large|t\d+x\d+|crop|original)(\.\w+)(?=$|\?)/, '-t500x500$1');
}

function kbpsOf(preset: string, mime: string): number {
  const named = /_(\d+)k$/.exec(preset);
  if (named) return Number(named[1]);
  return mime.startsWith('audio/mpeg') ? 128 : 0;
}

/*
 * Ranked: AAC over HLS first, the higher bitrate first; then MP3 over HLS, then the progressive
 * MP3. Skipped: `abr_*`, Opus, a snipped (preview) stream, and anything encrypted.
 */
function rank(stream: SoundcloudStream, mime: string): number {
  const aac = mime.startsWith('audio/mp4') || stream.preset.startsWith('aac_');
  if (stream.protocol === 'hls' && aac) return 3_000 + stream.kbps;
  if (stream.protocol === 'hls' && mime.startsWith('audio/mpeg')) return 2_000;
  if (stream.protocol === 'progressive' && mime.startsWith('audio/mpeg')) return 1_000;
  return -1;
}

/** The streams a track lists, best first, and whether only encrypted ones were offered. */
export function pickStream(transcodings: readonly unknown[]): { stream: SoundcloudStream | null; encryptedOnly: boolean } {
  const ranked: Array<{ stream: SoundcloudStream; score: number }> = [];
  let encrypted = 0;
  let playable = 0;
  for (const item of transcodings) {
    const t = obj(item);
    const format = obj(t?.format);
    const protocol = str(format?.protocol);
    const preset = str(t?.preset);
    const mime = str(format?.mime_type);
    const url = str(t?.url);
    if (!t || t.snipped === true || !url.startsWith('https://') || preset.startsWith('abr_')) continue;
    if (protocol.includes('encrypted')) {
      encrypted += 1;
      continue;
    }
    if (protocol !== 'hls' && protocol !== 'progressive') continue;
    playable += 1;
    const stream: SoundcloudStream = { url, protocol, preset, kbps: kbpsOf(preset, mime) };
    const score = rank(stream, mime);
    if (score >= 0) ranked.push({ stream, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { stream: ranked[0]?.stream ?? null, encryptedOnly: playable === 0 && encrypted > 0 };
}

/** `resolve`'s answer, read without trusting its shape. */
export function parseResolved(json: unknown): SoundcloudResolved {
  const root = obj(json);
  const kind = str(root?.kind);
  if (kind === 'playlist' || kind === 'system-playlist') return { kind: 'playlist' };
  if (kind !== 'track' || !root) return { kind: 'other' };
  const user = obj(root.user);
  const { stream, encryptedOnly } = pickStream(arr(obj(root.media)?.transcodings));
  const id = num(root.id);
  return {
    kind: 'track',
    track: {
      id: id > 0 ? String(id) : str(root.urn),
      title: str(root.title).trim(),
      artist: str(user?.username).trim(),
      durationS: Math.round(num(root.duration) / 1000),
      cover: artworkUrl(str(root.artwork_url)) || artworkUrl(str(user?.avatar_url)),
      permalink: str(root.permalink_url),
      policy: policyOf(str(root.policy)),
      trackAuthorization: str(root.track_authorization),
      stream,
      encryptedOnly,
    },
  };
}

/** The signed stream URL a stream's API URL answers with; "" when the answer has none. */
export function signedStreamUrl(json: unknown): string {
  const url = str(obj(json)?.url);
  return url.startsWith('https://') ? url : '';
}

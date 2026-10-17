import { parseDashManifest } from './dashManifest';
import type { DashManifest } from './dashManifest';
import { isHlsMaster, parseHlsMaster, parseHlsMedia } from './hlsPlaylist';
import type { HlsMaster, HlsMediaPlaylist } from './hlsPlaylist';
import { fetchStreamText } from './streamFetch';
import type { StreamRequestOptions } from './streamFetch';
import { StreamFormatError } from './streamTypes';

/*
 * Fetching and parsing a playlist or manifest in one call, through the same guarded requests as
 * the segments (`streamFetch.ts`): relative URIs resolve against where it actually came from,
 * after redirects. A site reads the master (or manifest) in its `info` for the menu, then the
 * chosen rendition's media playlist when it downloads.
 */

/** A master playlist, or — for a link that is already a media playlist — that playlist. */
export type HlsPlaylist = { master: HlsMaster; media?: never } | { media: HlsMediaPlaylist; master?: never };

export async function readHlsPlaylist(url: string, options: StreamRequestOptions): Promise<HlsPlaylist> {
  const { text, finalUrl } = await fetchStreamText(url, options);
  return isHlsMaster(text) ? { master: parseHlsMaster(text, finalUrl) } : { media: parseHlsMedia(text, finalUrl) };
}

/** A media playlist's segments; a live (still growing) playlist is refused. */
export async function readHlsMedia(url: string, options: StreamRequestOptions): Promise<HlsMediaPlaylist> {
  const { text, finalUrl } = await fetchStreamText(url, options);
  const media = parseHlsMedia(text, finalUrl);
  if (media.live) throw new StreamFormatError('The playlist is live', true);
  return media;
}

export async function readDashManifest(url: string, options: StreamRequestOptions): Promise<DashManifest> {
  const { text, finalUrl } = await fetchStreamText(url, options);
  return parseDashManifest(text, finalUrl);
}

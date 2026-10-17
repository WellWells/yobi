import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { audioByGroup } from '../../downloader/hlsPlaylist';
import type { HlsMaster, HlsMediaPlaylist, HlsVariant } from '../../downloader/hlsPlaylist';
import { isAac, isH264, shortSide } from '../../downloader/streamChoices';
import type { StreamRendition } from '../../downloader/streamChoices';
import { streamRequest } from '../../downloader/streamFetch';
import type { FetchLike, StreamRequestOptions } from '../../downloader/streamFetch';
import { readHlsMedia, readHlsPlaylist } from '../../downloader/streamRead';
import { ProtectedStreamError, StreamFormatError, StreamHttpError, StreamRefusedError } from '../../downloader/streamTypes';
import type { SegmentRef } from '../../downloader/streamTypes';
import { probeMedia } from '../../downloader/ytdlpInvoke';
import type { MediaProbe } from '../../downloader/ytdlpInvoke';
import { BlockedAddressError, assertPublicHttpUrl } from '../../net/ssrfGuard';
import { resolveYtdlTools } from '../../youtubeDownload/toolState';

/*
 * A bare `.m3u8` link's streams, on whatever host serves them. Any public host may be asked —
 * the playlist, its variants and segments often sit on different CDNs — but never this computer
 * or its local network: every request (each redirect included) resolves its host first and is
 * refused for a private, loopback or link-local address (`publicFetch`). A bot user can paste
 * one, so this is what keeps a pasted link from reaching the person's own network.
 *
 * Masters copied off the web often name no RESOLUTION or CODECS. The menu only offers H.264 by its
 * short side, so such a variant's first segment is fetched in part (its first `PROBE_BYTES`, an
 * fMP4 init section plus the start of the first fragment) and read with ffprobe. Without the
 * download tools nothing is probed: the menu then says the tools are missing, as it does anyway.
 */

/** Enough of a TS segment for its SPS and its audio header, or of an fMP4 init section and the first fragment. */
export const PROBE_BYTES = 512 * 1024;
const PROBE_TIMEOUT_MS = 30_000;
/** Variant playlists and probes in flight at once. */
const READ_CONCURRENCY = 3;

/** A request refused because its host is this computer or a local network address. */
export class PrivateAddressError extends StreamRefusedError {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateAddressError';
  }
}

/** Node's fetch, each request's host checked first: a private address is a `PrivateAddressError`. */
export const publicFetch: FetchLike = async (url, init) => {
  try {
    await assertPublicHttpUrl(url);
  } catch (err) {
    if (err instanceof BlockedAddressError) throw new PrivateAddressError(err.message);
    throw err;
  }
  return fetch(url, init);
};

/** Every request of an m3u8 read or download: any public https host, with the step's Stop. */
export function m3u8Request(signal?: AbortSignal): StreamRequestOptions {
  return { isAllowedHost: () => true, fetch: publicFetch, ...(signal ? { signal } : {}) };
}

export interface M3u8Rendition extends StreamRendition {
  codecs: readonly string[];
  media: HlsMediaPlaylist;
  /** The separate sound's media playlist (the variant's AUDIO group), when it has one. */
  audio?: string;
  /** Whether it has a picture; undefined when neither the playlist nor a probe said. */
  video?: boolean;
  /** Whether it has sound (its own or its group's); true when nothing said otherwise. */
  sound: boolean;
}

export interface M3u8Read {
  renditions: M3u8Rendition[];
  durationS: number;
  /**
   * Whether every rendition is known as far as the menu needs: none needed a probe, or the
   * download tools were there to probe them. False only while the tools are missing.
   */
  complete: boolean;
}

export interface M3u8Deps {
  /** ffprobe on a file; null when the tools are missing or it fails. */
  probe: (file: string) => Promise<MediaProbe | null>;
  toolsReady: () => Promise<boolean>;
}

export const defaultM3u8Deps: M3u8Deps = {
  probe: probeMedia,
  toolsReady: async () => (await resolveYtdlTools()) !== null,
};

const AUDIO_CODEC = /^(mp4a|ac-3|ec-3|opus|flac|mp3|vorbis)/i;

function hasVideoCodec(codecs: readonly string[]): boolean {
  return codecs.some((c) => !AUDIO_CODEC.test(c));
}

/** ffprobe's codec names as the playlist would have written them, enough for `isH264` / `isAac`. */
function probedCodecs(probe: MediaProbe): string[] {
  const video = probe.videoCodec === 'h264' ? 'avc1.' : probe.videoCodec;
  const audio = probe.audioCodec === 'aac' ? 'mp4a.40.2' : probe.audioCodec;
  return [video, audio].filter((c): c is string => Boolean(c));
}

/** A variant naming no codec at all, or a picture without its size: what only a probe can tell. */
function needsProbe(variant: Pick<HlsVariant, 'codecs' | 'width' | 'height'>): boolean {
  if (variant.codecs.length === 0) return true;
  return hasVideoCodec(variant.codecs) && !(variant.width && variant.height);
}

/** `bytes a-b/total` → total; null when the server did not say. */
function rangeTotal(response: Response): number | null {
  const total = Number(/\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? '');
  if (Number.isFinite(total) && total > 0) return total;
  if (response.status !== 200) return null;
  const length = Number(response.headers.get('content-length') ?? '');
  return Number.isFinite(length) && length > 0 ? length : null;
}

/** Up to `max` bytes from the start of a piece, and the piece's whole size when the server says. */
async function readHead(piece: SegmentRef, max: number, request: StreamRequestOptions): Promise<{ bytes: Buffer; size: number | null }> {
  const offset = piece.range?.offset ?? 0;
  const want = Math.min(max, piece.range?.length ?? max);
  const { response } = await streamRequest(piece.url, request, { range: { offset, length: want }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok || (response.status === 200 && offset > 0)) {
    // A server that ignores Range for a piece further into a file: not worth reading up to it.
    await response.body?.cancel().catch(() => {});
    throw new StreamHttpError(`HTTP ${response.status} for a segment`, response.status);
  }
  const size = piece.range?.length ?? rangeTotal(response);
  const chunks: Buffer[] = [];
  let read = 0;
  const reader = response.body?.getReader();
  try {
    while (reader && read < want) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      read += value.byteLength;
    }
  } finally {
    await reader?.cancel().catch(() => {});
  }
  return { bytes: Buffer.concat(chunks).subarray(0, want), size };
}

interface Probed {
  probe: MediaProbe | null;
  /** The first media segment's bytes per second, when the whole of a TS segment's size is known. */
  bitrate: number | null;
}

/**
 * ffprobe on the start of a media playlist: its first piece, and — when that is an fMP4 init
 * section — the start of the first fragment after it, best effort (the init section alone names
 * the codecs and size).
 */
async function probeStart(media: HlsMediaPlaylist, request: StreamRequestOptions, dir: string, deps: M3u8Deps, n: number): Promise<Probed> {
  const [first, second] = media.segments;
  const hasInit = media.segments.length > media.mediaSegments;
  const head = await readHead(first, PROBE_BYTES, request);
  const parts = [head.bytes];
  if (hasInit && second && head.bytes.length < PROBE_BYTES) {
    try {
      parts.push((await readHead(second, PROBE_BYTES - head.bytes.length, request)).bytes);
    } catch (err) {
      request.signal?.throwIfAborted();
      if (err instanceof PrivateAddressError) throw err;
    }
  }
  const file = path.join(dir, `probe-${n}`);
  await fs.writeFile(file, Buffer.concat(parts));
  const probe = await deps.probe(file);
  const segmentS = media.mediaSegments > 0 ? media.durationS / media.mediaSegments : 0;
  const bitrate = !hasInit && head.size && segmentS > 0 ? (head.size * 8) / segmentS : null;
  return { probe, bitrate };
}

/** `run` over `items`, a few at a time, every outcome kept in order. */
async function settleLimited<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A failure that is the stream's own (protected, live) or a Stop: it ends the read whichever variant met it. */
function decisive(err: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted) || err instanceof ProtectedStreamError || err instanceof PrivateAddressError
    || (err instanceof StreamFormatError && err.live);
}

type VariantLike = Pick<HlsVariant, 'url' | 'bandwidth' | 'averageBandwidth' | 'width' | 'height' | 'frameRate' | 'codecs' | 'audioGroup'>;

async function readRendition(
  variant: VariantLike,
  audio: string | undefined,
  given: HlsMediaPlaylist | undefined,
  context: { request: StreamRequestOptions; dir: string | null; deps: M3u8Deps; n: number },
): Promise<M3u8Rendition> {
  const media = given ?? await readHlsMedia(variant.url, context.request);
  if (media.live) throw new StreamFormatError('The playlist is live', true);
  const { probe, bitrate } = context.dir && needsProbe(variant)
    ? await probeStart(media, context.request, context.dir, context.deps, context.n)
    : { probe: null, bitrate: null };
  const width = variant.width ?? probe?.width ?? undefined;
  const height = variant.height ?? probe?.height ?? undefined;
  // The playlist's own CODECS win; a probe only stands in for a variant that names none.
  const declared = variant.codecs.length > 0;
  const codecs = declared ? variant.codecs : probe ? probedCodecs(probe) : [];
  const video = declared ? hasVideoCodec(variant.codecs) : probe?.hasVideo;
  const ownSound = declared ? variant.codecs.some((c) => AUDIO_CODEC.test(c)) : probe?.hasAudio ?? true;
  return {
    ...(width && height ? { width, height } : {}),
    ...(variant.frameRate ? { frameRate: variant.frameRate } : {}),
    bandwidth: variant.averageBandwidth ?? (variant.bandwidth || bitrate || 0),
    codecs,
    media,
    ...(audio ? { audio } : {}),
    ...(video !== undefined ? { video } : {}),
    sound: Boolean(audio) || ownSound,
  };
}

interface VariantToRead {
  variant: VariantLike;
  audio?: string;
  /** Already read: the link itself was this media playlist. */
  media?: HlsMediaPlaylist;
}

/** A master's variants, each with its AUDIO group's sound. */
function masterVariants(master: HlsMaster): VariantToRead[] {
  const groups = audioByGroup(master.renditions);
  return master.variants.map((variant) => {
    const audio = variant.audioGroup ? groups.get(variant.audioGroup) : undefined;
    return { variant, ...(audio ? { audio } : {}) };
  });
}

/**
 * Every rendition of the link: a master's variants (each with its media playlist read, and
 * probed when the master does not say enough), or the one stream of a media playlist. A variant
 * that cannot be read is left out unless every one fails; a protected or live stream, a private
 * address or a Stop ends the read.
 */
export async function readM3u8Renditions(url: string, request: StreamRequestOptions, deps: M3u8Deps = defaultM3u8Deps): Promise<M3u8Read> {
  const playlist = await readHlsPlaylist(url, request);
  if (playlist.media?.live) throw new StreamFormatError('The playlist is live', true);
  const variants = playlist.master ? masterVariants(playlist.master) : [{ variant: { url, bandwidth: 0, codecs: [] }, media: playlist.media }];
  const needed = variants.some((v) => needsProbe(v.variant));
  const probed = needed && await deps.toolsReady();
  const dir = probed ? await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-m3u8-')) : null;
  try {
    const results = await settleLimited(variants, READ_CONCURRENCY, (v, n) => readRendition(v.variant, v.audio, v.media, { request, dir, deps, n }));
    const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    const stop = failures.find((err) => decisive(err, request.signal));
    if (stop !== undefined) throw stop;
    const renditions = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (renditions.length === 0) throw failures[0];
    return { renditions, durationS: Math.max(...renditions.map((r) => r.media.durationS)), complete: !needed || probed };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The renditions the menu can offer: H.264 with a known size and, where one quality comes with
 * several sounds (Apple's examples pair each picture with AAC, AC-3 and E-AC-3), the AAC ones
 * only — what phones and Telegram play, though the others are larger.
 */
export function offerable(renditions: readonly M3u8Rendition[]): M3u8Rendition[] {
  const videos = renditions.filter((r) => isH264(r.codecs) && r.width && r.height);
  const aacLines = new Set(videos.filter((r) => isAac(r.codecs)).map(shortSide));
  return videos.filter((r) => isAac(r.codecs) || !aacLines.has(shortSide(r)));
}

/** Whether every sound the menu's files would carry is AAC (Telegram plays it inline); unknown counts as AAC. */
export function soundIsAac(renditions: readonly M3u8Rendition[]): boolean {
  return renditions.every((r) => !r.codecs.some((c) => AUDIO_CODEC.test(c)) || isAac(r.codecs));
}

/** What an MP3 is made from: the largest rendition with sound — its separate sound when it has one. Null when none has sound. */
export function soundSource(renditions: readonly M3u8Rendition[]): { audio: string } | { media: HlsMediaPlaylist } | null {
  const top = [...renditions].filter((r) => r.sound).sort((a, b) => b.bandwidth - a.bandwidth)[0];
  if (!top) return null;
  return top.audio ? { audio: top.audio } : { media: top.media };
}

import { readHlsMedia, readHlsPlaylist } from '../../downloader/streamRead';
import { contentLength, hostAllowlist } from '../../downloader/streamFetch';
import type { FetchLike, StreamRequestOptions } from '../../downloader/streamFetch';
import { isAac, isH264, renditionFor, shortSide } from '../../downloader/streamChoices';
import type { StreamRendition } from '../../downloader/streamChoices';
import { audioByGroup } from '../../downloader/hlsPlaylist';
import type { HlsVariant } from '../../downloader/hlsPlaylist';
import { ProtectedStreamError, StreamFormatError, progressivePlan } from '../../downloader/streamTypes';
import type { SegmentPlan } from '../../downloader/streamTypes';
import type { VimeoConfig } from './vimeoParse';

/*
 * A Vimeo video's streams as the quality menu and a download use them: the H.264 variants of the
 * HLS master, each with its sound in its own AUDIO group (the variant's BANDWIDTH covers both), and
 * any progressive mp4s, which win over the same HLS size. `SignedLinks` keeps the signed links
 * fresh through a long download.
 */

/** Vimeo's media, caption and thumbnail hosts (`vod-adaptive-ak.`, `skyfire.`, `vod-progressive-ak.`, `i.` …). */
export const isVimeoMediaHost = hostAllowlist(['vimeocdn.com']);

/** Where a rendition comes from. */
export type VimeoSource =
  | { kind: 'hls'; variant: HlsVariant; audio?: string }
  | { kind: 'progressive'; url: string };

export interface VimeoRendition extends StreamRendition {
  source: VimeoSource;
}

/**
 * Vimeo's progressive files are H.264 with AAC, but the configuration names no codec: the
 * menu's H.264 check is given the family alone.
 */
const PROGRESSIVE_CODECS = ['avc1.', 'mp4a.40.2'] as const;

/** A path under a DRM asset: refused before anything is fetched. */
function checkNotDrm(url: string): void {
  if (/\/drm\//i.test(new URL(url).pathname)) throw new ProtectedStreamError('Vimeo DRM');
}

async function hlsRenditions(url: string, request: StreamRequestOptions): Promise<VimeoRendition[]> {
  checkNotDrm(url);
  const playlist = await readHlsPlaylist(url, request);
  if (!playlist.master) throw new StreamFormatError('Vimeo gave a media playlist where a master was expected');
  const audio = audioByGroup(playlist.master.renditions);
  return playlist.master.variants.filter((v) => isH264(v.codecs)).map((variant) => {
    const sound = variant.audioGroup ? audio.get(variant.audioGroup) : undefined;
    return {
      ...(variant.width && variant.height ? { width: variant.width, height: variant.height } : {}),
      ...(variant.frameRate ? { frameRate: variant.frameRate } : {}),
      // The average estimates a file's size better than the peak; either covers the sound too.
      bandwidth: variant.averageBandwidth ?? variant.bandwidth,
      codecs: variant.codecs,
      source: { kind: 'hls', variant, ...(sound ? { audio: sound } : {}) },
    };
  });
}

async function progressiveRenditions(config: VimeoConfig, request: StreamRequestOptions): Promise<VimeoRendition[]> {
  const files = config.progressive.filter((file) => isVimeoMediaHost(new URL(file.url).hostname));
  const sizes = await Promise.all(files.map((file) => contentLength(file.url, request)));
  return files.flatMap((file, index) => {
    const bytes = sizes[index];
    // Without a size the HLS rendition of that size, which has an estimate, is the better pick.
    if (!bytes || config.durationS <= 0) return [];
    return [{
      width: file.width,
      height: file.height,
      ...(file.fps ? { frameRate: file.fps } : {}),
      bandwidth: (bytes * 8) / config.durationS,
      codecs: PROGRESSIVE_CODECS,
      source: { kind: 'progressive', url: file.url },
    }];
  });
}

/**
 * Every rendition the menu may offer: the HLS variants, and the progressive files that took
 * their size's place. Throws `ProtectedStreamError` for DRM, the stream errors otherwise.
 */
export async function readVimeoRenditions(config: VimeoConfig, request: StreamRequestOptions): Promise<VimeoRendition[]> {
  if (config.drm) throw new ProtectedStreamError('Vimeo DRM');
  const [hls, progressive] = await Promise.all([
    config.hlsUrl ? hlsRenditions(config.hlsUrl, request) : Promise.resolve([]),
    progressiveRenditions(config, request),
  ]);
  const taken = new Set(progressive.map(shortSide));
  return [...progressive, ...hls.filter((r) => !taken.has(shortSide(r)))];
}

/** The plans for one video download: the picture (with its sound when progressive) and the separate sound. */
export async function videoPlans(
  rendition: VimeoRendition,
  durationS: number,
  request: StreamRequestOptions,
): Promise<{ video: SegmentPlan; audio?: SegmentPlan }> {
  const { source } = rendition;
  if (source.kind === 'progressive') return { video: progressivePlan(source.url, durationS) };
  checkNotDrm(source.variant.url);
  if (source.audio) checkNotDrm(source.audio);
  const [video, audio] = await Promise.all([
    readHlsMedia(source.variant.url, request),
    source.audio ? readHlsMedia(source.audio, request) : Promise.resolve(undefined),
  ]);
  return { video, ...(audio ? { audio } : {}) };
}

/**
 * What an MP3 is made from: the sound of the largest variant (its group is the best sound), a
 * variant that carries its own sound, or else the largest progressive file; null when the video
 * has no sound at all.
 */
export async function soundPlan(
  renditions: readonly VimeoRendition[],
  durationS: number,
  request: StreamRequestOptions,
): Promise<{ audio?: SegmentPlan; video?: SegmentPlan } | null> {
  // A variant's CODECS name its sound too (`avc1…,mp4a.40.2`); a silent video's name none.
  const withSound = renditions.filter((r) => r.source.kind === 'progressive' || isAac(r.codecs));
  const hls = withSound.filter((r) => r.source.kind === 'hls');
  const top = renditionFor(hls, 'best') ?? hls[0];
  if (top?.source.kind === 'hls') {
    const url = top.source.audio ?? top.source.variant.url;
    checkNotDrm(url);
    const plan = await readHlsMedia(url, request);
    return top.source.audio ? { audio: plan } : { video: plan };
  }
  const file = renditionFor(withSound, 'best');
  return file?.source.kind === 'progressive' ? { video: progressivePlan(file.source.url, durationS) } : null;
}

/** `https://<host>/<signature>/<rest>`: Akamai's `exp=<s>~acl=…~hmac=…`, skyfire's `<s>-0x<hex>`. */
const SIGNED = /^(https:\/\/[^/]+\/(?:exp=(\d+)~[^/]+|(\d{9,11})-0x[\da-f]+)\/)(.+)$/i;
/** Fresh signatures are fetched this long before the old ones run out. */
const REFRESH_AHEAD_S = 120;

interface Signed {
  prefix: string;
  expiresS: number;
  rest: string;
}

function signed(url: string): Signed | null {
  const found = SIGNED.exec(url);
  if (!found) return null;
  return { prefix: found[1], expiresS: Number(found[2] ?? found[3]), rest: found[4] };
}

interface Signatures {
  /** The signature of one file, by its path. */
  exact: Map<string, string>;
  /** An adaptive signature covers the whole asset folder (`acl=/<asset>/psid=…/*`), by the asset. */
  byAsset: Map<string, string>;
  /** When the first of them runs out. */
  expiresS: number;
}

/** Every signed link of a configuration, by what each signature covers. */
function signatures(config: VimeoConfig): Signatures {
  const table: Signatures = { exact: new Map(), byAsset: new Map(), expiresS: Number.POSITIVE_INFINITY };
  for (const url of [config.hlsUrl, ...config.progressive.map((p) => p.url)]) {
    const link = signed(url);
    if (!link) continue;
    table.exact.set(link.rest.split('?')[0], link.prefix);
    table.byAsset.set(link.rest.split('/')[0], link.prefix);
    table.expiresS = Math.min(table.expiresS, link.expiresS);
  }
  return table;
}

/**
 * Keeps a download's links signed: a link about to expire gets the matching fresh signature from
 * the player's `config_refresh_url` (one refresh at a time; the same file, or the same asset
 * folder, re-signed). Without a refresh, or when it fails, the link goes as it was.
 */
export class SignedLinks {
  private fresh: Promise<VimeoConfig | null> | null = null;
  private latest: Signatures | null = null;

  constructor(
    private readonly refresh: () => Promise<VimeoConfig | null>,
    private readonly nowS: () => number = () => Date.now() / 1_000,
  ) {}

  async current(url: string): Promise<string> {
    const link = signed(url);
    if (!link || this.nowS() < link.expiresS - REFRESH_AHEAD_S) return url;
    const table = await this.renewed();
    const prefix = table?.exact.get(link.rest.split('?')[0]) ?? table?.byAsset.get(link.rest.split('/')[0]);
    return prefix ? `${prefix}${link.rest}` : url;
  }

  private async renewed(): Promise<Signatures | null> {
    if (this.latest && this.nowS() < this.latest.expiresS - REFRESH_AHEAD_S) return this.latest;
    this.fresh ??= this.refresh().catch(() => null).finally(() => { this.fresh = null; });
    const config = await this.fresh;
    if (config) this.latest = signatures(config);
    return this.latest;
  }

  /** A fetch that sends each request on its current signature (the URL checked again: the host may change). */
  fetch(base: FetchLike, isAllowedHost: (host: string) => boolean): FetchLike {
    return async (url, init) => {
      const now = await this.current(url);
      if (now !== url && !isAllowedHost(new URL(now).hostname)) return base(url, init);
      return base(now, init);
    };
  }
}

/*
 * What the segmented-stream downloader (HLS, DASH, a single progressive file) works on: a plan of
 * byte ranges to fetch and concatenate in order, and the typed failures a site turns into the
 * person's words. Parsing lives in `hlsPlaylist.ts` / `dashManifest.ts`, fetching in
 * `streamFetch.ts` / `segmentFetch.ts`, FFmpeg in `streamMux.ts`, the whole download in
 * `streamDownload.ts`.
 */

/** Bytes `offset` to `offset + length - 1` of a resource. */
export interface ByteRange {
  offset: number;
  length: number;
}

/** One piece to fetch: a whole resource, or a byte range of it. */
export interface SegmentRef {
  /** Absolute https URL. */
  url: string;
  range?: ByteRange;
}

/**
 * A stream as the files to fetch and concatenate, in order: an initialization section (fMP4's
 * EXT-X-MAP or DASH `Initialization`) placed wherever it changes, then the media segments.
 * Concatenated, TS segments make a TS file and fMP4 ones a fragmented MP4, both of which FFmpeg reads.
 */
export interface SegmentPlan {
  segments: SegmentRef[];
  /** Seconds of media, when the playlist or manifest said; 0 when unknown. */
  durationS: number;
}

/** A single file fetched whole (a progressive mp4 or mp3). */
export function progressivePlan(url: string, durationS = 0): SegmentPlan {
  return { segments: [{ url }], durationS };
}

/** The plan's exact size when every piece is a byte range (BYTERANGE playlists, SegmentList ranges); else null. */
export function planExactBytes(plan: SegmentPlan): number | null {
  if (plan.segments.length === 0) return null;
  let total = 0;
  for (const segment of plan.segments) {
    if (!segment.range) return null;
    total += segment.range.length;
  }
  return total;
}

/**
 * The stream is encrypted or DRM-protected (HLS `EXT-X-KEY` other than NONE, SAMPLE-AES, a DASH
 * `ContentProtection`): Yobi never downloads it. Sites refuse with `flow.error.videoDrm`.
 */
export class ProtectedStreamError extends Error {
  constructor(readonly scheme: string) {
    super(`The stream is protected (${scheme})`);
    this.name = 'ProtectedStreamError';
  }
}

/** A playlist or manifest Yobi cannot read: malformed, empty, live, or a form it does not handle. */
export class StreamFormatError extends Error {
  constructor(message: string, readonly live = false) {
    super(message);
    this.name = 'StreamFormatError';
  }
}

/** A request the server answered with an error status, or that never got an answer (`status` 0). */
export class StreamHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'StreamHttpError';
  }
}

/** A URL or redirect off the site's hosts, not https, or a redirect loop: never retried. */
export class StreamRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamRefusedError';
  }
}

/**
 * The most a download may receive, all its requests together (`fetchLimits.ts`): a playlist's
 * declared sizes are the server's word, so the bytes that actually arrive are what is held to it.
 */
export interface FetchLimit {
  bytes: number;
  /** The free disk space set it, not the person's size limit: going past it reads as a full disk. */
  disk: boolean;
}

/** More bytes arrived than the download's `FetchLimit`: stopped at once, never retried. */
export class StreamTooLargeError extends Error {
  readonly limitBytes: number;
  readonly disk: boolean;

  constructor(limit: FetchLimit, readonly receivedBytes: number, message?: string) {
    super(message ?? `Received ${receivedBytes} bytes, over the ${limit.bytes} this download may take`);
    this.name = 'StreamTooLargeError';
    this.limitBytes = limit.bytes;
    this.disk = limit.disk;
  }
}

/** What a Stop throws, as the yt-dlp path does: an error named AbortError naming the site. */
export function streamAbortError(label: string): Error {
  const err = new Error(`${label} download stopped`);
  err.name = 'AbortError';
  return err;
}

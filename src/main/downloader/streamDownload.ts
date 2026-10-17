import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { YtdlProgressSample } from '../../shared/ytdl';
import { extractMp3 } from './extractAudio';
import { byteBudget, fetchPlanToFile } from './segmentFetch';
import type { ByteBudget } from './segmentFetch';
import type { StreamRequestOptions } from './streamFetch';
import { MuxError, defaultMuxDeps, muxStreams } from './streamMux';
import type { StreamMuxDeps } from './streamMux';
import { planExactBytes, progressivePlan } from './streamTypes';
import type { FetchLimit, SegmentPlan } from './streamTypes';
import { probeMedia } from './ytdlpInvoke';
import type { MediaProbe, YtdlpDownloadResult } from './ytdlpInvoke';

/*
 * One segmented download, start to finish, for a site that reads its own streams (a
 * `VideoSite.download`): the chosen video and audio plans fetched into the job folder, then one
 * file made of them — an MP4 (`-c copy`, `+faststart`), an M4A, or an MP3 (`extractMp3`, with the
 * title, artist and cover a phone's player shows). The streams are deleted afterwards and nothing
 * is left on failure or Stop; the file is checked with ffprobe as a yt-dlp download is, and comes
 * back in the same shape, so `youtube_download` saves, splits, reuses and sends it the same way.
 */

export type StreamOutput = 'mp4' | 'm4a' | 'mp3';

export interface StreamDownloadRequest {
  /** The site's name, for logs and the Stop error. */
  label: string;
  /** The job folder `youtube_download` made for this download. */
  jobDir: string;
  /** The picture: a video-only stream, or a progressive file that has its sound in it. */
  video?: SegmentPlan;
  /** The separate sound, when there is one. */
  audio?: SegmentPlan;
  output: StreamOutput;
  /** For `mp3`: the bitrate (`MP3_BITRATE_KBPS[destination]`) and the tags; a cover that cannot be fetched is left out. */
  mp3?: { bitrateKbps: number; title: string; artist: string; coverUrl?: string };
  /** The hosts, headers, fetch and Stop every request goes with. */
  request: StreamRequestOptions;
  /** Segments in flight at once (4 by default). */
  concurrency?: number;
  /** The menu's estimate, so the bar has a total before the end; else the plans' exact sizes when known. */
  estimateBytes?: number | null;
  /**
   * The most every stream of this download together (the cover included) may receive, the bytes
   * counted as they arrive: past it the download stops with `StreamTooLargeError`. None = no limit.
   */
  fetchLimit?: FetchLimit;
  onProgress?: (sample: YtdlProgressSample) => void;
  /** Fetching is done and FFmpeg is putting the file together. */
  onPostprocess?: () => void;
  onLog?: (line: string) => void;
}

export interface StreamDownloadDeps {
  mux: StreamMuxDeps;
  extractMp3: typeof extractMp3;
  probe: (file: string) => Promise<MediaProbe | null>;
  /** The wait before a segment's retry (attempt × this). */
  retryDelayMs: number;
}

const defaultDeps: StreamDownloadDeps = { mux: defaultMuxDeps, extractMp3, probe: probeMedia, retryDelayMs: 1_000 };

function check(request: StreamDownloadRequest): void {
  if (request.output === 'mp4' && !request.video) throw new MuxError('an MP4 needs a video stream');
  if (request.output !== 'mp4' && !request.audio && !request.video) throw new MuxError('an audio file needs a stream with sound');
  if (request.output === 'mp3' && !request.mp3) throw new MuxError('an MP3 needs its bitrate and tags');
}

function totalOf(request: StreamDownloadRequest): number | null {
  if (request.estimateBytes !== undefined && request.estimateBytes !== null) return request.estimateBytes;
  const plans = [request.video, request.audio].filter((p): p is SegmentPlan => p !== undefined);
  const sizes = plans.map(planExactBytes);
  return sizes.every((s): s is number => s !== null) ? sizes.reduce((a, b) => a + b, 0) : null;
}

/** The cover for the MP3, fetched like a stream; none when it cannot be had (Stop still stops). */
async function fetchCover(request: StreamDownloadRequest, deps: StreamDownloadDeps, budget: ByteBudget | undefined): Promise<string | undefined> {
  const url = request.mp3?.coverUrl;
  if (!url) return undefined;
  const file = path.join(request.jobDir, 'cover');
  try {
    await fetchPlanToFile(progressivePlan(url), file, {
      ...request.request, label: request.label, retries: 1, retryDelayMs: deps.retryDelayMs, ...(budget ? { budget } : {}),
    });
    return file;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    if (budget?.overrun()) throw err;
    request.onLog?.(`[${request.label}] no cover for the MP3: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** The file the person gets, made from the fetched streams; returns its path. */
async function makeFile(
  request: StreamDownloadRequest,
  streams: { video?: string; audio?: string },
  deps: StreamDownloadDeps,
  budget: ByteBudget | undefined,
): Promise<string> {
  const signal = request.request.signal;
  const output = path.join(request.jobDir, `media.${request.output}`);
  if (request.output === 'mp4') {
    await muxStreams('mp4', streams, output, signal, deps.mux);
  } else if (request.output === 'm4a') {
    await muxStreams('m4a', { audio: streams.audio ?? streams.video }, output, signal, deps.mux);
  } else {
    const mp3 = request.mp3 as NonNullable<StreamDownloadRequest['mp3']>;
    const cover = await fetchCover(request, deps, budget);
    await deps.extractMp3(streams.audio ?? streams.video ?? '', output, mp3.bitrateKbps, {
      title: mp3.title, artist: mp3.artist, ...(cover ? { cover } : {}),
    }, signal);
  }
  return output;
}

/** What the file must hold: a picture for an MP4 (its sound when a separate one was fetched), sound for the others. */
function complete(request: StreamDownloadRequest, probe: MediaProbe): boolean {
  if (request.output !== 'mp4') return probe.hasAudio;
  return probe.hasVideo && (!request.audio || probe.hasAudio);
}

/**
 * Downloads and puts together one file in `jobDir`. Throws the stream errors (`StreamHttpError`,
 * `StreamRefusedError`, `MuxError`, `AudioExtractError`…) for `streamFailure` to word,
 * `StreamTooLargeError` past `fetchLimit` (the caller words it: it knows whose limit it was), and an
 * error named AbortError on Stop.
 */
export async function downloadStreams(request: StreamDownloadRequest, deps: StreamDownloadDeps = defaultDeps): Promise<YtdlpDownloadResult> {
  check(request);
  const total = totalOf(request);
  let downloaded = 0;
  const onBytes = (added: number): void => {
    downloaded += added;
    request.onProgress?.({ downloadedBytes: downloaded, totalBytes: total });
  };
  // One budget for the whole download: the video, its separate sound and the cover count together.
  const budget = request.fetchLimit ? byteBudget(request.fetchLimit) : undefined;
  const options = {
    ...request.request, label: request.label, onBytes, retryDelayMs: deps.retryDelayMs,
    ...(request.concurrency ? { concurrency: request.concurrency } : {}),
    ...(budget ? { budget } : {}),
  };
  const scratch: string[] = [];
  let output: string | null = null;
  try {
    const streams: { video?: string; audio?: string } = {};
    for (const kind of ['video', 'audio'] as const) {
      const plan = request[kind];
      if (!plan) continue;
      const file = path.join(request.jobDir, `stream-${kind}`);
      scratch.push(file);
      await fetchPlanToFile(plan, file, options);
      streams[kind] = file;
    }
    request.onPostprocess?.();
    scratch.push(path.join(request.jobDir, 'cover'));
    output = await makeFile(request, streams, deps, budget);
    const stat = await fs.stat(output);
    const probe = await deps.probe(output);
    if (!probe) throw new MuxError('could not read the finished file');
    if (!complete(request, probe)) throw new MuxError('incomplete media');
    request.onLog?.(`[${request.label}] put together ${path.basename(output)} (${stat.size} bytes)`);
    return { filePath: output, sizeBytes: stat.size, probe };
  } catch (err) {
    if (output) await fs.rm(output, { force: true }).catch(() => {});
    throw err;
  } finally {
    await Promise.all(scratch.map((file) => fs.rm(file, { force: true }).catch(() => {})));
  }
}

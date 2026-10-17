import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fetchLimitFor, streamCapBytes } from '../../downloader/fetchLimits';
import { downloadStreams } from '../../downloader/streamDownload';
import { streamFailure } from '../../downloader/streamFailure';
import { hostAllowlist } from '../../downloader/streamFetch';
import { StreamTooLargeError } from '../../downloader/streamTypes';
import { YtdlError } from '../../youtubeDownload/ytdlErrors';
import { formatMegabytes } from '../../../shared/ytdl';
import { FlowUserError } from '../userError';
import { FAILURE_KEYS } from './ytdl';
import type { PostStream } from './xPosts';

/*
 * A post's video that comes as separate picture and sound streams (Reddit's v.redd.it DASH, when
 * the page offers no ready mp4): fetched with the segmented-stream downloader and copied into one
 * mp4 by FFmpeg (`downloadStreams`), so the forward, the desktop chat and the MP3 handle it as
 * the single file any other post's video is. FFmpeg comes with the download tools: without them
 * the person reads the same notice a video's download gives.
 */

/** A post's media stopped before it filled the disk: the words a video's download uses for a full disk. */
export function diskFullError(site: string, detail: string): FlowUserError {
  return new FlowUserError(FAILURE_KEYS.disk, { site }, `Stopped before filling the disk: ${detail}`);
}

/** A file over the chat's limit: the same plain error a single file's download throws. */
function overLimitError(limitBytes: number): Error {
  return new Error(`over ${formatMegabytes(limitBytes)}`);
}

/** A stream failure in the words a video's download uses, naming the site. */
function postStreamError(err: unknown, site: string, limitBytes: number | null): unknown {
  const failure = streamFailure(err, site);
  if (failure instanceof StreamTooLargeError) {
    if (failure.disk || limitBytes === null) return diskFullError(site, failure.message);
    return overLimitError(limitBytes);
  }
  if (!(failure instanceof YtdlError)) return failure;
  return new FlowUserError(FAILURE_KEYS[failure.category], { site }, failure.message);
}

/**
 * Fetches the streams, puts them into `file` (an mp4) and returns its size. Over `limitBytes`
 * (when given) the file is deleted and the download fails, as a single file's would: the streams
 * stop as soon as they bring in more than that (with `STREAM_SLACK`) or than the disk can take,
 * and the finished file is checked against the limit itself. The streams are fetched in a scratch
 * folder beside `file`, removed whatever happens; a Stop throws an error named AbortError.
 */
export async function fetchPostStream(stream: PostStream, file: string, limitBytes: number | null, signal: AbortSignal | undefined): Promise<number> {
  const scratch = path.join(path.dirname(file), `.stream-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });
  try {
    const fetchLimit = await fetchLimitFor(scratch, limitBytes === null ? null : streamCapBytes(limitBytes));
    let made: { filePath: string; sizeBytes: number };
    try {
      made = await downloadStreams({
        label: stream.site,
        jobDir: scratch,
        video: stream.video,
        ...(stream.audio ? { audio: stream.audio } : {}),
        output: 'mp4',
        request: { isAllowedHost: hostAllowlist(stream.hosts), ...(signal ? { signal } : {}) },
        ...(fetchLimit ? { fetchLimit } : {}),
      });
    } catch (err) {
      throw postStreamError(err, stream.site, limitBytes);
    }
    if (limitBytes !== null && made.sizeBytes > limitBytes) throw overLimitError(limitBytes);
    await fs.rename(made.filePath, file);
    return made.sizeBytes;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

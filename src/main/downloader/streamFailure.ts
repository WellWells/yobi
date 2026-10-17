import type { YtdlFailureCategory } from '../../shared/ytdl';
import { FlowUserError } from '../flow/userError';
import { YtdlError, ytdlFailureMessage } from '../youtubeDownload/ytdlErrors';
import { AudioExtractError } from './extractAudio';
import { MuxError } from './streamMux';
import { ProtectedStreamError, StreamFormatError, StreamHttpError, StreamRefusedError, StreamTooLargeError } from './streamTypes';

/*
 * A segmented download's failure in the words the yt-dlp path already has: a `YtdlError` whose
 * category `youtube_download` turns into the same `flow.error.ytdl*` sentence with the site's
 * name, or the `FlowUserError` the person can act on (DRM, tools missing). A site runs its `info`
 * reads through it too, so a protected video is refused before the menu.
 */

/** Statuses a CDN answers when it will not serve this client right now (expired signature, rate limit). */
const REFUSED_STATUSES = new Set([401, 403, 429]);
const GONE_STATUSES = new Set([404, 410]);

function httpCategory(err: StreamHttpError): YtdlFailureCategory {
  if (REFUSED_STATUSES.has(err.status)) return 'blocked';
  if (GONE_STATUSES.has(err.status)) return 'restricted';
  if (err.status === 0 || err.status === 408 || err.status >= 500) return 'network';
  return 'other';
}

function category(err: unknown): YtdlFailureCategory {
  if (err instanceof StreamHttpError) return httpCategory(err);
  if (err instanceof StreamFormatError) return err.live ? 'live' : 'other';
  if (err instanceof StreamRefusedError || err instanceof MuxError || err instanceof AudioExtractError) return 'other';
  if ((err as NodeJS.ErrnoException | null)?.code === 'ENOSPC') return 'disk';
  // Node's fetch rejects a dropped connection or a failed lookup as a TypeError ("fetch failed").
  if (err instanceof TypeError) return 'network';
  return 'other';
}

/**
 * `err` as `youtube_download` reports it for `site` (its label): a Stop, a `FlowUserError`, a
 * `YtdlError` and a `StreamTooLargeError` pass through; a protected stream is `flow.error.videoDrm`; FFmpeg missing is
 * `flow.error.ytdlToolsMissing`; everything else a `YtdlError` of the matching category, whose
 * message keeps the original reason for the log.
 */
export function streamFailure(err: unknown, site: string): unknown {
  if (err instanceof Error && err.name === 'AbortError') return err;
  // A passed fetch limit is worded by the caller, which knows whether it was the person's cap or the disk.
  if (err instanceof FlowUserError || err instanceof YtdlError || err instanceof StreamTooLargeError) return err;
  if (err instanceof ProtectedStreamError) {
    return new FlowUserError('flow.error.videoDrm', { site }, `${site} protects this video (${err.scheme}); it cannot be downloaded`);
  }
  const toolsMissing = (err instanceof MuxError && err.toolsMissing) || (err instanceof AudioExtractError && /not installed/.test(err.message));
  if (toolsMissing) return new FlowUserError('flow.error.ytdlToolsMissing', {}, 'The video download tools are not installed');
  const kind = category(err);
  const reason = err instanceof Error ? err.message : String(err);
  return new YtdlError(kind, `${ytdlFailureMessage(kind, site)} (${reason})`);
}

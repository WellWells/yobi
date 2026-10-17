import type { YtdlDestination } from '../../shared/ytdl';
import { downloadVideo, setDownloadVideoDeps } from '../downloader/downloadVideo';
import { setYtdlpInvokeDeps } from '../downloader/ytdlpInvoke';
import type { YtdlpDownloadResult, YtdlpInvokeDeps } from '../downloader/ytdlpInvoke';
import type { YtdlUpdateResult } from './toolInstaller';
import { youtubeSiteArgs } from './ytdlArgs';
import type { YtdlProgressLine } from './ytdlArgs';

export { probeMedia } from '../downloader/ytdlpInvoke';
export type { MediaProbe } from '../downloader/ytdlpInvoke';

/*
 * Runs one YouTube download with the active tools: YouTube's options handed to the site-neutral
 * `downloader/downloadVideo.ts`, which owns the one-at-a-time slot, the network retry and the
 * newer-yt-dlp check that pauses YouTube downloads (`youtubeChangedAt`) when none exists. Running
 * yt-dlp itself (environment, JS runtime, proxy, output checks) is `downloader/ytdlpInvoke.ts`.
 */

export interface YtdlRunnerDeps extends YtdlpInvokeDeps {
  checkUpdate: (options: { force?: boolean }) => Promise<YtdlUpdateResult>;
}

/** Also sets the yt-dlp runner's own deps (spawn, proxy, JS runtime, log); null resets both. */
export function setYtdlRunnerDeps(partial: Partial<YtdlRunnerDeps> | null): void {
  if (!partial) {
    setDownloadVideoDeps(null);
    setYtdlpInvokeDeps(null);
    return;
  }
  const { checkUpdate, ...invoke } = partial;
  setDownloadVideoDeps({
    ...(checkUpdate ? { checkUpdate } : {}),
    ...(invoke.log ? { log: invoke.log } : {}),
  });
  setYtdlpInvokeDeps(invoke);
}

interface YtdlDownloadOptions {
  /** The canonical watch URL. */
  url: string;
  quality: number | 'best';
  destination: YtdlDestination;
  jobDir: string;
  signal?: AbortSignal;
  onProgress?: (progress: YtdlProgressLine) => void;
  /** The download is done and FFmpeg is merging or fixing up the file. */
  onPostprocess?: () => void;
  onLog?: (line: string) => void;
}

export type YtdlDownloadResult = YtdlpDownloadResult;

/**
 * Downloads one video into `jobDir` and checks it has both picture and sound. Throws `YtdlError`
 * (with the category deciding the message) or, when `signal` aborts, an error named AbortError.
 */
export function downloadYoutubeVideo(options: YtdlDownloadOptions): Promise<YtdlDownloadResult> {
  return downloadVideo('youtube', {
    url: options.url,
    siteArgs: () => youtubeSiteArgs(options.url, options.quality, options.destination),
    jobDir: options.jobDir,
    signal: options.signal,
    onProgress: options.onProgress,
    onPostprocess: options.onPostprocess,
    onLog: options.onLog,
  });
}

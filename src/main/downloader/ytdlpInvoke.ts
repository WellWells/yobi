import { session } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { YtdlFailureCategory } from '../../shared/ytdl';
import { Semaphore } from '../flow/lanes';
import { sendLog } from '../helpers';
import { isInsideDir } from '../youtubeDownload/paths';
import { spawnTool, toolEnv } from '../youtubeDownload/processTree';
import type { ToolResult } from '../youtubeDownload/processTree';
import { resolveYtdlTools } from '../youtubeDownload/toolState';
import { YtdlError, classifyYtdlFailure, maskYtdlStderr, ytdlFailureMessage } from '../youtubeDownload/ytdlErrors';
import { ensureFaststart } from './faststart';
import { withCookieFile } from './siteCookies';
import type { CookieSource } from './siteCookies';
import {
  assertYtdlpUrl, checkedSiteArgs, isPostprocessStartLine, parseProgressLine, printedPath, proxyFromPac,
  ytdlpDownloadArgs, ytdlpJsonArgs,
} from './ytdlpArgs';
import type { YtdlProgressLine } from './ytdlpArgs';

/*
 * Running yt-dlp, whatever the site: a whitelisted environment, Yobi itself as the JS runtime,
 * the system proxy, the site's cookies in a file of the call's own, the whole process tree
 * stopped on abort, the finished file checked to be inside the job folder and to hold picture and
 * sound, one download at a time and two reads at a time app-wide.
 * What a failure leads to (retries, a newer yt-dlp, pausing a site's downloads) is
 * `downloadVideo.ts`, with each site's own hooks.
 */

export interface MediaProbe {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  /** ffprobe's names for the first video and audio codec (`h264`, `hevc`, `aac`), when there is one. */
  videoCodec?: string;
  audioCodec?: string;
  /** The file's own title and artist tags (an MP3's, written by `--embed-metadata`), when it has them. */
  title?: string;
  artist?: string;
}

export interface YtdlpInvokeDeps {
  spawn: typeof spawnTool;
  resolveProxy: (url: string) => Promise<string | undefined>;
  /** The JS runtime handed to yt-dlp; Yobi's own executable run as Node. */
  nodePath: string;
  log: (message: string) => void;
}

async function electronResolveProxy(url: string): Promise<string | undefined> {
  try {
    return proxyFromPac(await session.defaultSession.resolveProxy(url));
  } catch {
    return undefined;
  }
}

function defaultDeps(): YtdlpInvokeDeps {
  return { spawn: spawnTool, resolveProxy: electronResolveProxy, nodePath: process.execPath, log: sendLog };
}

let deps: YtdlpInvokeDeps = defaultDeps();

export function setYtdlpInvokeDeps(partial: Partial<YtdlpInvokeDeps> | null): void {
  deps = partial ? { ...defaultDeps(), ...partial } : defaultDeps();
}

/** A stuck yt-dlp is stopped even if the caller never aborts; flows abort far sooner. */
const SAFETY_TIMEOUT_MS = 3 * 60 * 60_000;
const PROBE_TIMEOUT_MS = 60_000;
const OUTPUT_CAP_BYTES = 512_000;
const JSON_TIMEOUT_MS = 90_000;
const JSON_OUTPUT_CAP_BYTES = 16_000_000;

/**
 * The child gets the whitelisted environment plus the Node switch (without it, yt-dlp running
 * `Yobi --version` would start a second Yobi) and UTF-8 output, so a non-ASCII user folder in the
 * printed path survives Windows' ANSI code page.
 */
function ytdlpEnv(): Record<string, string> {
  return toolEnv({ ELECTRON_RUN_AS_NODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
}

export function parseProbeJson(text: string): MediaProbe | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as { streams?: unknown; format?: { duration?: unknown; tags?: Record<string, unknown> } };
  const streams = Array.isArray(record.streams) ? record.streams as Array<Record<string, unknown>> : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
  const duration = Number(record.format?.duration);
  const tag = (name: string): string => {
    const value = record.format?.tags?.[name];
    return typeof value === 'string' ? value.trim() : '';
  };
  const title = tag('title');
  const artist = tag('artist');
  const codec = (stream: Record<string, unknown> | undefined): string => (typeof stream?.codec_name === 'string' ? stream.codec_name : '');
  const videoCodec = codec(video);
  const audioCodec = codec(audio);
  return {
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: int(video?.width),
    height: int(video?.height),
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  };
}

/** What ffprobe says about a media file; null when the tools are missing or ffprobe fails. */
export async function probeMedia(filePath: string): Promise<MediaProbe | null> {
  const tools = await resolveYtdlTools();
  if (!tools) return null;
  try {
    const result = await deps.spawn(tools.ffprobe, [
      '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration:format_tags=title,artist', '-of', 'json', filePath,
    ], { env: toolEnv(), timeoutMs: PROBE_TIMEOUT_MS, maxOutputBytes: OUTPUT_CAP_BYTES });
    return result.code === 0 ? parseProbeJson(result.stdout) : null;
  } catch {
    return null;
  }
}

/**
 * What a Stop throws, a download and a read alike: an error named AbortError, its message naming
 * the site (`YouTube download stopped`, `Instagram read stopped`).
 */
function ytdlpAbortError(label: string, what: 'download' | 'read' = 'download'): Error {
  const err = new Error(`${label} ${what} stopped`);
  err.name = 'AbortError';
  return err;
}

const downloadSlot = new Semaphore(1);
/** yt-dlp reads that download nothing (a site's probe); a few at once, never a crowd of them. */
const probeSlot = new Semaphore(2);

/**
 * Runs `run` holding the app-wide download slot: a second download waits its turn, and a Stop
 * while waiting throws AbortError without ever starting yt-dlp.
 */
export async function withDownloadSlot<T>(label: string, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (downloadSlot.busy) deps.log('[Ytdl] another download is running; this one waits');
  try {
    await downloadSlot.acquire(signal);
  } catch {
    throw ytdlpAbortError(label);
  }
  try {
    if (signal?.aborted) throw ytdlpAbortError(label);
    return await run();
  } finally {
    downloadSlot.release();
  }
}

async function finishedFile(printed: string, jobDir: string): Promise<{ filePath: string; sizeBytes: number }> {
  if (!printed) throw new YtdlError('other', 'yt-dlp finished without naming the file');
  const filePath = path.resolve(jobDir, printed);
  if (filePath === path.resolve(jobDir) || !isInsideDir(jobDir, filePath)) {
    throw new YtdlError('other', 'yt-dlp wrote outside the job folder');
  }
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) throw new YtdlError('other', 'the downloaded file is missing or empty');
  return { filePath, sizeBytes: stat.size };
}

export interface YtdlpDownloadRun {
  /** The site's name for messages and logs (`YouTube`). */
  label: string;
  /** A URL the site rebuilt from its own whitelist; never text a user typed. */
  url: string;
  /**
   * The site's own options (format selector, merge format), built once the tools are known; it
   * throws for input the site does not take.
   */
  siteArgs: () => readonly string[];
  jobDir: string;
  /**
   * The sound alone (the menu's MP3): the file only needs audio. Its embedded cover reads as a
   * video stream, so the picture is not looked at either way.
   */
  audioOnly?: boolean;
  /** The site's cookies, written into `jobDir` for this call and deleted after it. */
  cookies?: CookieSource;
  signal?: AbortSignal;
  onProgress?: (progress: YtdlProgressLine) => void;
  /** The download is done and FFmpeg is merging or fixing up the file. */
  onPostprocess?: () => void;
  /** Each stderr line as it comes, masked by `mask`. */
  onLog?: (line: string) => void;
  /** Reads why yt-dlp failed from its stderr and exit code; YouTube's reading by default. */
  classify?: (stderr: string, exitCode: number | null) => YtdlFailureCategory;
  /** Stderr (its end, or one live line) made safe for the log; every URL's query cut by default. */
  mask?: (stderr: string) => string;
}

export interface YtdlpDownloadResult {
  filePath: string;
  sizeBytes: number;
  probe: MediaProbe;
}

/**
 * One yt-dlp download into `jobDir`, checked to have both picture and sound. Throws `YtdlError`
 * (its category read from stderr) or, when `signal` aborts, an error named AbortError. Callers
 * hold the download slot (`withDownloadSlot`) around their retries.
 */
export async function runYtdlpDownload(run: YtdlpDownloadRun): Promise<YtdlpDownloadResult> {
  const tools = await resolveYtdlTools();
  if (!tools) throw new YtdlError('other', 'tools not ready');
  // The site checks its URL and options before anything else is asked of the system.
  const siteArgs = run.siteArgs();
  const proxy = await deps.resolveProxy(run.url);
  const result = await withCookieFile(run.cookies, run.url, run.jobDir, (cookieFile) => deps.spawn(tools.ytdlp, ytdlpDownloadArgs({
    url: run.url,
    siteArgs,
    ffmpegDir: tools.ffmpegDir,
    nodePath: deps.nodePath,
    outputTemplate: path.join(run.jobDir, 'media.%(ext)s'),
    proxy,
    cookieFile,
  }), {
    env: ytdlpEnv(),
    cwd: run.jobDir,
    signal: run.signal,
    timeoutMs: SAFETY_TIMEOUT_MS,
    maxOutputBytes: OUTPUT_CAP_BYTES,
    onLine: (line, stream) => {
      const progress = parseProgressLine(line);
      if (progress) {
        run.onProgress?.(progress);
        return;
      }
      if (isPostprocessStartLine(line)) {
        run.onPostprocess?.();
        return;
      }
      // Live lines reach the log too, so they are masked as the failure's tail is.
      if (stream === 'stderr' && line.trim()) run.onLog?.((run.mask ?? maskYtdlStderr)(line));
    },
  }));
  if (result.aborted || run.signal?.aborted) throw ytdlpAbortError(run.label);
  if (result.timedOut) throw new YtdlError('other', 'yt-dlp timed out');
  if (result.code !== 0) {
    const stderrTail = (run.mask ?? maskYtdlStderr)(result.stderr);
    const category = (run.classify ?? classifyYtdlFailure)(result.stderr, result.code);
    throw new YtdlError(category, ytdlFailureMessage(category, run.label), stderrTail);
  }
  const file = await finishedFile(printedPath(result.stdout), run.jobDir);
  // yt-dlp's own FFmpeg runs write `+faststart`; a single file it did not merge is the site's as sent.
  try {
    const mux = { spawn: deps.spawn, ffmpeg: async () => tools.ffmpeg };
    if (await ensureFaststart(file.filePath, run.signal, mux, deps.log)) file.sizeBytes = (await fs.stat(file.filePath)).size;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw ytdlpAbortError(run.label);
    throw err;
  }
  const probe = await probeMedia(file.filePath);
  if (!probe) throw new YtdlError('other', 'could not read the downloaded file');
  if (!probe.hasAudio || (!run.audioOnly && !probe.hasVideo)) throw new YtdlError('other', 'incomplete media');
  return { ...file, probe };
}

export interface YtdlpJsonRun {
  /** The site's name for messages (`Instagram`). */
  label: string;
  /** A URL the site rebuilt from its own whitelist; never text a user typed. */
  url: string;
  /** The site's own options, e.g. `--skip-download --dump-single-json`. */
  siteArgs: readonly string[];
  /** A folder of the run's own (the job folder); the cookie file lives there, so `cookies` needs it. */
  cwd?: string;
  /** The site's cookies, written into `cwd` for this call and deleted after it. */
  cookies?: CookieSource;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * A yt-dlp read that downloads nothing (a probe, a JSON dump): the same environment, JS runtime,
 * proxy and cookie handling as a download, in the probe slot rather than the download slot. Null
 * when the tools are not installed; throws an error named AbortError when stopped (waiting for a
 * slot included), as a download does. The caller reads `code`, `stdout` and `stderr`.
 */
export async function runYtdlpJson(run: YtdlpJsonRun): Promise<ToolResult | null> {
  const tools = await resolveYtdlTools();
  if (!tools) return null;
  // The URL and the site's options are checked before anything else is asked of the system.
  assertYtdlpUrl(run.url);
  checkedSiteArgs(run.siteArgs);
  if (run.cookies && !run.cwd) throw new Error('a yt-dlp read with cookies needs a folder of its own');
  try {
    await probeSlot.acquire(run.signal);
  } catch {
    throw ytdlpAbortError(run.label, 'read');
  }
  try {
    if (run.signal?.aborted) throw ytdlpAbortError(run.label, 'read');
    const proxy = await deps.resolveProxy(run.url);
    const result = await withCookieFile(run.cookies, run.url, run.cwd ?? '', (cookieFile) => deps.spawn(tools.ytdlp, ytdlpJsonArgs({
      url: run.url,
      siteArgs: run.siteArgs,
      nodePath: deps.nodePath,
      proxy,
      cookieFile,
    }), {
      env: ytdlpEnv(),
      ...(run.cwd ? { cwd: run.cwd } : {}),
      ...(run.signal ? { signal: run.signal } : {}),
      timeoutMs: run.timeoutMs ?? JSON_TIMEOUT_MS,
      maxOutputBytes: run.maxOutputBytes ?? JSON_OUTPUT_CAP_BYTES,
    }));
    if (result.aborted || run.signal?.aborted) throw ytdlpAbortError(run.label, 'read');
    return result;
  } finally {
    probeSlot.release();
  }
}

/*
 * The site-neutral part of every yt-dlp command line. Each site adds only its own options (a
 * format selector, a merge format) as code constants; the URL always comes last, after `--`, so
 * it can never be read as an option. No text a user or a bot message typed becomes an argument:
 * the URL is one Yobi rebuilt from a whitelist, and the rest are Yobi's own values and paths.
 */

export const PROGRESS_PREFIX = '[ytdl]';
const POSTPROCESS_TAG = 'pp';

/** Config files and plugins next to yt-dlp or in the user's folders could add any option. */
export const YTDLP_SAFETY_ARGS: readonly string[] = ['--ignore-config', '--no-plugin-dirs'];

/**
 * The JS runtime yt-dlp runs a site's player code with: Yobi's own executable as Node.
 * `--js-runtimes` appends to the default (deno); clearing first keeps a Deno on PATH out of it.
 */
export function jsRuntimeArgs(nodePath: string): string[] {
  return ['--no-js-runtimes', '--js-runtimes', `node:${nodePath}`];
}

/**
 * The URL handed to yt-dlp: https, already in the form the URL parser writes it, so it holds no
 * space, quote or line break, and it cannot start with `-`. Each site checks its own shape first.
 */
export function assertYtdlpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('yt-dlp only takes an https link');
  }
  if (parsed.protocol !== 'https:' || parsed.href !== url) throw new Error('yt-dlp only takes a rebuilt https link');
}

/**
 * What every site adds after its own audio format selector for the menu's MP3: the sound converted
 * at `bitrateKbps`, with the title and channel written in and the cover embedded (as a JPEG, which
 * every player reads), so a phone's player shows what it is.
 */
export function mp3Args(bitrateKbps: number): string[] {
  if (!Number.isInteger(bitrateKbps) || bitrateKbps < 32 || bitrateKbps > 320) throw new Error(`invalid MP3 bitrate ${bitrateKbps}`);
  return [
    '-x', '--audio-format', 'mp3', '--audio-quality', `${bitrateKbps}K`,
    '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
  ];
}

/** Cookies reach yt-dlp only as the file written for the call (`siteCookies.ts`), never as a site option. */
const COOKIE_OPTIONS: readonly string[] = ['--cookies', '--cookies-from-browser'];

/**
 * A site's own options never hold the `--` that ends them, so the URL stays the only positional,
 * nor a cookie option of their own.
 */
export function checkedSiteArgs(siteArgs: readonly string[]): readonly string[] {
  if (siteArgs.includes('--')) throw new Error('site options must not end the option list');
  if (siteArgs.some((arg) => COOKIE_OPTIONS.includes(arg.split('=')[0]))) throw new Error('site options must not name a cookie source');
  return siteArgs;
}

/** The call's own cookie file, when the site hands its cookies over. */
function cookieArgs(cookieFile: string | undefined): string[] {
  return cookieFile ? ['--cookies', cookieFile] : [];
}

export interface YtdlpDownloadArgsInput {
  url: string;
  /** The site's own options, e.g. `-f <selector> --merge-output-format mp4`. */
  siteArgs: readonly string[];
  ffmpegDir: string;
  nodePath: string;
  outputTemplate: string;
  proxy?: string;
  cookieFile?: string;
}

/** One download: progress lines Yobi parses, the final path printed, the URL after `--`. */
export function ytdlpDownloadArgs(input: YtdlpDownloadArgsInput): string[] {
  assertYtdlpUrl(input.url);
  return [
    ...YTDLP_SAFETY_ARGS,
    '--no-playlist',
    '--no-mtime',
    '--no-part',
    // `--print` implies --quiet, which hides progress unless asked for.
    '--progress',
    '--newline',
    '--progress-template',
    `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
    // FFmpeg merging the streams (seconds for a long video): the chat says so instead of sitting at 99%.
    '--progress-template',
    `postprocess:${PROGRESS_PREFIX} ${POSTPROCESS_TAG} %(progress.status)s %(progress.postprocessor)s`,
    ...jsRuntimeArgs(input.nodePath),
    '--ffmpeg-location',
    input.ffmpegDir,
    ...(input.proxy ? ['--proxy', input.proxy] : []),
    ...cookieArgs(input.cookieFile),
    ...checkedSiteArgs(input.siteArgs),
    '-o',
    input.outputTemplate,
    '--print',
    'after_move:filepath',
    '--',
    input.url,
  ];
}

export interface YtdlpJsonArgsInput {
  url: string;
  /** The site's own options, e.g. `--skip-download --dump-single-json`. */
  siteArgs: readonly string[];
  nodePath: string;
  proxy?: string;
  cookieFile?: string;
}

/** A read without a download; the JS runtime is pinned here, not by each site. */
export function ytdlpJsonArgs(input: YtdlpJsonArgsInput): string[] {
  assertYtdlpUrl(input.url);
  return [
    ...YTDLP_SAFETY_ARGS,
    ...jsRuntimeArgs(input.nodePath),
    ...(input.proxy ? ['--proxy', input.proxy] : []),
    ...cookieArgs(input.cookieFile),
    ...checkedSiteArgs(input.siteArgs),
    '--',
    input.url,
  ];
}

/**
 * Chromium's proxy answer (`PROXY host:port; DIRECT`) as a URL yt-dlp takes; the first entry
 * decides. DIRECT or anything unreadable means no proxy.
 */
export function proxyFromPac(pac: string): string | undefined {
  const first = pac.split(';')[0]?.trim() ?? '';
  const match = /^(PROXY|HTTPS|SOCKS5|SOCKS4|SOCKS)\s+([\w.\-[\]:]+)$/i.exec(first);
  if (!match) return undefined;
  const scheme = { PROXY: 'http', HTTPS: 'https', SOCKS5: 'socks5', SOCKS4: 'socks4', SOCKS: 'socks4' }[match[1].toUpperCase()];
  return scheme ? `${scheme}://${match[2]}` : undefined;
}

export interface YtdlProgressLine {
  downloadedBytes: number;
  totalBytes: number | null;
}

/** A post-processor (`Merger`, `FixupM4a`…) starting: `[ytdl] pp started Merger`. */
export function isPostprocessStartLine(line: string): boolean {
  return line.trim().startsWith(`${PROGRESS_PREFIX} ${POSTPROCESS_TAG} started `);
}

/** One `--progress-template` line; `NA` totals become null. */
export function parseProgressLine(line: string): YtdlProgressLine | null {
  const match = /^\[ytdl\] (\S+) (\S+) (\S+)/.exec(line.trim());
  if (!match) return null;
  const num = (text: string): number | null => {
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const downloaded = num(match[1]);
  if (downloaded === null) return null;
  return { downloadedBytes: downloaded, totalBytes: num(match[2]) ?? num(match[3]) };
}

/** The `--print after_move:filepath` line: the last stdout line that is not progress. */
export function printedPath(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith(PROGRESS_PREFIX));
  return lines.at(-1) ?? '';
}

import type { YtdlFailureCategory } from '../../shared/ytdl';

/*
 * Reads why yt-dlp failed from its stderr. Order matters: a firewall or a full disk shows up
 * inside messages that otherwise look like network or extraction errors, and an age gate says
 * "Sign in to confirm your age", which the bot check's "Sign in to confirm you" also matches.
 */

export type YtdlFailureRule = readonly [YtdlFailureCategory, RegExp];

/** Checked first, whatever the site: these hide inside messages that look like any other failure. */
const MACHINE_RULES: readonly YtdlFailureRule[] = [
  // A firewall that blocks yt-dlp.exe alone shows up as WinError 10013.
  ['firewall', /WinError 10013|An attempt was made to access a socket in a way forbidden|嘗試存取通訊端被拒絕|以一种访问权限不允许的方式做了一个访问套接字的尝试|urlopen error \[Errno 13\]|\[Errno 13\][^\n]*(?:connect|socket)/i],
  ['disk', /No space left on device|ENOSPC|There is not enough space|\[Errno 28\]/i],
];

const RULES: readonly YtdlFailureRule[] = [
  ['live', /This live event will begin|\bis (?:currently )?live\b|Premieres in/i],
  ['restricted', /members-only|Join this channel|confirm your age|age[- ]restricted|available in your country|Private video/i],
  ['blocked', /HTTP Error 403|Sign in to confirm you|not a bot|HTTP Error 429/i],
  ['restricted', /Video unavailable/i],
  // yt-dlp routinely sees fewer formats than the watch page lists; that is about one quality and
  // must not pause every download the way a broken extractor does.
  ['formatMissing', /Requested format is not available/i],
  ['youtubeChanged', /Unable to extract|nsig extraction failed|Signature extraction failed|Failed to extract any player response/i],
  ['network', /timed out|Connection reset|Connection refused|getaddrinfo|Temporary failure in name resolution|Network is unreachable|Unable to download webpage|Remote end closed connection|IncompleteRead/i],
];

/**
 * The lines yt-dlp prints as `ERROR:` decide when there are any: warnings such as a failed n
 * challenge show up on downloads that then fail for an unrelated reason.
 */
function decisiveText(stderr: string): string {
  const errors = stderr.split(/\r?\n/).filter((line) => /^\s*ERROR:/.test(line));
  return errors.length > 0 ? errors.join('\n') : stderr;
}

/**
 * Why yt-dlp failed. `siteRules` are a site's own readings, checked after the firewall and disk
 * and before the shared ones (YouTube has none).
 */
export function classifyYtdlFailure(
  stderr: string,
  exitCode: number | null,
  siteRules: readonly YtdlFailureRule[] = [],
): YtdlFailureCategory {
  if (exitCode === 0) return 'other';
  const text = decisiveText(stderr);
  for (const [category, pattern] of [...MACHINE_RULES, ...siteRules, ...RULES]) {
    if (pattern.test(text)) return category;
  }
  return 'other';
}

/**
 * A site that turns yt-dlp away with HTTP 412 until a browser passes its script check (bilibili):
 * `blocked`, which that site answers with a fresh token and one retry. YouTube does not read 412
 * this way.
 */
export const HTTP_412_BLOCKED: YtdlFailureRule = ['blocked', /HTTP Error 412/i];

export function classifySiteCheckFailure(stderr: string, exitCode: number | null): YtdlFailureCategory {
  return classifyYtdlFailure(stderr, exitCode, [HTTP_412_BLOCKED]);
}

const STDERR_TAIL_MAX = 2_000;

/**
 * The end of stderr, safe for the log: media URLs carry signed query strings, so the query of
 * every http(s) URL is cut, whatever the host.
 */
export function maskYtdlStderr(stderr: string): string {
  const masked = stderr.replace(/(https?:\/\/[^\s?#"'<>]*)\?[^\s"'<>]*/gi, '$1?…');
  return masked.length > STDERR_TAIL_MAX ? masked.slice(-STDERR_TAIL_MAX) : masked;
}

const FAILURE_MESSAGES: Record<YtdlFailureCategory, (site: string) => string> = {
  youtubeChanged: (site) => `yt-dlp could not read ${site}; a newer yt-dlp is needed`,
  formatMissing: () => 'yt-dlp was not offered the requested quality',
  blocked: (site) => `${site} refused the download (bot check or rate limit)`,
  restricted: () => 'the video is private, members-only, age-restricted or not available here',
  live: () => 'the video is a live stream or premiere that has not ended',
  network: (site) => `the network connection to ${site} failed`,
  firewall: () => 'a firewall blocked yt-dlp from connecting',
  disk: () => 'the disk is full',
  other: () => 'yt-dlp failed',
};

/**
 * English, for logs and the error's own text (what `flowErrorReason` and /agent read); `site` is
 * the row's label. The user-facing text is a language key chosen from the category.
 */
export function ytdlFailureMessage(category: YtdlFailureCategory, site = 'the site'): string {
  return FAILURE_MESSAGES[category](site);
}

export class YtdlError extends Error {
  readonly category: YtdlFailureCategory;
  /** Masked end of yt-dlp's stderr; empty when the failure did not come from yt-dlp. */
  readonly stderrTail: string;

  constructor(category: YtdlFailureCategory, message?: string, stderrTail = '') {
    super(message ?? ytdlFailureMessage(category));
    this.name = 'YtdlError';
    this.category = category;
    this.stderrTail = stderrTail;
  }
}

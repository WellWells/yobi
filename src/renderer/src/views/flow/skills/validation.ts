import { OUTPUT_KEY_RE } from '../../../../../shared/flowValidation';
import { parseFacebookUrl } from '../../../../../shared/facebookLinks';
import { parsePttUrl } from '../../../../../shared/linkSites/pttLinks';
import { parseTikTokUrl } from '../../../../../shared/linkSites/tiktokLinks';
import { parseDcardUrl } from '../../../../../shared/linkSites/dcardLinks';
import { parseRedditUrl } from '../../../../../shared/linkSites/redditLinks';
import { parseWeiboUrl } from '../../../../../shared/linkSites/weiboLinks';
import { parseInstagramUrl } from '../../../../../shared/instagramLinks';
import { parseThreadsPostUrl } from '../../../../../shared/threadsLinks';
import { parseXHandle, parseXPostUrl } from '../../../../../shared/xHandles';
import { matchPostLink, matchVideoRef } from '../../../../../shared/linkSites/rows';
import type { PostSiteId, VideoSiteId } from '../../../../../shared/linkSites/types';
import { DOWNLOAD_MENU, parseQualityToken } from '../../../../../shared/ytdl';
import { looksLikeWebUrl, parseJsonStringArray, splitUrlListText } from '../../../../../shared/urlRows';

const VAR_ONLY = /^\{\{[^}]+\}\}$/;
const VAR_FIRST = /^\{\{[^}]+\}\}/;
const HTTP = /^https?:\/\//i;

/**
 * An address, a variable, or one that starts with a variable (`{{var.site}}/news`): the runner
 * fills the variable in before it reads the address, so the scheme is whatever the variable holds.
 */
export function isValidUrlOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (VAR_FIRST.test(trimmed)) return true;
  return HTTP.test(trimmed);
}

/**
 * A download URL the runner will fetch: https, a variable, or one written without a scheme (the
 * runner puts https:// in front). `http://` and any other scheme are refused there, so here too.
 */
export function isValidDownloadUrlOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('{{')) return true;
  if (/\s/.test(trimmed)) return false;
  if (/^https:\/\/./i.test(trimmed)) return true;
  // No scheme: a host with a dot ("example.com/a.pdf") is fetched as https.
  return !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && /^[^/]+\.[^/]/.test(trimmed);
}

const MAIL_ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * The parts of an email step's "To" that are neither an address (bare or `Name <address>`) nor a
 * variable, split on commas and semicolons as the mailer splits them.
 */
export function invalidMailRecipients(to: string): string[] {
  return to.split(/[,;]/).map((part) => part.trim()).filter(Boolean).filter((part) => {
    if (part.includes('{{')) return false;
    const angled = /<([^<>]+)>\s*$/.exec(part);
    return !MAIL_ADDRESS.test(angled ? angled[1]!.trim() : part);
  });
}

export function isValidUrlListOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.every((u) => typeof u === 'string' && isValidUrlOrVar(u));
      }
    } catch {
      return false;
    }
  }
  const parts = trimmed.split(/[\n\r,]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => isValidUrlOrVar(p));
}

/**
 * The first line (1-based) of a research step's page list the runner would drop without a word:
 * not a web address, a whole `{{variable}}` or a JSON array of them. A line with a variable inside
 * is only known at run time, so it passes. `null` when every line reads.
 */
export function firstUnreadableUrlLine(text: string): number | null {
  const rows = parseJsonStringArray(text.trim());
  if (rows) return rows.every((row) => VAR_ONLY.test(row.trim()) || looksLikeWebUrl(row.trim())) ? null : 1;
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.includes('{{')) continue;
    if (!splitUrlListText(line).every((piece) => looksLikeWebUrl(piece))) return index + 1;
  }
  return null;
}

const YT_HANDLE = /^@[\w.-]+$/;

/** A channel page or feed on YouTube's own hosts; any other site's page holds no channel. */
function isYoutubeChannelUrl(line: string): boolean {
  if (!HTTP.test(line)) return false;
  try {
    const host = new URL(line).hostname.toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

/**
 * The 1-based number of the first non-blank line that is no channel (`@handle`, a YouTube
 * channel or feed URL, or a `{{variable}}`), or 0 when every line is one.
 */
export function firstBadYoutubeChannelLine(text: string): number {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((raw) => {
    const line = raw.trim();
    return line !== '' && !VAR_ONLY.test(line) && !YT_HANDLE.test(line) && !isYoutubeChannelUrl(line);
  });
  return index + 1;
}

/** The 1-based number of the first non-blank line that is no X account or variable, or 0 when there is none. */
export function firstBadXAccountLine(text: string): number {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((raw) => {
    const line = raw.trim();
    return line !== '' && !VAR_ONLY.test(line) && parseXHandle(line) === null;
  });
  return index + 1;
}

/** An X, Threads, Instagram, Facebook, TikTok, PTT, Dcard, Reddit or Weibo post URL, which `x_thread` reads alike. */
export function isValidXPostUrlOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || VAR_ONLY.test(trimmed)) return true;
  return parseXPostUrl(trimmed) !== null || parseThreadsPostUrl(trimmed) !== null || parseInstagramUrl(trimmed) !== null
    || parseFacebookUrl(trimmed) !== null || parseTikTokUrl(trimmed) !== null || parsePttUrl(trimmed) !== null
    || parseDcardUrl(trimmed) !== null || parseRedditUrl(trimmed) !== null || parseWeiboUrl(trimmed) !== null;
}

/**
 * HTTP headers as the runner takes them: a JSON object. `[1]`, `"x"` and `123` are JSON too, and
 * failed only when the step ran. Text with a `{{…}}` that does not parse yet may once it is filled.
 */
export function isValidJsonObjectOrEmpty(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (VAR_ONLY.test(trimmed)) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return trimmed.includes('{{');
  }
}

/**
 * A link any video row of the link-site table takes (YouTube, bilibili, SoundCloud, Vimeo, an
 * `.m3u8`), the same `matchVideoRef` the video steps run on, or a field with a `{{variable}}` in
 * it, whose site only the run knows.
 */
export function isValidVideoUrlOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('{{')) return true;
  return matchVideoRef(trimmed) !== null;
}

/**
 * A quality the download step takes (`best`, a number of lines, `mp3`, `srt`, or a word the menu
 * reads as one of them), a `{{variable}}`, or blank (the run says what is missing).
 */
export function isValidDownloadQuality(quality: string): boolean {
  const trimmed = quality.trim();
  if (!trimmed || trimmed.includes('{{')) return true;
  const parsed = parseQualityToken(trimmed);
  return parsed !== null && parsed !== 'summary' && parsed !== DOWNLOAD_MENU;
}

/** The video row a fixed link belongs to; null for a blank field, a variable or no video link. */
export function videoSiteOf(url: string): VideoSiteId | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('{{')) return null;
  return matchVideoRef(trimmed)?.site ?? null;
}

/** The post row a fixed link belongs to; null for a blank field, a variable or no post link. */
export function postSiteOf(url: string): PostSiteId | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('{{')) return null;
  return matchPostLink(trimmed)?.ref.site ?? null;
}

export type OutputKeyError = 'format' | 'duplicate' | null;

export function validateOutputKey(key: string, siblingKeys: string[]): OutputKeyError {
  const trimmed = key.trim();
  if (!OUTPUT_KEY_RE.test(trimmed)) return 'format';
  if (siblingKeys.includes(trimmed)) return 'duplicate';
  return null;
}

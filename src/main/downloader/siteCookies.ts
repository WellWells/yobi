import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { session } from 'electron';
import { SITE_PARTITIONS } from '../siteAccounts';

/*
 * A site's cookies handed to yt-dlp as a Netscape cookie file. The file is written fresh for every
 * yt-dlp call into that call's own job folder and deleted when the call ends: yt-dlp rewrites the
 * file it was given, so a file kept for the next call would carry what yt-dlp left there, not what
 * the session holds.
 *
 * Never a sign-in's (X, Instagram, Facebook): to the site yt-dlp is another browser, and one
 * session cookie arriving from two browsers reads as a stolen cookie.
 */

/** Whose cookies yt-dlp gets: a partition a hidden window reads in (whatever cookies it holds). */
export interface CookieSource {
  partition: string;
}

/** One Netscape line; null for a cookie the format cannot carry. */
function cookieLine(cookie: Electron.Cookie, fallbackHost: string): string | null {
  const fields = [cookie.name, cookie.value, cookie.domain ?? '', cookie.path ?? ''];
  if (!cookie.name || fields.some((field) => /[\t\r\n]/.test(field))) return null;
  const bare = (cookie.domain || fallbackHost).replace(/^\./, '');
  if (!bare) return null;
  // A host-only cookie is written without the leading dot and FALSE; a domain cookie with both.
  const hostOnly = cookie.hostOnly ?? !(cookie.domain ?? '').startsWith('.');
  const expires = cookie.session || !cookie.expirationDate ? 0 : Math.floor(cookie.expirationDate);
  return [
    hostOnly ? bare : `.${bare}`,
    hostOnly ? 'FALSE' : 'TRUE',
    cookie.path || '/',
    cookie.secure ? 'TRUE' : 'FALSE',
    String(expires),
    cookie.name,
    cookie.value,
  ].join('\t');
}

/** The cookies as the Netscape file yt-dlp reads; `url` names the host a cookie without a domain belongs to. */
export function netscapeCookies(cookies: readonly Electron.Cookie[], url: string): string {
  const host = new URL(url).hostname;
  const lines = cookies.map((cookie) => cookieLine(cookie, host)).filter((line): line is string => line !== null);
  return `${['# Netscape HTTP Cookie File', ...lines].join('\n')}\n`;
}

/**
 * Writes the cookies the session would send to `url` into a new file in `dir`; null when there
 * are none. Only the link's own cookies go: yt-dlp never sees the rest of the session. A sign-in's
 * partition throws.
 */
export async function writeCookieFile(source: CookieSource, url: string, dir: string): Promise<string | null> {
  if (SITE_PARTITIONS.includes(source.partition)) throw new Error('a sign-in\'s cookies never go to yt-dlp');
  const cookies = await session.fromPartition(source.partition).cookies.get({ url });
  if (cookies.length === 0) return null;
  const file = path.join(dir, `cookies-${randomUUID()}.txt`);
  await fs.writeFile(file, netscapeCookies(cookies, url), { mode: 0o600, flag: 'wx' });
  return file;
}

/**
 * Runs `run` with a cookie file written for this call alone (or none: no source, or no cookies),
 * deleting the file afterwards whatever happened.
 */
export async function withCookieFile<T>(
  source: CookieSource | undefined,
  url: string,
  dir: string,
  run: (cookieFile: string | undefined) => Promise<T>,
): Promise<T> {
  const file = source ? await writeCookieFile(source, url, dir) : null;
  try {
    return await run(file ?? undefined);
  } finally {
    if (file) await fs.rm(file, { force: true }).catch(() => {});
  }
}

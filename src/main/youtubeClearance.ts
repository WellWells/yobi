import { session } from 'electron';
import type { WebContents } from 'electron';
import type { CookieSource } from './downloader/siteCookies';

/*
 * Google's pass for an address it turned away ("unusual traffic from your computer network"):
 * once a person answers the check on google.com/sorry, Google sends them back to YouTube with a
 * `google_abuse` parameter carrying a `GOOGLE_ABUSE_EXEMPTION` cookie, and every request from that
 * address that carries the cookie is let through until it expires. The pass names the address, not
 * a Google account: it is no sign-in, so it may go to yt-dlp as well (a sign-in's cookie never may,
 * `siteCookies.ts`).
 *
 * It lives in a partition of its own: the caption reader's `persist:youtube` is wiped on a retry
 * (`youtubeTranscript.ts`), which would throw the pass away. The readers copy it in instead
 * (`carryYoutubeClearance`).
 */

/** The verification window's partition, where the pass is kept. Never signed in to anything. */
export const YOUTUBE_CLEARANCE_PARTITION = 'persist:youtube-clearance';
/** The pass's cookie name, as Google sets it. */
export const CLEARANCE_COOKIE = 'GOOGLE_ABUSE_EXEMPTION';

const YOUTUBE_ORIGIN = 'https://www.youtube.com/';

/** What yt-dlp gets for YouTube: the pass alone, none of the window's other YouTube cookies. */
export const YOUTUBE_CLEARANCE_COOKIES: CookieSource = { partition: YOUTUBE_CLEARANCE_PARTITION, names: [CLEARANCE_COOKIE] };

function isYoutubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

/** A read turned away to Google's "unusual traffic" page: the one a person can answer. */
export function isGoogleSorryRedirect(message: string): boolean {
  return /^YouTube redirected to (?:www\.)?google\./.test(message);
}

export interface ClearancePass {
  value: string;
  /** Seconds since the epoch; absent = a session cookie. */
  expires?: number;
}

/**
 * The pass carried by the URL Google sends the person back to (`google_abuse=NAME=value; path=/;
 * domain=youtube.com; expires=…`); null when the URL has none.
 */
export function clearanceFromUrl(url: string): ClearancePass | null {
  let raw: string | null;
  try {
    raw = new URL(url).searchParams.get('google_abuse');
  } catch {
    return null;
  }
  if (!raw) return null;
  const [pair = '', ...attributes] = raw.split(';');
  const eq = pair.indexOf('=');
  if (eq < 0 || pair.slice(0, eq).trim() !== CLEARANCE_COOKIE) return null;
  const value = pair.slice(eq + 1).trim();
  if (!value || /[\s;,]/.test(value)) return null;
  const expiresAttr = attributes.map((part) => part.trim()).find((part) => /^expires=/i.test(part));
  const expiresMs = expiresAttr ? Date.parse(expiresAttr.slice('expires='.length)) : Number.NaN;
  return Number.isFinite(expiresMs) ? { value, expires: Math.floor(expiresMs / 1_000) } : { value };
}

async function storePass(pass: ClearancePass): Promise<void> {
  await session.fromPartition(YOUTUBE_CLEARANCE_PARTITION).cookies.set({
    url: YOUTUBE_ORIGIN,
    name: CLEARANCE_COOKIE,
    value: pass.value,
    domain: '.youtube.com',
    path: '/',
    secure: true,
    ...(pass.expires ? { expirationDate: pass.expires } : {}),
  });
}

/**
 * Whether the verification window is past Google's check: back on YouTube. The pass on the URL is
 * kept in the partition, whether or not YouTube set the cookie itself.
 */
export async function landedPastGoogleCheck(contents: WebContents): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(contents.getURL());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !isYoutubeHost(url.hostname)) return false;
  const pass = clearanceFromUrl(url.href);
  if (pass) await storePass(pass);
  return true;
}

async function currentPass(): Promise<Electron.Cookie | null> {
  const cookies = await session.fromPartition(YOUTUBE_CLEARANCE_PARTITION).cookies.get({ url: YOUTUBE_ORIGIN, name: CLEARANCE_COOKIE });
  return cookies.find((cookie) => cookie.name === CLEARANCE_COOKIE && cookie.value) ?? null;
}

/** The pass as a `Cookie` header pair (`NAME=value`); '' when there is none. */
export async function youtubeClearanceCookie(): Promise<string> {
  const pass = await currentPass().catch(() => null);
  return pass ? `${CLEARANCE_COOKIE}=${pass.value}` : '';
}

/** Copies the pass into a reader's own session (the caption reader's), before it opens YouTube. */
export async function carryYoutubeClearance(target: Electron.Session): Promise<void> {
  const pass = await currentPass().catch(() => null);
  if (!pass) return;
  await target.cookies.set({
    url: YOUTUBE_ORIGIN,
    name: CLEARANCE_COOKIE,
    value: pass.value,
    domain: '.youtube.com',
    path: '/',
    secure: true,
    ...(pass.expirationDate ? { expirationDate: pass.expirationDate } : {}),
  }).catch(() => {});
}

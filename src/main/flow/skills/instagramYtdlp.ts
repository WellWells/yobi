import { runYtdlpJson } from '../../downloader/ytdlpInvoke';
import { sendLog } from '../../helpers';
import { getSiteAccountStatus } from '../../siteAccounts';
import { createYtdlJobDir, removeYtdlJobDir } from '../../youtubeDownload';
import { parseInstagramUrl, type InstagramRef } from '../../../shared/instagramLinks';
import { siteLabel } from '../../../shared/linkSites/rows';
import { readInstagramThread } from './instagramReader';
import { arr, num, obj, str, type Json } from './jsonPick';
import { cdnUrl, idOf } from './metaMedia';
import type { XMedia, XPost, XThread } from './xPosts';
import type { XRead } from './xReader';

/*
 * Signed out, Instagram videos go through yt-dlp first; it only takes videos, so photos fall to
 * Yobi's own reader. Only yt-dlp's progressive mp4s are used (its DASH formats need FFmpeg). The
 * run itself (safety flags, JS runtime, environment, proxy, Stop) is `downloader/ytdlpInvoke.ts`'s.
 *
 * Signed in, yt-dlp does not run: the sign-in's cookies never leave Yobi's own browser
 * (`downloader/siteCookies.ts`), and Yobi's reader reads everything signed in.
 */

export interface YtdlpInstagramRead {
  thread: XThread;
  /**
   * Whether this holds everything the link shows: one video. A carousel or a set of stories may
   * hold photos yt-dlp leaves out.
   */
  complete: boolean;
}

/**
 * Instagram's own yt-dlp options, for a link rebuilt from its parts (anything else throws). One
 * story, or one post, is not widened to the account's whole set.
 */
export function ytdlpInstagramArgs(ref: InstagramRef): string[] {
  if (parseInstagramUrl(ref.url)?.url !== ref.url) throw new Error('yt-dlp only takes a rebuilt Instagram link');
  return [
    '--skip-download',
    '--dump-single-json',
    '--no-warnings',
    ref.kind === 'story' ? '--no-playlist' : '--yes-playlist',
  ];
}

/** Progressive mp4s only — sound and picture in one file — which yt-dlp lists without the `dash-` prefix. */
function videoOf(entry: Json): XMedia | null {
  const width = num(entry.width);
  const height = num(entry.height);
  const seen = new Set<string>();
  const variants = arr(entry.formats).flatMap((raw) => {
    const format = obj(raw);
    const url = cdnUrl(format?.url);
    if (!format || !url || seen.has(url) || str(format.format_id).startsWith('dash-')) return [];
    if (str(format.protocol) !== 'https' || (str(format.ext) || 'mp4') !== 'mp4') return [];
    seen.add(url);
    return [{ url, bitrate: Math.round(num(format.tbr) * 1_000), width: num(format.width) || width, height: num(format.height) || height }];
  });
  if (variants.length === 0) return null;
  // Its thumbnails mix the poster's own shape with square crops, which cut the picture.
  const copies = arr(entry.thumbnails)
    .map((t) => ({ url: cdnUrl(obj(t)?.url), width: num(obj(t)?.width), height: num(obj(t)?.height) }))
    .filter((c) => c.url && c.width > 0 && c.height > 0)
    .filter((c) => !(width > 0 && height > 0) || Math.abs(c.width / c.height - width / height) < 0.02)
    .sort((a, b) => b.width - a.width);
  const image = copies[0]?.url || cdnUrl(entry.thumbnail);
  return { kind: 'video', image, width, height, durationMs: Math.round(num(entry.duration) * 1_000), variants, copies };
}

function commentOf(raw: unknown, link: string): XPost | null {
  const comment = obj(raw);
  const id = idOf(comment?.id);
  const text = str(comment?.text);
  if (!comment || !id || !text || str(comment.parent) && str(comment.parent) !== 'root') return null;
  return {
    id, author: str(comment.author), name: '', createdAt: num(comment.timestamp) * 1_000, text,
    link: `${link}c/${id}/`, image: '', replyCount: 0, likeCount: num(comment.like_count),
    inReplyTo: '', isRepost: false, media: [], quoteMedia: [],
  };
}

/** yt-dlp's `--dump-single-json` for an Instagram link; null when it held no video. */
export function readYtdlpInstagram(body: unknown, ref: InstagramRef): YtdlpInstagramRead | null {
  const info = obj(body);
  if (!info) return null;
  const playlist = str(info._type) === 'playlist';
  const entries = playlist ? arr(info.entries).map(obj).filter((e): e is Json => e !== undefined) : [info];
  const media = entries.map(videoOf).filter((m): m is XMedia => m !== null);
  if (media.length === 0) return null;
  const first = entries[0];
  const author = str(info.channel) || str(first.channel) || ref.author;
  const link = ref.url;
  const focal: XPost = {
    id: ref.id,
    author,
    name: str(info.uploader) || str(first.uploader),
    createdAt: num(info.timestamp || first.timestamp) * 1_000,
    text: ref.kind === 'post' ? str(info.description) : '',
    link,
    image: media[0].image,
    replyCount: num(info.comment_count),
    likeCount: num(info.like_count),
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia: [],
  };
  const replies = arr(info.comments).map((c) => commentOf(c, link)).filter((c): c is XPost => c !== null);
  return { thread: { focal, replies }, complete: !playlist && media.length === 1 };
}

/**
 * The link read by yt-dlp, as a visitor (no cookies); null when yt-dlp is not installed, failed,
 * or found no video. A Stop throws (an error named AbortError).
 */
export async function readInstagramWithYtdlp(ref: InstagramRef, signal?: AbortSignal): Promise<YtdlpInstagramRead | null> {
  const siteArgs = ytdlpInstagramArgs(ref);
  const dir = await createYtdlJobDir();
  try {
    const result = await runYtdlpJson({
      label: siteLabel('instagram'),
      url: ref.url,
      siteArgs,
      cwd: dir,
      ...(signal ? { signal } : {}),
    });
    if (!result) return null;
    if (result.code !== 0) {
      const reason = result.timedOut ? 'timed out' : result.stderr.trim().split('\n').at(-1) ?? `exit ${result.code}`;
      sendLog(`📷 [Instagram] yt-dlp gave no video (${reason}) — reading with Yobi's own reader`);
      return null;
    }
    const read = readYtdlpInstagram(JSON.parse(result.stdout) as unknown, ref);
    sendLog(read
      ? `📷 [Instagram] yt-dlp read ${read.thread.focal.media.length} video(s)`
      : '📷 [Instagram] yt-dlp found no video — reading with Yobi\'s own reader');
    return read;
  } finally {
    await removeYtdlJobDir(dir).catch(() => {});
  }
}

/**
 * An Instagram link. Signed in, Yobi's own reader alone. Signed out, yt-dlp first: its answer
 * stands when it holds the whole link (one video); otherwise Yobi's own reader, which also reads
 * photos, and yt-dlp's videos only when that fails. `signal` (a flow's Stop) kills the yt-dlp probe
 * and aborts the reader's request: a stopped read throws rather than falling to the next reader.
 * `signedIn` false: read as signed out even when Instagram is signed in
 * (`SiteReadOptions.signedIn`). `forOthers`: the sign-in reads it for someone else
 * (`SiteReadOptions.forOthers`).
 */
export async function readInstagramLink(
  url: string,
  signal?: AbortSignal,
  comments = true,
  signedIn = true,
  forOthers = false,
): Promise<XRead<XThread>> {
  const ref = parseInstagramUrl(url);
  if (!ref) return { status: 400, value: null };
  // Stories and a profile are not read for anyone but the owner: refused there, before any probe.
  // A profile is Yobi's own reader's alone: yt-dlp has no use for it.
  if (ref.kind !== 'post' && !signedIn) return readInstagramThread(ref.url, signal, comments, false);
  if (ref.kind === 'profile' || (signedIn && await getSiteAccountStatus('instagram').catch(() => false))) {
    return readInstagramThread(ref.url, signal, comments, signedIn, forOthers);
  }
  const viaYtdlp = await readInstagramWithYtdlp(ref, signal).catch((err: unknown) => {
    signal?.throwIfAborted();
    sendLog(`📷 [Instagram] yt-dlp could not run: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (viaYtdlp?.complete) return { status: 200, value: viaYtdlp.thread };
  try {
    const own = await readInstagramThread(ref.url, signal, true, signedIn);
    if (own.value || !viaYtdlp) return own;
  } catch (err) {
    if (!viaYtdlp || signal?.aborted) throw err;
  }
  return { status: 200, value: viaYtdlp.thread };
}

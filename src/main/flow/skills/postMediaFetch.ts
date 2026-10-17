import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { once } from 'node:events';
import { getLangCache, t } from '../../i18n';
import { destinationLimitBytes, isAccountLink, isStoryLink, pickVariant, variantBytes } from '../../../shared/xMedia';
import type { SizedVariant, XMediaDestination, XMediaInput } from '../../../shared/xMedia';
import { formatLimit, formatMegabytes, safeFolderName, safeVideoFileName } from '../../../shared/ytdl';
import { toIsoDate } from '../../../shared/flowScheduleCore';
import { ensureFaststart } from '../../downloader/faststart';
import { fetchLimitFor } from '../../downloader/fetchLimits';
import { FlowUserError } from '../userError';
import { downloadsFolder } from './fileOps';
import { postFileStem, siteName } from './postReader';
import { diskFullError, fetchPostStream } from './postStream';
import type { XMedia, XPost, XVideoVariant } from './xPosts';

/*
 * Fetching a post's media files, shared by the forward (`xMedia.ts`) and its MP3 (`postAudio.ts`):
 * which version a destination gets, the download itself, and the names and folder the files take.
 */

const HEAD_TIMEOUT_MS = 10_000;
/** A download is given up when no byte arrives for this long, however long the whole file takes. */
const STALL_TIMEOUT_MS = 30_000;

/**
 * A version with its own headers is one only Yobi's session can fetch, and one made of streams
 * has no single file: neither is ever handed on as a URL.
 */
export function isLocked(variant: Pick<XVideoVariant, 'headers' | 'stream'>): boolean {
  return variant.headers !== undefined || variant.stream !== undefined;
}

async function sizeOf(variant: XVideoVariant, signal?: AbortSignal): Promise<number | null> {
  if (variant.sizeBytes !== undefined && variant.sizeBytes > 0) return variant.sizeBytes;
  try {
    // The URL came from a page: no redirect is followed anywhere off it.
    const res = await fetch(variant.url, {
      method: 'HEAD',
      redirect: 'error',
      ...(variant.headers ? { headers: variant.headers } : {}),
      signal: AbortSignal.any([AbortSignal.timeout(HEAD_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    });
    const length = Number(res.headers.get('content-length') ?? '');
    return res.ok && Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

export type SizedMediaVariant = SizedVariant & Pick<XVideoVariant, 'headers' | 'stream'>;

export async function sizedVariants(media: XMedia, signal?: AbortSignal): Promise<SizedMediaVariant[]> {
  return Promise.all(media.variants.map(async (v) => ({
    url: v.url,
    bitrate: v.bitrate,
    // The "p" people call a quality is the short side: a 1080×1350 portrait video is 1080p.
    height: Math.min(v.width, v.height) || v.height,
    sizeBytes: await sizeOf(v, signal),
    ...(v.headers ? { headers: v.headers } : {}),
    ...(v.stream ? { stream: v.stream } : {}),
  })));
}

/**
 * One file streamed to `file`, its bytes counted as they arrive: over `limitBytes` (the chat's
 * limit) or over what the disk can take (`fetchLimitFor`, even with no limit) it stops at once.
 */
export async function downloadTo(
  url: string,
  file: string,
  limitBytes: number | null,
  signal: AbortSignal | undefined,
  headers?: Record<string, string>,
): Promise<number> {
  const limit = await fetchLimitFor(path.dirname(file), limitBytes);
  const stall = new AbortController();
  let timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS);
  const out = createWriteStream(file);
  let done = 0;
  try {
    const res = await fetch(url, {
      redirect: 'error',
      ...(headers ? { headers } : {}),
      signal: AbortSignal.any([stall.signal, ...(signal ? [signal] : [])]),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS);
      done += chunk.length;
      if (limit && done > limit.bytes) {
        if (limit.disk || limitBytes === null) throw diskFullError(new URL(url).hostname, `${done} bytes, over the ${limit.bytes} the disk can take`);
        throw new Error(`over ${formatMegabytes(limitBytes)}`);
      }
      if (!out.write(chunk)) await once(out, 'drain');
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return done;
}

/**
 * Fetches a video version into `file`: its one file, or its streams put together (`postStream.ts`).
 * The site's own file gets its index moved to the front when it sits at the end, so it plays as it loads.
 */
export async function fetchVariantTo(
  variant: Pick<SizedMediaVariant, 'url' | 'headers' | 'stream'>,
  file: string,
  limitBytes: number | null,
  signal: AbortSignal | undefined,
): Promise<number> {
  if (variant.stream) return fetchPostStream(variant.stream, file, limitBytes, signal);
  const bytes = await downloadTo(variant.url, file, limitBytes, signal, variant.headers);
  await ensureFaststart(file, signal);
  return bytes;
}

/**
 * The version this destination gets, or why there is none: the best under the destination's limit
 * (`telegramLimitBytes` for a Telegram chat: the person's, see `destinationLimitBytes`).
 */
export async function chooseVariant(
  media: XMedia,
  destination: XMediaDestination,
  signal?: AbortSignal,
  telegramLimitBytes?: number,
): Promise<SizedMediaVariant> {
  const variants = await sizedVariants(media, signal);
  const limit = destinationLimitBytes(destination, telegramLimitBytes);
  const picked = pickVariant(variants, media.durationMs, limit);
  if (picked) return picked;
  // A preview is not a chat with a limit: the post still shows, with the smallest version.
  const smallestVersion = [...variants].sort((a, b) => a.bitrate - b.bitrate || a.height - b.height).at(0);
  if (destination === 'preview' && smallestVersion) return smallestVersion;
  const smallest = variants.map((v) => variantBytes(v, media.durationMs)).filter((b): b is number => b !== null);
  const size = formatMegabytes(Math.min(...smallest));
  throw new FlowUserError(
    'flow.error.xMediaTooLarge',
    { size, limit: formatLimit(limit ?? 0) },
    `Even the smallest version of this video (${size}) is over the ${formatLimit(limit ?? 0)} this chat takes`,
  );
}

/** The file name of the post's item `index` of `count`: `<stem>.mp4`, or `<stem>-2.mp4` among several. */
export function mediaFileName(stem: string, index: number, count: number, ext: string): string {
  return safeVideoFileName(`${stem}${count > 1 ? `-${index + 1}` : ''}`, ext);
}

/**
 * Where the files go: the step's folder; a person's stories saved together get a folder of their
 * own in it, named after the person and the day, so twenty of them do not scatter in Downloads/Yobi.
 */
export function saveFolder(input: XMediaInput, post: XPost, count: number, folder: string | undefined): string {
  const base = downloadsFolder(folder);
  const account = isAccountLink(input);
  if (count < 2 || !(account || isStoryLink(input))) return base;
  // An account's latest posts (an Instagram profile) get one the same way.
  const name = t(getLangCache(), account ? 'xMedia.profile.folder' : 'xMedia.story.folder', {
    name: post.name || post.author || siteName(input.source),
    date: toIsoDate(new Date()),
  });
  return path.join(base, safeFolderName(name, postFileStem(input.source, post)));
}

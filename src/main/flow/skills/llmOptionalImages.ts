import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { isIP } from 'node:net';
import { sendLog } from '../../helpers';
import { sniffImageFormat } from '../../imageSize';
import { parseAttachmentList } from '../../attachmentGuard';
import { loadByokImages } from '../../providers/byokImages';
import type { ByokImage } from '../../providers/byokClient';
import { downloadTo } from './postMediaFetch';

/*
 * Pictures an `llm` step may send but does not need (a post analysis's photos, `imageUrls`):
 * fetched into a folder of the step's own, sent if the model takes them, and deleted when the step
 * ends. Nothing here fails the step — a picture that cannot be fetched is left out, and the
 * step answers from its text.
 */

/** As many as the analysis offers; the provider's own cap may cut it further. */
export const OPTIONAL_IMAGES_MAX = 4;

/** A post's medium-size photo is a few hundred KB; anything near this is not one. */
const OPTIONAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS = { png: '.png', jpeg: '.jpg', webp: '.webp' } as const;

/** A public https address: no credentials, no port, no bare IP or local host name. */
function fetchableImageUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 || host === 'localhost' || !host.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface OptionalImages {
  dir: string;
  files: string[];
}

/** One picture into `dir`, named by what its bytes are; null when it is not a PNG, JPEG or WebP. */
async function fetchOne(url: string, dir: string, index: number, signal?: AbortSignal): Promise<string | null> {
  const part = path.join(dir, `.image-${index}.part`);
  await downloadTo(url, part, OPTIONAL_IMAGE_MAX_BYTES, signal);
  const handle = await fs.open(part, 'r');
  const head = Buffer.alloc(16);
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  const format = sniffImageFormat(head);
  if (format === null || format === 'gif') {
    await fs.rm(part, { force: true });
    return null;
  }
  const file = path.join(dir, `image-${index + 1}${EXTENSIONS[format]}`);
  await fs.rename(part, file);
  return file;
}

/**
 * Fetches the pictures listed in `raw` (one URL per line or comma) at once, in their order. A
 * picture that fails is logged and left out; stopping the step stops them all and is thrown.
 */
export async function fetchOptionalImages(raw: string, signal?: AbortSignal): Promise<OptionalImages | null> {
  const urls = parseAttachmentList(raw)
    .map(fetchableImageUrl)
    .filter((url): url is string => url !== null)
    .slice(0, OPTIONAL_IMAGES_MAX);
  if (urls.length === 0) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-llm-images-'));
  const results = await Promise.allSettled(urls.map((url, index) => fetchOne(url, dir, index, signal)));
  if (signal?.aborted) {
    await removeOptionalImages(dir);
    signal.throwIfAborted();
  }
  const files: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled' && result.value) {
      // The attachment guard hands back real paths: these are told apart from the step's own files by them.
      const file = result.value;
      files.push(await fs.realpath(file).catch(() => file));
      continue;
    }
    const why = result.status === 'rejected'
      ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
      : 'not a PNG, JPEG or WebP picture';
    sendLog(`⚠️ [Flow] Picture ${index + 1} left out (${new URL(urls[index]).hostname}): ${why}`);
  }
  if (files.length === 0) {
    await removeOptionalImages(dir);
    return null;
  }
  sendLog(`🖼️ [Flow] ${files.length} picture(s) ready to send with the prompt`);
  return { dir, files };
}

/**
 * The step's config with the fetched pictures after its own attachments, and allowed as files
 * this run made — so the provider's limits (count, size, type) apply to them as to any other.
 */
export function withOptionalFiles(config: Record<string, string>, files: readonly string[]): Record<string, string> {
  if (files.length === 0) return config;
  let allowed: string[] = [];
  try {
    const parsed: unknown = JSON.parse(config.__attachmentAllowlist ?? '[]');
    if (Array.isArray(parsed)) allowed = parsed.filter((v): v is string => typeof v === 'string');
  } catch {}
  return {
    ...config,
    attachments: [...parseAttachmentList(config.attachments), ...files].join('\n'),
    __attachmentAllowlist: JSON.stringify([...allowed, ...files]),
  };
}

/**
 * The pictures for a BYOK request. A picture the step needs that cannot be read fails it, as
 * before; when only optional ones are the trouble, the request goes without them.
 */
export async function byokImagesFor(
  attachments: readonly string[],
  required: readonly string[],
  sendsOptional: boolean,
  providerLabel: () => string,
): Promise<ByokImage[] | undefined> {
  if (attachments.length === 0) return undefined;
  try {
    return await loadByokImages(attachments);
  } catch (err) {
    if (!sendsOptional) throw err;
    sendLog(`⚠️ [Flow] ${providerLabel()} cannot use the pictures (${err instanceof Error ? err.message : String(err)}) — sending the prompt without them`);
    return required.length > 0 ? loadByokImages(required) : undefined;
  }
}

export async function removeOptionalImages(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

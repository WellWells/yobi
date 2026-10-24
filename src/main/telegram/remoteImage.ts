import { nativeImage } from 'electron';
import { parseImageSize } from '../imageSize';
import { assertPublicHttpUrl } from '../net/ssrfGuard';
import { userAgentForUrl } from '../userAgent';

const MAX_EDGE = 1200;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const JPEG_QUALITY = 82;

function refererFor(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return undefined;
  }
}

async function readCappedBody(res: Response, cap: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const body = res.body;
  if (!body) return Buffer.from(await res.arrayBuffer());
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function optimizeImage(raw: Buffer, onLog: (msg: string) => void): Buffer | null {
  const declaredSize = parseImageSize(raw);
  if (declaredSize && declaredSize.width * declaredSize.height > MAX_PIXELS) {
    onLog(`[telegram] image rejected: ${declaredSize.width}x${declaredSize.height} exceeds pixel limit`);
    return null;
  }

  const img = nativeImage.createFromBuffer(raw);
  if (img.isEmpty()) return null;

  const { width, height } = img.getSize();
  if (!width || !height) return null;

  const resized = width > MAX_EDGE || height > MAX_EDGE;
  let out = img;
  if (resized) {
    const scale = Math.min(MAX_EDGE / width, MAX_EDGE / height);
    out = img.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      quality: 'better',
    });
  }

  let quality = JPEG_QUALITY;
  let encoded = out.toJPEG(quality);
  while (encoded.length > MAX_BYTES && quality > 40) {
    quality -= 15;
    encoded = out.toJPEG(quality);
  }

  if (encoded.length === 0 || (!resized && encoded.length >= raw.length)) return raw;

  const dst = out.getSize();
  onLog(
    `[telegram] image optimized: ${width}x${height} ${Math.round(raw.length / 1024)}KB` +
    ` → ${dst.width}x${dst.height} ${Math.round(encoded.length / 1024)}KB (jpeg q${quality})`,
  );
  return encoded;
}

export async function fetchOptimizedImage(
  url: string,
  onLog: (msg: string) => void,
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const referer = refererFor(url);
  try {
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await assertPublicHttpUrl(current);
      res = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': userAgentForUrl(target.href),
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          ...(referer ? { Referer: referer } : {}),
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) break;
        await res.body?.cancel().catch(() => {});
        current = new URL(location, target).toString();
        continue;
      }
      break;
    }
    if (!res) return null;
    if (!res.ok) {
      onLog(`[telegram] image download failed: HTTP ${res.status}`);
      return null;
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      onLog(`[telegram] image download returned non-image content: ${contentType}`);
      return null;
    }
    const raw = await readCappedBody(res, MAX_DOWNLOAD_BYTES);
    if (!raw) {
      onLog(`[telegram] image download exceeded ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB and was aborted`);
      return null;
    }
    if (raw.length === 0) return null;

    const optimized = optimizeImage(raw, onLog);
    if (optimized) return optimized;
    if (contentType.startsWith('image/')) return raw;
    onLog('[telegram] image download could not be decoded and had no image content-type');
    return null;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    onLog(`[telegram] image download error: ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

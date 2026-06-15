import { nativeImage } from 'electron';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { CLEAN_UA } from '../userAgent';

const MAX_EDGE = 1200;
const MAX_BYTES = 5 * 1024 * 1024;
// Hard ceiling on the raw download, independent of the optimized-output cap:
// bounds memory even when Content-Length is absent, lying, or the body is chunked.
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
// Refuse to decode absurd dimensions (decompression bombs) before nativeImage
// allocates a full RGBA bitmap.
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

function ipv6ToHextets(ip: string): number[] | null {
  if (ip.includes('.')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  let parts: string[];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    parts = [...left, ...Array(fill).fill('0'), ...right];
  } else {
    parts = ip.split(':');
  }
  if (parts.length !== 8) return null;
  return parts.map((h) => parseInt(h || '0', 16));
}

function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedAddress(dotted[1]);
    // IPv4-mapped (::ffff:x:x) and IPv4-compatible (::x:x) in hex form embed a v4
    // address in the last two hextets — canonicalize and re-check so notation
    // variants can't slip past the loopback/private checks above.
    const hextets = ipv6ToHextets(lower);
    if (hextets) {
      const mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
      const compat = hextets.slice(0, 6).every((h) => h === 0);
      if (mapped || compat) {
        const [h6, h7] = [hextets[6], hextets[7]];
        return isBlockedAddress(`${(h6 >> 8) & 0xff}.${h6 & 0xff}.${(h7 >> 8) & 0xff}.${h7 & 0xff}`);
      }
    }
    return false;
  }
  return false;
}

// Reject URLs that resolve to loopback/private/link-local ranges so an
// attacker-controlled og:image cannot make Yobi probe internal services.
async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  const u = new URL(rawUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`blocked address: ${host}`);
    return u;
  }
  const resolved = await dns.lookup(host, { all: true });
  if (resolved.length === 0) throw new Error(`could not resolve host: ${host}`);
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) throw new Error(`host resolves to a blocked address: ${host} → ${address}`);
  }
  return u;
}

function parseImageSize(raw: Buffer): { width: number; height: number } | null {
  if (raw.length >= 24 && raw[0] === 0x89 && raw.toString('ascii', 1, 4) === 'PNG') {
    return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
  }
  if (raw.length >= 4 && raw[0] === 0xff && raw[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < raw.length) {
      if (raw[offset] !== 0xff) { offset++; continue; }
      const marker = raw[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: raw.readUInt16BE(offset + 5), width: raw.readUInt16BE(offset + 7) };
      }
      offset += 2 + raw.readUInt16BE(offset + 2);
    }
  }
  return null;
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

// nativeImage decodes PNG/JPEG only; returns null when the bytes cannot be
// decoded (webp/avif/non-image) so the caller decides whether to trust them.
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

// Download a remote image ourselves — with a real browser User-Agent and a
// same-origin Referer, which hotlink-protected hosts require — then optimize it.
// Redirects are followed manually so every hop is SSRF-checked; the raw download
// is byte-capped and never written to disk. Returns null on any failure so the
// caller can fall back to a plain URL send.
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
          'User-Agent': CLEAN_UA,
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
    // Release the socket on every path (early returns leave the body undrained);
    // a no-op once the body has already been fully read.
    controller.abort();
  }
}

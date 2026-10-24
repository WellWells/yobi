import * as path from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { sniffImageFormat } from '../imageSize';
import { sendLog } from '../helpers';

/** A picture a web provider's answer holds, read back from the page and checked by its bytes. */
export interface GeneratedImage {
  bytes: Buffer;
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
  /** `page`: drawn by the provider; `svg`: SVG markup in the answer's text, turned into a PNG. */
  from: 'page' | 'svg';
}

/** What a web provider's runner hands back: the answer's text, and the pictures it drew, if any. */
export interface ProviderRunResult {
  response: string;
  title: string;
  images?: GeneratedImage[];
}

/** One answer's pictures: Gemini and ChatGPT draw at most four per turn. */
export const MAX_GENERATED_IMAGES = 4;
export const MAX_GENERATED_IMAGE_BYTES = 20_000_000;
/** SVG markup larger than this is code to read, not a picture to show. */
const MAX_SVG_CHARS = 500_000;
const MAX_SVG_IMAGES = 2;
/** The long side an SVG is drawn at when its own size is smaller (icons declare 24×24). */
const SVG_TARGET_SIDE = 1024;

/**
 * Page function (needs nothing in scope): the loaded pictures among `imgs` as base64, at most
 * `maxCount`, each at most `maxBytes`. The picture's own bytes when the page lets it be fetched
 * (ChatGPT's blob: URL); otherwise the decoded picture drawn onto a canvas (Gemini's connect-src
 * refuses blob: URLs, but the image is same-origin, so the canvas is not tainted). Never throws.
 */
export const INJECTED_READ_IMAGES_JS = `async function readPageImages(imgs, maxCount, maxBytes) {
  function toDataUrl(blob) {
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result || '')); };
      reader.onerror = function() { resolve(''); };
      reader.readAsDataURL(blob);
    });
  }
  async function viaFetch(img) {
    try {
      var res = await fetch(img.currentSrc || img.src);
      if (!res.ok) return null;
      var blob = await res.blob();
      return /^image\\//.test(blob.type) ? blob : null;
    } catch (e) { return null; }
  }
  async function viaCanvas(img) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
    } catch (e) { return null; }
  }
  var out = [];
  var seen = {};
  for (var i = 0; i < imgs.length && out.length < maxCount; i++) {
    var img = imgs[i];
    var src = img.currentSrc || img.src;
    if (!src || seen[src] || !img.complete || img.naturalWidth < 64 || img.naturalHeight < 64) continue;
    seen[src] = true;
    var blob = (await viaFetch(img)) || (await viaCanvas(img));
    if (!blob || blob.size > maxBytes) continue;
    var url = await toDataUrl(blob);
    var comma = url.indexOf(',');
    if (comma < 0) continue;
    out.push({ data: url.slice(comma + 1), width: img.naturalWidth, height: img.naturalHeight });
  }
  return out;
}`;

/** Script fragment: `readPageImages(<imgs expression>)` with the shared limits. */
export function readImagesCall(imgsExpression: string): string {
  return `readPageImages(${imgsExpression}, ${MAX_GENERATED_IMAGES}, ${MAX_GENERATED_IMAGE_BYTES})`;
}

interface PageImage {
  data?: unknown;
  width?: unknown;
  height?: unknown;
}

const EXT_FOR_FORMAT = { png: 'png', jpeg: 'jpg', webp: 'webp' } as const;

/**
 * The page's pictures that really are PNG, JPEG or WebP by their bytes; anything else (a GIF, a
 * broken read, a shape the page script did not promise) is dropped and logged.
 */
export function decodePageImages(raw: unknown, from: GeneratedImage['from'] = 'page'): GeneratedImage[] {
  if (!Array.isArray(raw)) return [];
  const images: GeneratedImage[] = [];
  for (const item of raw.slice(0, MAX_GENERATED_IMAGES) as PageImage[]) {
    if (!item || typeof item.data !== 'string' || !item.data) continue;
    const bytes = Buffer.from(item.data, 'base64');
    const format = sniffImageFormat(bytes);
    if (!format || format === 'gif' || bytes.length > MAX_GENERATED_IMAGE_BYTES) {
      sendLog(`⚠️ [Images] Dropped a picture the page returned (${format ?? 'unknown format'}, ${bytes.length} bytes)`);
      continue;
    }
    images.push({
      bytes,
      ext: EXT_FOR_FORMAT[format],
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : 0,
      from,
    });
  }
  return images;
}

const FENCED_SVG_RE = /```[ \t]*(?:svg|xml|html|image\/svg\+xml)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/gi;
const BARE_SVG_RE = /<svg\b[\s\S]*?<\/svg>/gi;
const XML_PROLOG_RE = /^<\?xml[\s\S]*?\?>\s*/i;

function asSvg(body: string): string | null {
  const trimmed = body.trim().replace(XML_PROLOG_RE, '');
  if (!/^<svg\b/i.test(trimmed) || !/<\/svg>$/i.test(trimmed) || trimmed.length > MAX_SVG_CHARS) return null;
  return trimmed;
}

/**
 * SVG pictures an answer wrote out as markup: fenced code blocks that are one whole `<svg>`, or a
 * bare `<svg>…</svg>` outside any fence. ChatGPT's temporary chat cannot draw, so asked for a
 * picture it often answers with SVG code instead.
 */
export function extractSvgMarkup(text: string): string[] {
  const found: string[] = [];
  const outsideFences = text.replace(FENCED_SVG_RE, (_whole, body: string) => {
    const svg = asSvg(body);
    if (svg) found.push(svg);
    return '';
  });
  for (const match of outsideFences.match(BARE_SVG_RE) ?? []) {
    const svg = asSvg(match);
    if (svg) found.push(svg);
  }
  return [...new Set(found)].slice(0, MAX_SVG_IMAGES);
}

/**
 * Page script: one SVG drawn as a PNG on a white ground (a transparent picture shows black in some
 * chat apps). As an `<img>` source the SVG runs no script and loads nothing, so drawing it inside
 * the provider's page is safe. Resolves `{ data, width, height }` or null; never throws.
 */
export function buildRasterizeSvgScript(svg: string): string {
  return `
(async function rasterizeSvg(svg) {
  try {
    var img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    var w = img.naturalWidth || ${SVG_TARGET_SIDE};
    var h = img.naturalHeight || ${SVG_TARGET_SIDE};
    var scale = Math.min(8, Math.max(1, ${SVG_TARGET_SIDE} / Math.max(w, h)));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    var url = canvas.toDataURL('image/png');
    var comma = url.indexOf(',');
    return comma < 0 ? null : { data: url.slice(comma + 1), width: canvas.width, height: canvas.height };
  } catch (e) {
    return null;
  }
})(${JSON.stringify(svg)})`;
}

/** The answer's SVG markup as PNGs, drawn in the provider's page; none when there is none. */
export async function rasterizeAnswerSvgs(wc: WebContents, text: string): Promise<GeneratedImage[]> {
  const svgs = extractSvgMarkup(text);
  if (svgs.length === 0 || wc.isDestroyed()) return [];
  const drawn: unknown[] = [];
  for (const svg of svgs) {
    try {
      const result = await wc.executeJavaScript(buildRasterizeSvgScript(svg), true);
      if (result) drawn.push(result);
    } catch (err) {
      sendLog(`⚠️ [Images] SVG not drawn: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const images = decodePageImages(drawn, 'svg');
  if (images.length > 0) sendLog(`🖼️ [Images] Drew ${images.length} SVG picture(s) from the answer as PNG`);
  return images;
}

/**
 * The answer with its SVG markup drawn as pictures, when the provider drew none itself (ChatGPT's
 * temporary chat answers a picture request with SVG code). Only for callers that show pictures:
 * drawing happens in the provider's page, so call it while the worker is still on it. Kept out of
 * `providers/index.ts`, which many tests mock with `runAutomation` alone.
 */
export async function withAnswerSvgPictures<T extends { response: string; images?: GeneratedImage[] }>(
  workerWin: BrowserWindow,
  result: T,
): Promise<T> {
  if (result.images?.length || !result.response || workerWin.isDestroyed()) return result;
  const drawn = await rasterizeAnswerSvgs(workerWin.webContents, result.response);
  return drawn.length > 0 ? { ...result, images: drawn } : result;
}

/** The file name a picture is kept under: the provider, the time, its place in the answer. */
export function generatedImageFileName(prefix: string, image: GeneratedImage, index: number, now = new Date()): string {
  // To the millisecond: two answers in the same second must not collide.
  const stamp = now.toISOString().replace(/[-:Z]/g, '').replace('T', '-').replace('.', '');
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'image';
  return path.basename(`${safePrefix}-${stamp}-${index + 1}.${image.ext}`);
}

import type { PhotoCopy } from '../../../shared/xMedia';
import { TELEGRAM_ALBUM_MAX } from '../../../shared/ytdl';

/*
 * The pictures a PTT article links: read from the links in its text, not the
 * page's `.richcontent` previews. They sit on any host the author chose — mostly Imgur and X. Imgur
 * serves `imgur.com/<id>` as `i.imgur.com/<id>.jpg` whatever the format, and fixed sizes by a
 * suffix. LINE takes no GIF, and a Telegram album turns every picture into a file when one is not
 * a jpg or png, so anything else stays a link in the text.
 */

export interface PttImage {
  /** The address as the article wrote it, taken out of the text when the picture is forwarded. */
  source: string;
  /** The picture itself, over https. */
  url: string;
  copies?: PhotoCopy[];
}

const IMGUR_HOSTS = new Set(['imgur.com', 'i.imgur.com', 'm.imgur.com', 'www.imgur.com']);
/** Imgur's ids: 7 characters, the oldest 5. An album (`/a/`) or gallery page is not one picture. */
const IMGUR_PATH = /^\/([A-Za-z0-9]{7}|[A-Za-z0-9]{5})(?:\.(jpe?g|png|gif|gifv|mp4|webp))?$/i;
/**
 * Imgur's fixed sizes: `h` 1024, `l` 640, `m` 320 px wide. The original's width is not in the
 * link; it is listed as the widest, for the computer and Telegram.
 */
const IMGUR_SIZES: ReadonlyArray<readonly [suffix: string, width: number]> = [['', 2_560], ['h', 1_024], ['l', 640], ['m', 320]];

const LINK_RE = /https?:\/\/[^\s<>"'）]+/g;

/** Every line's trailing blanks gone, runs of empty lines down to one, none at either end. */
export function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

function imgurImage(source: string, path: string): PttImage | null {
  const found = IMGUR_PATH.exec(path);
  if (!found) return null;
  // A GIF or a clip: LINE takes no GIF, and a Telegram album would turn every picture into a file.
  if (found[2] && !/^(?:jpe?g|png)$/i.test(found[2])) return null;
  const copies = IMGUR_SIZES.map(([suffix, width]) => ({ url: `https://i.imgur.com/${found[1]}${suffix}.jpg`, width, height: 0 }));
  return { source, url: copies[0].url, copies };
}

/** X's pictures under the `.jpg`/`.png` name `photoAtSize` resizes; `?format=` names are rewritten to it. */
function twimgImage(source: string, url: URL): PttImage | null {
  const found = /^\/media\/([A-Za-z0-9_-]+)(?:\.(jpe?g|png))?$/i.exec(url.pathname);
  const format = (found?.[2] ?? url.searchParams.get('format') ?? '').toLowerCase().replace('jpeg', 'jpg');
  if (!found || (format !== 'jpg' && format !== 'png')) return null;
  return { source, url: `https://pbs.twimg.com/media/${found[1]}.${format}` };
}

/**
 * The picture a link in the text points to, or null: Imgur's pages and pictures (the page's
 * picture is `i.imgur.com/<id>.jpg`), X's, and any https `.jpg`/`.png` on a named host. GIFs,
 * clips, albums, plain http and bare addresses are left as links in the text.
 */
export function pttImage(source: string): PttImage | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (IMGUR_HOSTS.has(host)) return imgurImage(source, url.pathname);
  if (url.protocol !== 'https:') return null;
  if (host === 'pbs.twimg.com') return twimgImage(source, url);
  // A named public host only: no address, no single-label name such as a router's.
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  return /\.(?:jpe?g|png)$/i.test(url.pathname) ? { source, url: url.href } : null;
}

/** The pictures the text links, in order, each once: at most a Telegram album's worth. */
export function imagesIn(text: string): PttImage[] {
  const out: PttImage[] = [];
  const seen = new Set<string>();
  for (const [source] of text.matchAll(LINK_RE)) {
    const image = pttImage(source);
    if (!image || seen.has(image.url)) continue;
    seen.add(image.url);
    out.push(image);
    if (out.length === TELEGRAM_ALBUM_MAX) break;
  }
  return out;
}

/**
 * The text with these pictures' links taken out, as the forward sends the pictures themselves: a
 * line left empty by it goes too.
 */
export function withoutImageLinks(text: string, images: readonly PttImage[]): string {
  if (images.length === 0) return text;
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    let out = line;
    for (const image of images) out = out.split(image.source).join('');
    if (line.trim() && !out.trim()) continue;
    kept.push(out);
  }
  return tidy(kept.join('\n'));
}

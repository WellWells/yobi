import { flagEmoji, pttRegionCode } from '../../../shared/linkSites/pttRegions';
import { formatPostTime, type PostCard } from '../../../shared/postCard';
import { escapePostMarkdown } from '../../../shared/xMedia';
import { decodeHtmlEntities } from '../../htmlEntities';
import { imagesIn, tidy, withoutImageLinks, type PttImage } from './pttImages';
import type { PushLine, XMedia, XPost } from './xPosts';

/* Reads a PTT article page: its header pairs, its text up to the system lines or the first push, and the pushes. */

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
/** PTT writes every time in Taiwan's. */
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
/** PTT signatures are six lines at most; with the pictures they link, a little more. */
const SIGNATURE_MAX_LINES = 12;

export interface PttArticle {
  /** The author's id, without the nickname. */
  author: string;
  nickname: string;
  board: string;
  title: string;
  /** Epoch ms; 0 when the page gave no time. */
  createdAt: number;
  /** The article's text, signature cut, links (pictures too) as written. */
  body: string;
  /** The pictures it links, in order, each once: at most a Telegram album's worth. */
  images: PttImage[];
  pushes: PushLine[];
  /** Where PTT says it was posted from, in its own words; "" when it does not say. */
  from: string;
}

/** Text without its markup: PTT writes line breaks as they are. */
function htmlText(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}

/** `html` without its `<div class="richcontent">` blocks (a picture's or a video's preview), nested divs and all. */
function withoutRichContent(html: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = html.indexOf('<div class="richcontent"', from);
    if (start < 0) return out + html.slice(from);
    out += html.slice(from, start);
    let depth = 0;
    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = start;
    let end = html.length;
    for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    from = end;
  }
}

/** `Thu Oct 15 21:47:25 2026`, Taiwan time, as epoch ms; 0 for anything else. */
export function parsePttTime(value: string): number {
  const found = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(value.trim());
  const month = found ? MONTHS[found[1]] : undefined;
  if (!found || month === undefined) return 0;
  return Date.UTC(Number(found[6]), month, Number(found[2]), Number(found[3]), Number(found[4]), Number(found[5])) - TAIPEI_OFFSET_MS;
}

function taipeiYear(ms: number): number {
  return new Date(ms + TAIPEI_OFFSET_MS).getUTCFullYear();
}

/** The four header pairs (author, board, title, time), by their tag, and where the text after them starts. */
function readMeta(html: string, from: number): { meta: Map<string, string>; end: number } {
  const meta = new Map<string, string>();
  const pairs = /<div class="article-metaline(?:-right)?"><span class="article-meta-tag">([\s\S]*?)<\/span><span class="article-meta-value">([\s\S]*?)<\/span><\/div>/g;
  pairs.lastIndex = from;
  let end = from;
  for (let pair = pairs.exec(html); pair; pair = pairs.exec(html)) {
    // Only the header: a pair further down is not the article's.
    if (pair.index > end + 200 && meta.size > 0) break;
    meta.set(htmlText(pair[1]).trim(), htmlText(pair[2]).trim());
    end = pair.index + pair[0].length;
  }
  return { meta, end };
}

/** Where the article's own text stops: the system's lines, or the first push. */
function bodyEnd(html: string, from: number): number {
  const marks = [/<span class="f2">※ (?:發信站|文章網址|編輯)/g, /<div class="push/g, /<div id="article-polling"/g];
  let end = html.length;
  for (const mark of marks) {
    mark.lastIndex = from;
    const found = mark.exec(html);
    if (found) end = Math.min(end, found.index);
  }
  return end;
}

/** The text without its signature: from a `--` line with little after it, as often as there is one. */
function withoutSignature(text: string): string {
  let lines = text.split('\n');
  for (;;) {
    let mark = lines.length - 1;
    while (mark >= 0 && lines[mark].trim() !== '--') mark--;
    if (mark < 0 || lines.length - mark > SIGNATURE_MAX_LINES + 1) break;
    lines = lines.slice(0, mark);
  }
  return lines.join('\n');
}

function spanText(html: string, name: string, until: RegExp | null = null): string {
  const start = new RegExp(`<span class="[^"]*\\b${name}\\b[^"]*">`).exec(html);
  if (!start) return '';
  const rest = html.slice(start.index + start[0].length);
  const stop = until ? until.exec(rest)?.index ?? rest.indexOf('</span>') : rest.indexOf('</span>');
  return htmlText(stop < 0 ? rest : rest.slice(0, stop));
}

const PUSH_TAGS = new Set(['推', '噓', '→']);

/**
 * Every push in order, with its time in epoch ms. The page gives `MM/DD HH:mm` with no year:
 * the year starts as the article's and moves on when a push's date falls more than a day before
 * the one above it (pushes are in order, so that is the new year).
 */
export function readPushes(html: string, createdAt: number): PushLine[] {
  const out: PushLine[] = [];
  let year = createdAt ? taipeiYear(createdAt) : 0;
  let previous = createdAt;
  for (const [, inner] of html.matchAll(/<div class="push">([\s\S]*?)<\/div>/g)) {
    const tag = spanText(inner, 'push-tag').trim();
    if (!PUSH_TAGS.has(tag)) continue;
    const user = spanText(inner, 'push-userid').trim();
    const text = spanText(inner, 'push-content', /<\/span>\s*<span class="push-ipdatetime"/).replace(/^:\s?/, '').trim();
    const stamp = /(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?\s*$/.exec(spanText(inner, 'push-ipdatetime').trim());
    let at = 0;
    if (stamp && year) {
      const parts = [Number(stamp[1]) - 1, Number(stamp[2]), Number(stamp[3] ?? 0), Number(stamp[4] ?? 0)] as const;
      at = Date.UTC(year, ...parts) - TAIPEI_OFFSET_MS;
      if (at < previous - DAY_MS) {
        year += 1;
        at = Date.UTC(year, ...parts) - TAIPEI_OFFSET_MS;
      }
      previous = at;
    }
    out.push({ tag: tag as PushLine['tag'], user, text, at });
  }
  return out;
}

/**
 * Where PTT says the article was posted from: the system line's origin, or the first edit line's
 * when an edit took that line out. `html` is the page after the article's text, so a quoted
 * article's lines are not read.
 */
export function readPostedFrom(html: string): string {
  const posted = /※ 發信站:[^\n<]*?來自: [\d.:a-fA-F]+ \(([^)\n<]+)\)/.exec(html);
  if (posted) return htmlText(posted[1]).trim();
  const edited = /※ 編輯: \S+ \([\d.:a-fA-F]+ ([^)\n<]+)\)/.exec(html);
  return edited ? htmlText(edited[1]).trim() : '';
}

/** `id (nickname)`, the nickname optional. */
function splitAuthor(value: string): { author: string; nickname: string } {
  const found = /^(\S+)(?:\s+\((.*)\))?$/.exec(value.trim());
  return found ? { author: found[1], nickname: (found[2] ?? '').trim() } : { author: value.trim(), nickname: '' };
}

/** The article on a PTT page; null when the page holds none (a 404, a gate, a changed page). */
export function readPttArticle(html: string): PttArticle | null {
  const open = /<div id="main-content"[^>]*>/.exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  const { meta, end } = readMeta(html, from);
  const stop = bodyEnd(html, end);
  const text = tidy(withoutSignature(htmlText(withoutRichContent(html.slice(end, stop)))));
  const { author, nickname } = splitAuthor(meta.get('作者') ?? '');
  const createdAt = parsePttTime(meta.get('時間') ?? '');
  if (!author && !text) return null;
  return {
    author,
    nickname,
    board: meta.get('看板') ?? '',
    title: meta.get('標題') ?? '',
    createdAt,
    body: text,
    images: imagesIn(text),
    pushes: readPushes(html.slice(stop), createdAt),
    from: readPostedFrom(html.slice(stop)),
  };
}

export interface PushTally {
  push: number;
  boo: number;
  arrow: number;
}

export function tallyPushes(lines: readonly PushLine[]): PushTally {
  return {
    push: lines.filter((l) => l.tag === '推').length,
    boo: lines.filter((l) => l.tag === '噓').length,
    arrow: lines.filter((l) => l.tag === '→').length,
  };
}

/** The app-language string for a key, its `{{name}}` filled in. */
export type Phrase = (key: string, vars: Record<string, string>) => string;

function photo(image: PttImage): XMedia {
  return { kind: 'photo', image: image.url, width: 0, height: 0, durationMs: 0, variants: [], ...(image.copies ? { copies: image.copies } : {}) };
}

/**
 * The article's opening block, one line each: the title in bold; who, the board, when and from
 * where; the tally. Telegram and LINE show these words; the desktop chat draws `card` instead.
 */
export function pttHeading(card: PostCard, phrase: Phrase): string {
  const who = card.name ? phrase('ptt.author', { name: card.name, id: card.author }) : card.author;
  const flag = flagEmoji(pttRegionCode(card.from));
  const byline = [
    who,
    card.board ? phrase('ptt.board', { board: card.board }) : '',
    formatPostTime(card.at),
    [flag, card.from].filter(Boolean).join(' '),
  ].filter(Boolean).map(escapePostMarkdown).join(phrase('ptt.separator', {}));
  const tally = phrase('ptt.tally', { push: String(card.push), boo: String(card.boo), arrow: String(card.arrow) });
  return [card.title ? `**${escapePostMarkdown(card.title)}**` : '', byline, tally].filter(Boolean).join('\n');
}

/**
 * The article as a post to forward: its header (`heading`, and `card` for the desktop chat) and
 * its text, the pictures sent as themselves and taken out of the text — only the pushes' tally is
 * forwarded, not the list. `link` is the article on www.ptt.cc.
 */
export function pttPost(article: PttArticle, images: readonly PttImage[], id: string, link: string, phrase: Phrase): XPost {
  const tally = tallyPushes(article.pushes);
  const card: PostCard = {
    title: article.title,
    board: article.board,
    author: article.author,
    name: article.nickname,
    at: article.createdAt,
    from: article.from,
    ...tally,
  };
  return {
    id,
    author: article.author,
    name: article.nickname,
    createdAt: article.createdAt,
    text: withoutImageLinks(article.body, images),
    heading: pttHeading(card, phrase),
    card,
    link,
    image: images[0]?.url ?? '',
    replyCount: article.pushes.length,
    likeCount: tally.push,
    inReplyTo: '',
    isRepost: false,
    media: images.map(photo),
    quoteMedia: [],
  };
}

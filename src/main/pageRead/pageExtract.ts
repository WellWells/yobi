/**
 * One page's text, from its HTML: no network, no Electron. An article has three sources, best
 * first: the outlet's own text container (`shared/pageSites.ts`), the page's JSON-LD `articleBody`,
 * the reader view. The reader view alone can keep a related-story stream (Yahoo, Storm) or pick a
 * fragment (EBC); JSON-LD alone is an excerpt on CTEE, CTWANT, Storm and LINE TODAY.
 *
 * A page with no row says what it is. A discussion is read whole, its replies being the content
 * (Stack Overflow's reader view keeps the accepted answer and loses the question). A page
 * that calls itself an article is read as one, past the reader view's own check, which said no to
 * LTN, TVBS and Business Today. Anything else gets that check, and what fails it is read whole, so
 * a list or a documentation index still gives its text.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { PageSite } from '../../shared/pageSites';
import { readArticle } from '../search/articleReader';
import { MIN_ARTICLE_CHARS, isDiscussionPage } from '../search/pageText';
import { extractPublishedAt } from '../search/publishedAt';
import { MAX_CONTENT_CHARS, parseHtml } from '../urlParser';

/** Short breaking news is real: Newtalk ran a 102-character item. Below this a match is a caption. */
const MIN_BODY_CHARS = 60;
/** JSON-LD shorter than this share of the reader view's text is an excerpt, not the article. */
const EXCERPT_RATIO = 0.6;
const MIN_HEADING_CHARS = 6;

const NEVER_TEXT = 'script, style, noscript, iframe, figure, figcaption, form, button, svg, video, audio';
const BLOCKS = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr, section, article';

/** Lines an outlet adds to every article: app and follow prompts, reprint notices, ad markers. */
const BOILERPLATE_LINE: readonly RegExp[] = [
  /^※\s*歡迎用「轉貼」/,
  /^(?:不用抽\s*)?不用搶\s*現在用APP看新聞/,
  /^(?:點我|按我)(?:下載|看|加)/,
  /^請繼續往下閱讀/,
  /^廣告\s*(?:[/／]\s*請繼續往下閱讀)?$/,
  /^(?:看更多|更多|延伸閱讀|相關新聞|今日熱門新聞)[！!：:]?$/,
  /^更多風傳媒獨家內幕[：:]?$/,
  /^更多新聞(?:請搜尋|[：:])/,
  /^將工商時報加入Google偏好來源$/,
  /^本網站之文字、圖片及影音，非經授權/,
  /^聽新聞\b/,
];

/** How the text was found; anything but `site` on a row with a `body` means that selector missed. */
export type PageReadMethod = 'site' | 'structured data' | 'reader view' | 'discussion' | 'whole page' | 'plain text';

export interface PageText {
  title: string;
  /** Who wrote it, as the page says; empty when it does not. */
  author: string;
  /** The page's own publication date; empty when it gives none. */
  publishedAt: string;
  text: string;
  /** The page says it is for subscribers: `text` may be its public opening only. */
  preview: boolean;
  method: PageReadMethod;
  /** The name the page gives itself, for a site the table has no row for. */
  siteName: string;
  /** The page went on past `MAX_CONTENT_CHARS`. */
  truncated: boolean;
}

interface PageBody {
  text: string;
  method: PageReadMethod;
  truncated?: boolean;
}

interface StructuredArticle {
  headline: string;
  body: string;
  author: string;
  subscriberOnly: boolean;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function authorName(value: unknown): string {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string') return first.trim();
  return first && typeof first === 'object' ? asText((first as { name?: unknown }).name) : '';
}

function isArticleNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).some((entry) => typeof entry === 'string' && /Article|BlogPosting|Report/.test(entry));
}

/** Every object in a JSON-LD block, `@graph` and `mainEntity` nesting included. */
function structuredNodes(root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
    } else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      found.push(record);
      pending.push(record['@graph'], record.mainEntity, record.mainEntityOfPage);
    }
  }
  return found;
}

function structuredArticle($: CheerioAPI): StructuredArticle | null {
  let best: StructuredArticle | null = null;
  $('script[type="application/ld+json"]').each((_, script) => {
    let parsed: unknown;
    try {
      // Raw line breaks inside strings are common here and invalid JSON.
      parsed = JSON.parse($(script).text().replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return;
    }
    for (const node of structuredNodes(parsed).filter(isArticleNode)) {
      const article: StructuredArticle = {
        headline: asText(node.headline),
        body: asText(node.articleBody),
        author: authorName(node.author),
        subscriberOnly: String(node.isAccessibleForFree).toLowerCase() === 'false',
      };
      if (!best || article.body.length > best.body.length) best = article;
    }
  });
  return best;
}

function cleanText(raw: string): string {
  const lines = raw
    .replace(/[ \t 　]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !BOILERPLATE_LINE.some((pattern) => pattern.test(line)));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The readable text of one element, paragraphs on their own lines. */
function textOf($: CheerioAPI, element: AnyNode, drop?: string): string {
  const copy = $(element).clone();
  copy.find(drop ? `${NEVER_TEXT}, ${drop}` : NEVER_TEXT).remove();
  copy.find('br').replaceWith('\n');
  copy.find(BLOCKS).each((_, block) => {
    $(block).append('\n\n');
  });
  return cleanText(copy.text());
}

function siteBody($: CheerioAPI, site: PageSite | null): string {
  for (const selector of site?.body ?? []) {
    try {
      const texts = $(selector).toArray().map((element) => textOf($, element, site?.drop));
      const longest = texts.reduce((best, text) => (text.length > best.length ? text : best), '');
      if (longest.length >= MIN_BODY_CHARS) return longest;
    } catch {
      // A row the page's markup trips up is a row that missed: the next way of reading takes over.
    }
  }
  return '';
}

/** Firefox's reader view. `isArticle`: the page is known to be one, so its own check is skipped. */
function readerBody(html: string, isArticle: boolean): string {
  try {
    const content = readArticle(html, { skipArticleCheck: isArticle })?.content;
    if (!content) return '';
    const $ = load(`<body>${content}</body>`);
    const body = $('body').get(0);
    return body ? textOf($, body) : '';
  } catch {
    return '';
  }
}

function pageTitle($: CheerioAPI, structured: StructuredArticle | null): string {
  // A heading is the title without the outlet's name that `headline` and og:title often add. A
  // short one is the site's logo.
  const heading = $('h1').first().text().trim();
  const named = structured?.headline || asText($('meta[property="og:title"]').attr('content'));
  if (named) return heading && named.startsWith(heading) ? heading : named;
  return heading.length >= MIN_HEADING_CHARS ? heading : $('title').first().text().trim();
}

function articleBody($: CheerioAPI, html: string, site: PageSite | null, structured: StructuredArticle | null): PageBody {
  const fromSite = siteBody($, site);
  if (fromSite) return { text: fromSite, method: 'site' };
  const fromReader = readerBody(html, true);
  const fromData = cleanText(structured?.body ?? '');
  return fromData.length < fromReader.length * EXCERPT_RATIO
    ? { text: fromReader, method: 'reader view' }
    : { text: fromData, method: 'structured data' };
}

function wholePage(html: string, url: string, discussion: boolean): PageBody {
  const { cleanedText, truncated } = parseHtml(html, url, { blockBreaks: true, discussion });
  return { text: cleanText(cleanedText), method: discussion ? 'discussion' : 'whole page', truncated };
}

function callsItselfArticle($: CheerioAPI, structured: StructuredArticle | null): boolean {
  return structured !== null || asText($('meta[property="og:type"]').attr('content')).toLowerCase() === 'article';
}

/** A page with no row, read by what it says about itself. */
function bodyByItsOwnAccount($: CheerioAPI, html: string, url: string, structured: StructuredArticle | null): PageBody {
  if (isDiscussionPage(html, url)) return wholePage(html, url, true);
  if (callsItselfArticle($, structured)) {
    const article = articleBody($, html, null, structured);
    return article.text.length >= MIN_BODY_CHARS ? article : wholePage(html, url, false);
  }
  const text = readerBody(html, false);
  return text.length >= MIN_ARTICLE_CHARS ? { text, method: 'reader view' } : wholePage(html, url, false);
}

function withinCap(page: PageText): PageText {
  if (page.text.length <= MAX_CONTENT_CHARS) return page;
  return { ...page, text: page.text.slice(0, MAX_CONTENT_CHARS), truncated: true };
}

/** A page's text, or null when it holds next to none (an app shell, an empty page). */
export function extractPageText(html: string, url: string, site: PageSite | null): PageText | null {
  const $ = load(html);
  const structured = structuredArticle($);
  const body = site ? articleBody($, html, site, structured) : bodyByItsOwnAccount($, html, url, structured);
  if (body.text.length < MIN_BODY_CHARS) return null;
  return withinCap({
    title: pageTitle($, structured),
    author: structured?.author ?? '',
    publishedAt: extractPublishedAt(html),
    text: body.text,
    preview: structured?.subscriberOnly ?? false,
    method: body.method,
    siteName: asText($('meta[property="og:site_name"]').attr('content')),
    truncated: body.truncated === true,
  });
}

/** A link that serves text or Markdown: there is no page around it to take away. */
export function extractPlainText(raw: string, url: string): PageText | null {
  const text = raw.trim();
  if (text.length < MIN_BODY_CHARS) return null;
  const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  return withinCap({
    title: heading ?? new URL(url).pathname.split('/').filter(Boolean).pop() ?? url,
    author: '',
    publishedAt: '',
    text,
    preview: false,
    method: 'plain text',
    siteName: '',
    truncated: false,
  });
}

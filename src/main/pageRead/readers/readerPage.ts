import { textOf } from '../pageExtract';
import { load } from 'cheerio';
import { MAX_CONTENT_CHARS } from '../../urlParser';
import type { PageRead } from '../pageReader';

export interface ReaderReply {
  author: string;
  date: string;
  text: string;
}

export interface ReaderPost {
  title: string;
  author: string;
  publishedAt: string;
  siteName: string;
  url: string;
  /** The post itself. */
  text: string;
  replies?: readonly ReaderReply[];
  replyCount?: number;
  images?: readonly string[];
}

/** One run of replies is enough to read the mood, and the page may have thousands. */
const MAX_REPLIES = 40;

function replyBlock({ author, date, text }: ReaderReply): string {
  const heading = [author ? `**${author}**` : '', date].filter(Boolean).join(' · ');
  return heading ? `${heading}\n${text}` : text;
}

/** What a reader found, as a read: the post whole, its replies after it for the analysis. */
export function readerPage(post: ReaderPost): PageRead {
  const replies = (post.replies ?? []).slice(0, MAX_REPLIES).map(replyBlock);
  const whole = [post.text, ...replies].join('\n\n');
  return {
    title: post.title,
    author: post.author,
    publishedAt: post.publishedAt,
    text: whole.slice(0, MAX_CONTENT_CHARS),
    preview: false,
    method: 'discussion',
    siteName: post.siteName,
    truncated: whole.length > MAX_CONTENT_CHARS,
    selfDeclared: true,
    site: post.siteName,
    url: post.url,
    complete: true,
    images: post.images ?? [],
    mainText: post.text,
    ...(post.replyCount === undefined ? {} : { replyCount: post.replyCount }),
  };
}

/** The page's JSON-LD nodes, top level and in `@graph`; a block that does not parse is skipped. */
export function jsonLdNodes(html: string): Array<Record<string, unknown>> {
  const $ = load(html);
  return $('script[type="application/ld+json"]').toArray().flatMap((script) => {
    try {
      const parsed: unknown = JSON.parse($(script).text());
      const top = Array.isArray(parsed) ? parsed : [parsed];
      return top.flatMap((node: Record<string, unknown>) => (Array.isArray(node?.['@graph']) ? node['@graph'] as Array<Record<string, unknown>> : [node]));
    } catch {
      return [];
    }
  });
}

/** What an API's HTML field says, as text. */
export function htmlText(html: string): string {
  const $ = load(`<section>${html}</section>`, null, false);
  const wrapper = $('section').get(0);
  return wrapper ? textOf($, wrapper) : '';
}

function countIn(node: Record<string, unknown>): number | undefined {
  const direct = Number(node.commentCount ?? node.answerCount);
  if (Number.isFinite(direct)) return direct;
  const stats = Array.isArray(node.interactionStatistic) ? node.interactionStatistic as Array<Record<string, unknown>> : [];
  const replies = stats.find((stat) => /Comment|Reply/.test(String(stat.interactionType)));
  const counted = Number(replies?.userInteractionCount);
  return replies && Number.isFinite(counted) ? counted : undefined;
}

/** How many replies the page's JSON-LD says the thread has, on it or on its `mainEntity`. */
export function commentCountOf(nodes: ReadonlyArray<Record<string, unknown>>): number | undefined {
  for (const node of nodes) {
    const count = countIn(node) ?? countIn((node.mainEntity ?? {}) as Record<string, unknown>);
    if (count !== undefined) return count;
  }
  return undefined;
}

/** The addresses on one of the reader's own media hosts: a page may name a picture anywhere. */
export function imagesOn(hosts: readonly string[], addresses: readonly unknown[]): string[] {
  return addresses.filter((address): address is string => {
    if (typeof address !== 'string') return false;
    try {
      const url = new URL(address);
      return url.protocol === 'https:' && hosts.includes(url.hostname);
    } catch {
      return false;
    }
  });
}

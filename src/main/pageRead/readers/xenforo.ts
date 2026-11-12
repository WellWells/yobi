import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { textOf } from '../pageExtract';
import type { PageSiteReader } from './index';
import { commentCountOf, jsonLdNodes, readerPage } from './readerPage';

const QUOTED = '.bbCodeBlock--quote';

function bodyOf($: CheerioAPI, post: Cheerio<Element>, drop?: string): string {
  // Under `.message-body`: a signature has a `.bbWrapper` of its own.
  const body = post.find('.message-body .bbWrapper').get(0);
  return body ? textOf($, body, drop) : '';
}

function dateOf(post: Cheerio<Element>): string {
  return post.find('.message-attribution time.u-dt, time.u-dt').first().attr('datetime')?.slice(0, 10) ?? '';
}

/** Any XenForo forum's thread page. A later page of a thread does not start with the thread's own post. */
export const xenforoReader: PageSiteReader = {
  matches: (_url, html) => /\bdata-template="thread_view"/.test(html) && /\bdata-xf="/.test(html),
  read(html, url) {
    const $ = load(html);
    const posts = $('article.message--post');
    const first = posts.first();
    if (!first.hasClass('message-threadStarterPost')) return null;
    const text = bodyOf($, first);
    if (!text) return null;
    const count = commentCountOf(jsonLdNodes(html));
    return readerPage({
      title: $('h1.p-title-value').first().text().trim() || $('h1').first().text().trim(),
      author: first.attr('data-author') ?? '',
      publishedAt: dateOf(first),
      siteName: $('meta[property="og:site_name"]').attr('content') ?? new URL(url).hostname,
      url,
      text,
      replies: posts.slice(1).toArray().map((node) => {
        const post = $(node);
        return { author: post.attr('data-author') ?? '', date: dateOf(post), text: bodyOf($, post, QUOTED) };
      }).filter((reply) => reply.text),
      ...(count === undefined ? {} : { replyCount: count }),
    });
  },
};

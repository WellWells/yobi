import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { textOf } from '../pageExtract';
import type { PageSiteReader } from './index';
import { commentCountOf, jsonLdNodes, readerPage } from './readerPage';

/** What the other posts quote: said again above each of them. */
const QUOTED = 'aside.quote';

function dateOf(post: Cheerio<Element>): string {
  return post.find('time.post-time').first().attr('datetime')?.slice(0, 10) ?? '';
}

function authorOf(post: Cheerio<Element>): string {
  return post.find('[itemprop="author"] [itemprop="name"]').first().text().trim();
}

function bodyOf($: CheerioAPI, post: Cheerio<Element>, drop?: string): string {
  const body = post.find('[itemprop="text"]').get(0);
  return body ? textOf($, body, drop) : '';
}

/** Any Discourse forum: it serves every visitor the same plain page of the topic's posts. */
export const discourseReader: PageSiteReader = {
  matches: (url, html) => url.pathname.startsWith('/t/') && /<meta name="generator" content="Discourse /.test(html),
  read(html, url) {
    // The posts sit in a `<noscript>`, which is plain text to a parser that runs scripts.
    const $ = load(html, { scriptingEnabled: false });
    // A link to a later post opens the page it is on: the topic's first post is not there.
    const first = $('#post_1');
    const text = first.length ? bodyOf($, first) : '';
    if (!text) return null;
    const count = commentCountOf(jsonLdNodes(html));
    return readerPage({
      title: $('#topic-title h1').first().text().trim() || ($('meta[property="og:title"]').attr('content') ?? ''),
      author: authorOf(first),
      publishedAt: dateOf(first),
      siteName: $('meta[property="og:site_name"]').attr('content') ?? new URL(url).hostname,
      url,
      text,
      replies: $('.crawler-post[id^="post_"]').not('#post_1').toArray().map((node) => {
        const post = $(node);
        return { author: authorOf(post), date: dateOf(post), text: bodyOf($, post, QUOTED) };
      }).filter((reply) => reply.text),
      ...(count === undefined ? {} : { replyCount: count }),
    });
  },
};

import { load } from 'cheerio';
import { textOf } from '../pageExtract';
import type { PageSiteReader } from './index';
import { readerPage } from './readerPage';

/** A topic on Mobile01. The opening post is its own kind of article; a later page has none. */
export const mobile01Reader: PageSiteReader = {
  matches: (url) => /^(?:www|m)\.mobile01\.com$/.test(url.hostname) && url.pathname === '/topicdetail.php',
  read(html, url) {
    const $ = load(html);
    const opening = $('article.topic_article [itemprop="articleBody"]').get(0);
    const text = opening ? textOf($, opening) : '';
    if (!text) return null;
    const page = $(opening).closest('.l-articlePage');
    const dateIn = (node: typeof page): string => node.find('.l-navigation__item .o-fNotes').first().text().trim().slice(0, 10);
    return readerPage({
      title: $('h1').first().text().trim(),
      author: page.find('.c-authorInfo__id a').first().text().trim(),
      publishedAt: dateIn(page),
      siteName: 'Mobile01',
      url,
      text,
      replies: $('article[id^="article_"]').not('.topic_article').toArray().map((node) => {
        const id = $(node).attr('id')?.slice('article_'.length) ?? '';
        return {
          author: $(`#name_${id}`).first().text().trim(),
          date: dateIn($(node).closest('.l-articlePage')),
          text: textOf($, node, 'blockquote'),
        };
      }).filter((reply) => reply.text),
    });
  },
};

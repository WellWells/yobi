import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { textOf } from '../pageExtract';
import type { PageSiteReader } from './index';
import { readerPage } from './readerPage';

function bodyOf($: CheerioAPI, post: Cheerio<Element>): string {
  const body = post.find('.c-article__content').get(0);
  return body ? textOf($, body) : '';
}

function fieldsOf(post: Cheerio<Element>): { author: string; date: string } {
  return {
    author: post.find('.c-post__header__author .username').first().text().trim(),
    date: post.find('.edittime[data-mtime]').first().attr('data-mtime')?.slice(0, 10) ?? '',
  };
}

/** A thread on 巴哈姆特's forum. Each floor is a post; a later page does not start with floor 1. */
export const bahamutReader: PageSiteReader = {
  matches: (url) => url.hostname === 'forum.gamer.com.tw' && /^\/Co?\.php$/.test(url.pathname),
  read(html, url) {
    const $ = load(html);
    const posts = $('.c-section__main.c-post').filter((_, post) => $(post).find('.c-article__content').length > 0);
    const first = posts.first();
    if (first.find('[data-floor]').first().attr('data-floor') !== '1') return null;
    const text = bodyOf($, first);
    if (!text) return null;
    return readerPage({
      title: first.find('.c-post__header__title').first().text().trim() || $('h1').first().text().trim(),
      ...(({ author, date }) => ({ author, publishedAt: date }))(fieldsOf(first)),
      siteName: '巴哈姆特',
      url,
      text,
      replies: posts.slice(1).toArray().map((node) => {
        const post = $(node);
        return { ...fieldsOf(post), text: bodyOf($, post) };
      }).filter((reply) => reply.text),
    });
  },
};

import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { MAX_CONTENT_CHARS } from '../../urlParser';
import { textOf } from '../pageExtract';
import type { PageSiteReader } from './index';

/** Shorter than this is a stub, a redirect or a disambiguation list, not an article to forward. */
const MIN_ARTICLE_CHARS = 400;

/**
 * What a wiki puts around the article inside its own content: notices, the infobox, the contents,
 * galleries, the navigation boxes at the bottom, footnotes and the [edit] links. Fandom adds its
 * ads there too. A Fandom navbox on a Pokémon page alone is 48,000 characters of names.
 */
const AROUND_THE_ARTICLE = [
  '.mbox', '.ambox', '.hatnote', '.metadata', '.noprint', '.mw-empty-elt',
  '.infobox', '.portable-infobox', '.sidebar',
  '.toc', '#toc', '.mw-editsection',
  '.gallery', '.navbox', '.vertical-navbox',
  'sup.reference', '.references', '.reflist', '.mw-references-wrap', '.references-small',
  '.fandom-ad-wrapper',
].join(', ');

/**
 * Fandom's generated questions and answers, set in the article as a `<section>` with a class name
 * that changes. A section of the article itself starts with its heading (Parsoid); this one has
 * none, only collapsed `<details>`.
 */
function dropGeneratedAnswers($: CheerioAPI): void {
  $('.mw-parser-output > section').each((_, section) => {
    const node = $(section);
    if (node.find('details').length > 0 && node.children('h2, h3, h4, h5, h6').length === 0) node.remove();
  });
}

/**
 * The article's content. A site notice above it is parsed wiki text too (Wikipedia's comes first
 * in the page), so the one in the content area wins, and failing that the longest.
 */
function articleOf($: CheerioAPI): Element | undefined {
  const inContent = $('#mw-content-text .mw-parser-output').first().get(0);
  if (inContent) return inContent;
  return $('.mw-parser-output').toArray().reduce<Element | undefined>((best, node) => (
    !best || $(node).text().length > $(best).text().length ? node : best
  ), undefined);
}

function titleOf($: CheerioAPI): string {
  return $('#firstHeading').first().text().trim() || $('title').first().text().split(' | ')[0]?.trim() || '';
}

/**
 * An article on any MediaWiki site: Fandom, Wikipedia and every wiki that runs it. Its own content
 * holds the article and what the wiki builds around it; the general reader keeps both, and on a
 * long Fandom page the article is under a third of the 80,000 characters it keeps.
 */
export const mediawikiReader: PageSiteReader = {
  matches: (_url, html) => /<meta name="generator" content="MediaWiki /.test(html) && /<body[^>]*\baction-view\b/.test(html),
  read(html, url) {
    const $ = load(html);
    dropGeneratedAnswers($);
    const content = articleOf($);
    const whole = content ? textOf($, content, AROUND_THE_ARTICLE) : '';
    if (whole.length < MIN_ARTICLE_CHARS) return null;
    const text = whole.slice(0, MAX_CONTENT_CHARS);
    const truncated = whole.length > MAX_CONTENT_CHARS;
    const siteName = $('meta[property="og:site_name"]').attr('content') ?? new URL(url).hostname;
    return {
      title: titleOf($),
      author: '',
      publishedAt: '',
      text,
      preview: false,
      method: 'site',
      siteName,
      truncated,
      selfDeclared: true,
      site: siteName,
      url,
      complete: !truncated,
      images: [],
      mainText: text,
    };
  },
};

import { parseHTML } from 'linkedom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';

/**
 * Past this many elements a page is an app shell or an endless feed, and parsing it would hold the
 * main thread. Counted here, before any DOM is built: Readability's own `maxElemsToParse` counts
 * `getElementsByTagName('*')`, which linkedom answers with 0, so it never fires.
 */
const MAX_ELEMENTS = 20_000;

export interface Article {
  /** The page's own `<title>`, or empty. */
  title: string;
  /** The article's HTML, nothing around it. */
  content: string;
}

/** Opening tags in the markup: a `<` followed by a letter. */
function elementCount(html: string): number {
  let count = 0;
  for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at + 1)) {
    if (/[a-z]/i.test(html.charAt(at + 1))) count += 1;
  }
  return count;
}

/**
 * Firefox's reader view over one page: the article alone, without the menus, related posts,
 * comment forms and footers around it. Null when the page does not look like an article (a list,
 * a home page) — Readability would only guess there. `skipArticleCheck` is for a caller that already
 * knows the page is an article. Throws on a page too large to parse.
 */
export function readArticle(html: string, options?: { skipArticleCheck?: boolean }): Article | null {
  const elements = elementCount(html);
  if (elements > MAX_ELEMENTS) throw new Error(`${elements} elements`);
  const { document } = parseHTML(/^\s*(?:<!doctype|<html)/i.test(html) ? html : `<html>${html}</html>`);
  const doc = document as unknown as Document;
  if (!options?.skipArticleCheck && !isProbablyReaderable(doc)) return null;
  const title = doc.title.trim();
  const article = new Readability(doc).parse();
  return article?.content ? { title, content: article.content } : null;
}

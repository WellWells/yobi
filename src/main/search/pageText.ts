import { parseHtml } from '../urlParser';
import type { UrlParseResult } from '../urlParser';
import { sendLog } from '../helpers';

/*
 * On a discussion page the replies are the content, and a reader view keeps the opening post
 * alone: Reddit drops from 19,496 to 3,430 characters with every comment gone, Dcard from 2,722 to
 * 277, Mobile01 to its cookie notice. Such a page is read whole.
 *
 * A page that says what it is needs no list: the schema.org types a forum thread, a Q&A page or a
 * social post declare (Mobile01, Discourse, Stack Exchange). The hosts below declare none.
 */
const DISCUSSION_HOSTS: readonly string[] = [
  'ptt.cc', 'reddit.com', 'dcard.tw', 'mobile01.com', 'forum.gamer.com.tw', '5ch.net', 'news.ycombinator.com',
];
const DISCUSSION_MARKUP =
  /(?:"@type"\s*:\s*(?:\[[^\]]*?)?"|itemtype\s*=\s*["']https?:\/\/schema\.org\/)(?:DiscussionForumPosting|QAPage|SocialMediaPosting)\b/;

/** Shorter than this, the reader view picked a fragment (a cookie notice, a caption), not the article. */
export const MIN_ARTICLE_CHARS = 400;

export function isDiscussionPage(html: string, url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Not a URL: the markup alone decides.
  }
  if (DISCUSSION_HOSTS.some((site) => host === site || host.endsWith(`.${site}`))) return true;
  return DISCUSSION_MARKUP.test(html);
}

/**
 * A page's text as a source: an article through the reader view, so the menus, related posts and
 * footers around it do not take the room the sources have; anything else — a discussion, a list,
 * a page the reader view cannot read — whole, with only the page furniture removed.
 */
export async function readPageText(html: string, url: string): Promise<UrlParseResult> {
  if (isDiscussionPage(html, url)) return parseHtml(html, url, { blockBreaks: true, discussion: true });
  return await readArticleText(html, url) ?? parseHtml(html, url, { blockBreaks: true });
}

async function readArticleText(html: string, url: string): Promise<UrlParseResult | null> {
  try {
    // Loaded on the first page read, never on the boot path.
    const { readArticle } = await import('./articleReader');
    const article = readArticle(html);
    if (!article) return null;
    const parsed = parseHtml(article.content, url, { blockBreaks: true });
    if (parsed.cleanedText.length < MIN_ARTICLE_CHARS) return null;
    return { ...parsed, title: article.title || url };
  } catch (err) {
    sendLog(`🔎 [Search] reader view skipped ${url} (${err instanceof Error ? err.message : String(err)}) — reading the whole page`);
    return null;
  }
}

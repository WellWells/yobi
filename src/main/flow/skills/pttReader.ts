import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { assertPublicHttpUrl } from '../../net/ssrfGuard';
import { fetchRawResponse } from '../../pageLoader';
import { userAgentForUrl } from '../../userAgent';
import { PTT_HOST, parsePttUrl, pttArticleUrl } from '../../../shared/linkSites/pttLinks';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import { withoutImageLinks, type PttImage } from './pttImages';
import { pttPost, readPttArticle } from './pttPosts';
import type { XThread } from './xPosts';
import type { XRead } from './xReader';

/*
 * Reading a PTT article: one plain GET of the article on www.ptt.cc, the pushes on the same page,
 * with no cookie (not even over18) and no hidden window. Over18 boards are forwarded like any
 * other. The pictures, on any host the author linked, are never fetched with a Referer.
 */

const stayOnPtt = stayOnHosts('PTT', (host) => host === PTT_HOST);

/** The pictures whose host is a public address: a link in an article must not reach this network. */
async function publicImages(images: readonly PttImage[]): Promise<PttImage[]> {
  const checked = await Promise.all(images.map(async (image) => {
    try {
      await assertPublicHttpUrl(image.url);
      return image;
    } catch (err) {
      sendLog(`📰 [PTT] Picture skipped: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }));
  return checked.filter((image): image is PttImage => image !== null);
}

/**
 * The article, its pictures and every push; `value` null when the page held none (404 for one
 * deleted or never there). `signal` (a flow's Stop) aborts the request in flight. A forward and
 * an analysis read the same page: the pushes cost nothing extra.
 */
export async function readPttThread(url: string, signal?: AbortSignal): Promise<XRead<XThread>> {
  const link = parsePttUrl(url);
  if (!link) return { status: 400, value: null };
  const pageUrl = pttArticleUrl(link.board, link.id);
  const { status, text, finalUrl } = await fetchRawResponse(pageUrl, {
    headers: { 'User-Agent': userAgentForUrl(pageUrl), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnPtt,
    signal,
  });
  if (new URL(finalUrl, pageUrl).pathname.startsWith('/ask/')) {
    // The over18 question served by the site itself: not answered.
    sendLog(`📰 [PTT] The site asked before the article (${finalUrl}) — not answered`);
    return { status: 200, value: null };
  }
  if (status >= 400) return { status, value: null };
  const article = readPttArticle(text);
  if (!article) return { status, value: null };
  const images = await publicImages(article.images);
  const board = article.board || link.board;
  const strings = getLangCache();
  const focal = pttPost(article, images, link.id, pttArticleUrl(board, link.id), (key, vars) => t(strings, key, vars));
  sendLog(`📰 [PTT] Read ${board} ${link.id} — ${images.length} picture(s), ${article.pushes.length} push(es)`);
  const pushes = { board, title: article.title, body: withoutImageLinks(article.body, images), lines: article.pushes };
  return { status: 200, value: { focal, replies: [], pushes } };
}

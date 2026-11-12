import type { PageApiReader } from './api';
import { htmlText, imagesOn, readerPage } from './readerPage';

const MEDIA_HOSTS = ['img-s-msn-com.akamaized.net'] as const;
const ARTICLE_PATH = /^\/([a-z]{2}-[a-z]{2,4})\/.*\/ar-([A-Za-z0-9]+)\/?$/;

interface Detail {
  type?: string;
  title?: string;
  body?: string;
  publishedDateTime?: string;
  authors?: Array<{ name?: string }>;
  provider?: { name?: string };
  imageResources?: Array<{ url?: string }>;
}

/** Its pages draw the article from this one call, in a shadow tree a page's HTML does not show. */
export const msnReader: PageApiReader = {
  address(url) {
    const article = /^(?:www\.)?msn\.com$/.test(url.hostname) ? ARTICLE_PATH.exec(url.pathname) : null;
    return article ? `https://assets.msn.com/content/view/v2/Detail/${article[1]}/${article[2]}` : null;
  },
  read(answer, url) {
    const detail = answer as Detail;
    const text = detail.type === 'article' && detail.body ? htmlText(detail.body) : '';
    if (!text) return null;
    return readerPage({
      title: detail.title ?? '',
      author: detail.authors?.[0]?.name ?? '',
      publishedAt: detail.publishedDateTime?.slice(0, 10) ?? '',
      siteName: detail.provider?.name ?? 'MSN',
      url,
      text,
      images: imagesOn(MEDIA_HOSTS, (detail.imageResources ?? []).map((image) => image.url)),
    });
  },
};

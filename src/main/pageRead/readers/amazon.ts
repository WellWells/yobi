import { load, type CheerioAPI } from 'cheerio';
import { textOf } from '../pageExtract';
import type { PageRead } from '../pageReader';
import type { PageSiteReader } from './index';
import { readerPage } from './readerPage';

/** Amazon's own stores; a look-alike domain is not one of them. */
const STORE_HOST = /(?:^|\.)amazon\.(?:com|co\.jp|co\.uk|de|fr|it|es|ca|in|nl|se|pl|sg|ae|sa|eg|com\.au|com\.mx|com\.br|com\.tr|com\.be)$/;
const PRODUCT_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:[/?]|$)/;
/** Where a product's own price sits; elsewhere on the page are the prices of other products. */
const PRICE_BLOCKS = ['#corePrice_feature_div', '#corePriceDisplay_desktop_feature_div', '#corePrice_desktop', '#apex_desktop'];

function textIn($: CheerioAPI, selector: string): string {
  const element = $(selector).first().get(0);
  return element ? textOf($, element).trim() : '';
}

function priceOf($: CheerioAPI): string {
  for (const block of PRICE_BLOCKS) {
    const price = $(`${block} .a-price .a-offscreen`).first().text().trim();
    if (price) return price;
  }
  return '';
}

/**
 * The stars and how many rated it, as numbers only: the words around them follow the store's
 * language, and their order too (Japanese says "out of 5, 4.5"), so the stars come from the bare
 * number the page shows beside the icon.
 */
function ratingOf($: CheerioAPI): string {
  const stars = /\d+(?:[.,]\d+)?/.exec($('#acrPopover span[aria-hidden="true"]').first().text())?.[0] ?? '';
  const count = /\d[\d,.]*/.exec($('#acrCustomerReviewText').first().text())?.[0] ?? '';
  if (!stars) return '';
  return count ? `★ ${stars} (${count})` : `★ ${stars}`;
}

function bulletsOf($: CheerioAPI): string {
  return $('#feature-bullets li .a-list-item').toArray()
    .map((item) => textOf($, item).trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n');
}

/** A product's page on an Amazon store: its name, price, rating and what it says about itself. */
export function readAmazonProduct(html: string, url: string): PageRead | null {
  const $ = load(html);
  const name = textIn($, '#productTitle');
  const about = [bulletsOf($), textIn($, '#productDescription')].filter(Boolean).join('\n\n');
  if (!name || !about) return null;
  const text = [name, priceOf($), ratingOf($), about].filter(Boolean).join('\n\n');
  return readerPage({ title: name, author: '', publishedAt: '', siteName: 'Amazon', url, text });
}

/**
 * Amazon's product pages say nothing in JSON-LD; the page's own element ids, the same for years
 * and in every store, hold the product. A page whose price is drawn later goes without one.
 */
export const amazonReader: PageSiteReader = {
  matches: (url) => STORE_HOST.test(url.hostname) && PRODUCT_PATH.test(url.pathname),
  read: readAmazonProduct,
};

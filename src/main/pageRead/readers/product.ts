import { load, type CheerioAPI } from 'cheerio';
import { escapeRegExp } from '../../../shared/regex';
import type { PageRead } from '../pageReader';
import type { PageSiteReader } from './index';
import { htmlText, jsonLdNodes, readerPage } from './readerPage';

type JsonNode = Record<string, unknown>;

/** Cheap look before parsing: most pages have no product in their JSON-LD or Open Graph at all. */
const MAYBE_PRODUCT = /"@type"\s*:\s*(?:\[[^\]]*)?"product|product:price:amount/i;
const ARTICLE_TYPE = /Article|BlogPosting|Report|Review/i;
/** Open Graph's product types: `product` (IKEA), `og:product` (Costco), `product.item`. */
const OG_PRODUCT_TYPE = /^(?:og:)?product(?:\.item)?$/i;
const SEPARATORS = /^[\s,，、;；|｜-]+/;

interface Product {
  name: string;
  price: string;
  rating: string;
  brand: string;
  description: string;
  siteName: string;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function isNode(value: unknown): value is JsonNode {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isType(node: JsonNode, wanted: string): boolean {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).some((entry) => typeof entry === 'string' && entry.toLowerCase() === wanted);
}

function nameOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return isNode(value) ? stringOf(value.name) : '';
}

/** A product's offers; a product group's are its variants' (momo writes one per colour or size). */
function offersOf(node: JsonNode): JsonNode[] {
  const own = (Array.isArray(node.offers) ? node.offers : [node.offers]).filter(isNode);
  if (own.length) return own;
  const variants = Array.isArray(node.hasVariant) ? node.hasVariant.filter(isNode) : [];
  return variants.flatMap(offersOf);
}

function amountOf(value: unknown): number {
  const text = stringOf(value).replace(/,/g, '');
  return text ? Number(text) : Number.NaN;
}

function shown(amount: number): string {
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** What the product costs as the page says it: `TWD 1,199`, or the lowest to the highest of several offers. */
function priceLine(offers: readonly JsonNode[]): string {
  const amounts = offers.flatMap((offer) => [offer.price, offer.lowPrice, offer.highPrice].map(amountOf))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  if (!amounts.length) return '';
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const price = low === high ? shown(low) : `${shown(low)}–${shown(high)}`;
  return [stringOf(offers[0].priceCurrency), price].filter(Boolean).join(' ');
}

function ratingLine(rating: unknown): string {
  if (!isNode(rating)) return '';
  const value = amountOf(rating.ratingValue);
  if (!Number.isFinite(value)) return '';
  const count = [rating.reviewCount, rating.ratingCount].map(amountOf).find(Number.isFinite);
  return count === undefined ? `★ ${shown(value)}` : `★ ${shown(value)} (${shown(count)})`;
}

/** The product's name without the shop's own name after it, as some write the title. */
function productName(name: string, shopNames: readonly string[]): string {
  const parts = name.split(/\s+[|｜]\s+/);
  const last = parts[parts.length - 1];
  const isShop = shopNames.some((shop) => shop && shop.startsWith(last));
  return parts.length > 1 && isShop ? parts.slice(0, -1).join(' | ') : name;
}

/**
 * A description as text: some shops write it as HTML, some open it with the product's name again
 * and close it with their own name and a run of keywords (PChome's "…,PChome 24h購物,多元支付,…").
 */
function descriptionOf(value: unknown, name: string, siteName: string): string {
  const raw = stringOf(value);
  let text = (/<[a-z][^>]*>/i.test(raw) ? htmlText(raw) : raw).trim();
  if (name && text.startsWith(name)) text = text.slice(name.length).replace(SEPARATORS, '');
  const shopAt = siteName ? text.search(new RegExp(`[,，]\\s*${escapeRegExp(siteName)}(?:[,，]|$)`)) : -1;
  return (shopAt > 0 ? text.slice(0, shopAt) : text).replace(SEPARATORS, '').trim();
}

/** Every value a page gives an Open Graph tag: momo writes `og:type` twice, as `property` and as `name`. */
function metaValues($: CheerioAPI, property: string): string[] {
  return $(`meta[property="${property}"], meta[name="${property}"]`).toArray()
    .map((meta) => ($(meta).attr('content') ?? '').trim())
    .filter(Boolean);
}

function metaOf($: CheerioAPI, property: string): string {
  return metaValues($, property)[0] ?? '';
}

/** The page's one product: a product group (its variants together) or a single product; several are a listing. */
function productNode(nodes: readonly JsonNode[]): JsonNode | null {
  const groups = nodes.filter((node) => isType(node, 'productgroup'));
  if (groups.length) return groups.length === 1 ? groups[0] : null;
  const products = nodes.filter((node) => isType(node, 'product'));
  // A crowdfunding project writes one per reward: no one product.
  return products.length === 1 ? products[0] : null;
}

function fromJsonLd(nodes: readonly JsonNode[], ownName: string): Product | null {
  const product = productNode(nodes);
  if (!product) return null;
  const offers = offersOf(product);
  // The seller's name before the page's: Yahoo's site name is a slogan.
  const seller = nameOf(offers[0]?.seller);
  const siteName = seller || ownName;
  const name = productName(stringOf(product.name), [seller, ownName]);
  return {
    name,
    price: priceLine(offers),
    rating: ratingLine(product.aggregateRating),
    brand: nameOf(product.brand),
    description: descriptionOf(product.description, name, siteName),
    siteName,
  };
}

/** Open Graph's product tags, for a shop that writes no JSON-LD (IKEA). */
function fromOpenGraph($: CheerioAPI, ownName: string): Product | null {
  const types = metaValues($, 'og:type');
  if (!types.some((type) => OG_PRODUCT_TYPE.test(type)) || types.some((type) => /article/i.test(type))) return null;
  const name = productName(metaOf($, 'og:title'), [ownName]);
  return {
    name,
    price: priceLine([{ priceCurrency: metaOf($, 'product:price:currency'), price: metaOf($, 'product:price:amount') }]),
    rating: '',
    brand: metaOf($, 'product:brand'),
    description: descriptionOf(metaOf($, 'og:description'), name, ownName),
    siteName: ownName,
  };
}

/** One product's page as what it is and what it costs, from the page's own tags; null for any other page. */
export function readProduct(html: string, url: string): PageRead | null {
  if (!MAYBE_PRODUCT.test(html)) return null;
  const nodes = jsonLdNodes(html);
  // A review or a story about a product is an article, and the general reader's.
  if (nodes.some((node) => [node['@type']].flat().some((type) => typeof type === 'string' && ARTICLE_TYPE.test(type)))) return null;
  const $ = load(html);
  const ownName = metaOf($, 'og:site_name');
  const product = fromJsonLd(nodes, ownName) ?? fromOpenGraph($, ownName);
  if (!product?.name || !product.price) return null;
  const text = [product.name, product.price, product.rating, product.description].filter(Boolean).join('\n\n');
  const siteName = product.siteName || new URL(url).hostname;
  return readerPage({ title: product.name, author: product.brand, publishedAt: '', siteName, url, text });
}

/**
 * A shop's product page: its name, price, rating and description, as the page's JSON-LD `Product`
 * (or `ProductGroup`) or its Open Graph product tags give them. Any site's page can be one, so the
 * look is cheap and a page that is not one is the general reader's. No pictures: the pages name
 * image hosts of their own choosing.
 */
export const productReader: PageSiteReader = {
  matches: (_url, html) => MAYBE_PRODUCT.test(html),
  read: readProduct,
};

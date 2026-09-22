import { load } from 'cheerio';
import { PROVIDER_URLS } from '../shared/types';
import type { FeedCandidate } from '../shared/types';
import { loadPageHtml, fetchRawText, ensureHttpScheme } from './pageLoader';
import { runParserBlocks, runCssSelector, parseRssFeed, extractFeedLinks } from './parserBlocks';
import type { ParserBlock, ParserBlockType, RssFeedItem } from './parserBlocks';
import { isYoutubeUrl, fetchYoutubeVideo } from './youtubeTranscript';
import { isMapsUrl, fetchMapReviews } from './mapReviews';
import { fetchPlaceStats, localizedVerdict } from './mapPlaceStats';
import { mapReviewsPrompt } from '../shared/mapReviewsPrompt';
import { config } from './config';

export { fetchRawText, ensureHttpScheme, runParserBlocks, runCssSelector, parseRssFeed, extractFeedLinks };
export type { ParserBlock, ParserBlockType, RssFeedItem };

const MAX_CONTENT_CHARS = 80_000;

export interface UrlParseResult {
  title: string;
  url: string;
  cleanedText: string;
  truncated: boolean;
  image?: string;
}

export interface FetchAndParseOptions {
  rawHtml?: boolean;
  bodyText?: boolean;
  xmlMode?: boolean;
  parserBlocks?: ParserBlock[];
  maxChars?: number;
}

export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function feedTitle(rawXml: string): string {
  try {
    const $ = load(rawXml, { xmlMode: true });
    return ($('channel > title').first().text() || $('feed > title').first().text() || '').trim();
  } catch {
    return '';
  }
}

const COMMON_FEED_PATHS = ['/feed/', '/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml'];

export async function discoverFeeds(siteUrl: string): Promise<FeedCandidate[]> {
  const trimmed = siteUrl.trim();
  if (!trimmed) return [];

  let raw: string;
  try {
    raw = await fetchRawText(trimmed);
  } catch {
    return probeCommonFeedPaths(trimmed);
  }

  if (parseRssFeed(raw).length > 0) {
    return [{ url: trimmed, title: feedTitle(raw) }];
  }

  const declared = extractFeedLinks(raw, trimmed);
  if (declared.length > 0) return declared;

  return probeCommonFeedPaths(trimmed);
}

async function probeCommonFeedPaths(siteUrl: string): Promise<FeedCandidate[]> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return [];
  }

  const probes = await Promise.allSettled(
    COMMON_FEED_PATHS.map(async (p): Promise<FeedCandidate> => {
      const url = new URL(p, origin).href;
      const candidate = await fetchRawText(url);
      if (parseRssFeed(candidate).length === 0) throw new Error('not a feed');
      return { url, title: feedTitle(candidate) };
    }),
  );

  for (const probe of probes) {
    if (probe.status === 'fulfilled') return [probe.value];
  }
  return [];
}

export async function fetchAndParse(url: string, options?: FetchAndParseOptions): Promise<UrlParseResult> {
  const html = await loadPageHtml(url);

  if (options?.parserBlocks && options.parserBlocks.length > 0) {
    const parserOutput = runParserBlocks(html, url, options.parserBlocks, options?.xmlMode);
    return { title: url, url, cleanedText: parserOutput, truncated: false };
  }

  if (options?.xmlMode) {
    const raw = html.length > MAX_CONTENT_CHARS ? html.slice(0, MAX_CONTENT_CHARS) : html;
    return { title: url, url, cleanedText: raw, truncated: html.length > MAX_CONTENT_CHARS };
  }

  if (options?.bodyText) return bodyTextOf(html, url);

  if (options?.rawHtml) {
    const image = extractCoverImage(html, url);
    const limit = options.maxChars ?? MAX_CONTENT_CHARS;
    const raw = html.length > limit ? html.slice(0, limit) : html;
    return { title: url, url, cleanedText: raw, truncated: html.length > limit, image };
  }

  return parseHtml(html, url);
}

export function buildUrlAnalysisPrompt(
  result: UrlParseResult,
  promptTemplate: string,
  truncatedLabel: string,
): string {
  const body = result.truncated
    ? `${result.cleanedText}\n\n${truncatedLabel}`
    : result.cleanedText;

  return promptTemplate
    .replace(/\{\{title\}\}/g, () => result.title)
    .replace(/\{\{url\}\}/g, () => result.url)
    .replace(/\{\{cleaned_text\}\}/g, () => body);
}

export function buildYoutubePrompt(
  template: string,
  vars: { title: string; url: string; transcript: string },
): string {
  return template
    .replace(/\{\{title\}\}/g, () => vars.title)
    .replace(/\{\{url\}\}/g, () => vars.url)
    .replace(/\{\{transcript\}\}/g, () => vars.transcript);
}

function absoluteHttpUrl(raw: string | undefined, base: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

function pickCoverImage($: ReturnType<typeof load>, sourceUrl: string): string {
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[name="twitter:image:src"]').attr('content'),
  ];
  for (const raw of candidates) {
    const abs = absoluteHttpUrl(raw, sourceUrl);
    if (abs) return abs;
  }
  return '';
}

function extractCoverImage(html: string, sourceUrl: string): string {
  try {
    return pickCoverImage(load(`<html>${html}</html>`), sourceUrl);
  } catch {
    return '';
  }
}

function bodyTextOf(html: string, sourceUrl: string): UrlParseResult {
  const $ = load(`<html>${html}</html>`);
  const image = pickCoverImage($, sourceUrl);
  const title = $('title').first().text().trim() || sourceUrl;

  $('script, style, noscript, iframe').remove();

  const text = ($('body').text() || $.text() || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const truncated = text.length > MAX_CONTENT_CHARS;
  return {
    title,
    url: sourceUrl,
    cleanedText: truncated ? text.slice(0, MAX_CONTENT_CHARS) : text,
    truncated,
    image,
  };
}

export interface ParseHtmlOptions {
  blockBreaks?: boolean;
}

const BLOCK_BREAK_SELECTOR =
  'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr, dt, dd, figcaption, section, article';

export function parseHtml(html: string, sourceUrl: string, options?: ParseHtmlOptions): UrlParseResult {
  const fullHtml = `<html>${html}</html>`;
  const $ = load(fullHtml);

  const image = pickCoverImage($, sourceUrl);

  $(
    'script, style, noscript, iframe, nav, footer, header, aside, ' +
    '[role="banner"], [role="navigation"], [role="complementary"], ' +
    '[aria-hidden="true"], .ad, .advertisement, .sidebar, .menu, .cookie-banner',
  ).remove();

  const title = $('title').first().text().trim() || sourceUrl;

  if (options?.blockBreaks) {
    $('br').replaceWith('\n');
    $(BLOCK_BREAK_SELECTOR).each((_, el) => {
      $(el).append('\n\n');
    });
  }

  const contentEl = $('article, [role="main"], main').first();
  const rawText = (contentEl.length ? contentEl : $('body')).text();

  const cleanedText = rawText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleanedText.length <= MAX_CONTENT_CHARS) {
    return { title, url: sourceUrl, cleanedText, truncated: false, image };
  }

  return {
    title,
    url: sourceUrl,
    cleanedText: cleanedText.slice(0, MAX_CONTENT_CHARS),
    truncated: true,
    image,
  };
}

interface UrlPromptContext {
  langData: Record<string, string>;
  youtubePrompt: string;
  onLog: (msg: string) => void;
  onNotify: (title: string, body: string) => void;
}

export interface ResolvedPrompt {
  prompt: string;
  forceProviderUrl?: string;
  title?: string;
  displayPrompt?: string;
}

export async function resolveUrlPrompt(text: string, ctx: UrlPromptContext): Promise<ResolvedPrompt> {
  if (!isSingleUrl(text)) return { prompt: text };

  if (isYoutubeUrl(text)) return resolveYoutubePrompt(text, ctx);

  if (isMapsUrl(text)) {
    const maps = await resolveMapsPrompt(text, ctx);
    if (maps) return maps;
  }

  const logFetching = ctx.langData['urlParser.log.fetching'] ?? '🔗 URL detected — fetching page content...';
  const notifyTitle = ctx.langData['urlParser.notify.title'] ?? 'Yobi';
  const notifyBody = (ctx.langData['urlParser.notify.body'] ?? 'Fetching: {{url}}').replace('{{url}}', () => text);
  ctx.onLog(logFetching);
  ctx.onNotify(notifyTitle, notifyBody);

  try {
    const parsed = await fetchAndParse(text);
    const promptTemplate = ctx.langData['urlParser.prompt'] ?? '';
    const truncatedLabel = ctx.langData['urlParser.truncated'] ?? '(Content truncated — too long)';
    const prompt = buildUrlAnalysisPrompt(parsed, promptTemplate, truncatedLabel);
    const logDone = (ctx.langData['urlParser.log.done'] ?? '🔗 Fetched {{chars}} chars — wrapping analysis prompt...')
      .replace('{{chars}}', String(parsed.cleanedText.length));
    ctx.onLog(logDone);
    return { prompt };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const logError = (ctx.langData['urlParser.log.error'] ?? '❌ URL fetch failed: {{error}} (sending raw URL instead)')
      .replace('{{error}}', errMsg);
    ctx.onLog(logError);
    return { prompt: text };
  }
}

async function resolveYoutubePrompt(text: string, ctx: UrlPromptContext): Promise<ResolvedPrompt> {
  const notifyTitle = ctx.langData['urlParser.notify.title'] ?? 'Yobi';
  const notifyBody = (ctx.langData['youtube.notify.body'] ?? 'Fetching transcript: {{url}}').replace('{{url}}', text);
  ctx.onLog(ctx.langData['youtube.log.fetching'] ?? '▶️ YouTube URL detected — fetching transcript...');
  ctx.onNotify(notifyTitle, notifyBody);

  const template = ctx.youtubePrompt.trim() || ctx.langData['youtube.prompt.default'] || '';
  const result = await fetchYoutubeVideo(text).catch(() => ({ title: '', transcript: '', ok: false }));

  if (result.ok) {
    const logDone = (ctx.langData['youtube.log.done'] ?? '▶️ Transcript fetched ({{chars}} chars) — wrapping summary prompt...')
      .replace('{{chars}}', String(result.transcript.length));
    ctx.onLog(logDone);
    return {
      prompt: buildYoutubePrompt(template, {
        title: result.title || text,
        url: text,
        transcript: result.transcript,
      }),
      title: result.title || undefined,
    };
  }

  ctx.onLog(ctx.langData['youtube.log.noTranscript'] ?? '▶️ No transcript available — handing the video URL to Gemini...');
  const note = ctx.langData['youtube.noTranscript']
    ?? '(No transcript/captions are available for this video. Please watch the video at the URL above and summarize it.)';
  return {
    prompt: buildYoutubePrompt(template, { title: result.title || text, url: text, transcript: note }),
    forceProviderUrl: PROVIDER_URLS.gemini,
    title: result.title || undefined,
  };
}

async function resolveMapsPrompt(text: string, ctx: UrlPromptContext): Promise<ResolvedPrompt | null> {
  const notifyTitle = ctx.langData['urlParser.notify.title'] ?? 'Yobi';
  ctx.onLog(ctx.langData['mapReviews.log.fetching'] ?? '🗺️ Google Maps place detected — fetching reviews...');
  ctx.onNotify(notifyTitle, (ctx.langData['mapReviews.notify.body'] ?? 'Analyzing Maps reviews: {{url}}').replace('{{url}}', text));

  try {
    const result = await fetchMapReviews(text, {
      sort: 'mixed',
      count: 100,
      hl: config.locale,
      onLog: (msg) => ctx.onLog(`🗺️ ${msg}`),
    });
    if (result.reviews.length === 0) return null;

    const stats = await fetchPlaceStats(result.placeUrl, { onLog: (msg) => ctx.onLog(`🗺️ ${msg}`) }).catch(() => null);
    const { verdict } = localizedVerdict(stats?.rating ?? '', stats?.total ?? '', ctx.langData);
    const prompt = mapReviewsPrompt({
      place: result.place || text,
      reviews: JSON.stringify(result.reviews),
      rating: stats?.rating ?? '',
      total: stats?.total ?? '',
      positive: stats?.positive ?? '',
      distribution: stats?.distribution ?? '',
      verdict,
    }, config.locale);
    ctx.onLog((ctx.langData['mapReviews.log.done'] ?? '🗺️ {{count}} reviews fetched — wrapping analysis prompt...')
      .replace('{{count}}', String(result.reviews.length)));
    const displayPrompt = (ctx.langData['mapReviews.displayPrompt'] ?? '🗺️ Google Maps review analysis: {{place}}')
      .replace('{{place}}', () => result.place || text);
    const title = result.place
      ? (ctx.langData['mapReviews.title'] ?? 'Reviews: {{place}}').replace('{{place}}', () => result.place)
      : undefined;
    return { prompt, displayPrompt, title };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    ctx.onLog(`🗺️ Maps reviews fetch failed: ${errMsg} — falling back to page fetch`);
    return null;
  }
}

import { load } from 'cheerio';
import { PROVIDER_URLS } from '../shared/types';
import type { FeedCandidate } from '../shared/types';
import { loadPageHtml, fetchRawText, ensureHttpScheme } from './pageLoader';
import { runParserBlocks, runCssSelector, parseRssFeed, extractFeedLinks } from './parserBlocks';
import type { ParserBlock, ParserBlockType, RssFeedItem } from './parserBlocks';
import { isYoutubeUrl, fetchYoutubeVideo } from './youtubeTranscript';

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
    // Extract the cover image from the FULL html before truncation — a late
    // <head> on heavy pages must not cost the og:image.
    const image = extractCoverImage(html, url);
    const raw = html.length > MAX_CONTENT_CHARS ? html.slice(0, MAX_CONTENT_CHARS) : html;
    return { title: url, url, cleanedText: raw, truncated: html.length > MAX_CONTENT_CHARS, image };
  }

  return parseHtml(html, url);
}

export async function fetchAndParseMany(urls: string[], options?: FetchAndParseOptions): Promise<UrlParseResult[]> {
  const results: UrlParseResult[] = [];
  for (const url of urls) {
    try {
      results.push(await fetchAndParse(url, options));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[urlParser] Skipping ${url}: ${msg}`);
    }
  }
  return results;
}

export function buildUrlAnalysisPrompt(
  result: UrlParseResult,
  promptTemplate: string,
  truncatedLabel: string,
): string {
  const body = result.truncated
    ? `${result.cleanedText}\n\n${truncatedLabel}`
    : result.cleanedText;

  // Function replacers: title/body are remote page content and may contain `$&`,
  // `$'`, `` $` `` or `$$`, which are special in a String.replace replacement
  // string (they would splice template fragments into the prompt or collapse
  // `$$`→`$`). A replacer function inserts the value verbatim (matches
  // buildYoutubePrompt below).
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

// Meta tags only — no in-page <img> fallback: it grabs avatars/ads/logos when
// the meta is missing, and a wrong cover is worse than none.
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

// The whole <body> as text, with only the non-rendering elements dropped. Unlike
// parseHtml it keeps navigation, sidebars and footers: the caller wants every
// word the page shows, so no <article>/<main> selector gets to decide what counts
// as the content. The MAX_CONTENT_CHARS budget is spent on *text* — truncating
// the html first (as the rawHtml path must, to keep the markup parseable) would
// blow most of that budget on tags and cut the body off on a heavy page.
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

function parseHtml(html: string, sourceUrl: string): UrlParseResult {
  const fullHtml = `<html>${html}</html>`;
  const $ = load(fullHtml);

  const image = pickCoverImage($, sourceUrl);

  $(
    'script, style, noscript, iframe, nav, footer, header, aside, ' +
    '[role="banner"], [role="navigation"], [role="complementary"], ' +
    '[aria-hidden="true"], .ad, .advertisement, .sidebar, .menu, .cookie-banner',
  ).remove();

  const title = $('title').first().text().trim() || sourceUrl;

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
}

export async function resolveUrlPrompt(text: string, ctx: UrlPromptContext): Promise<ResolvedPrompt> {
  if (!isSingleUrl(text)) return { prompt: text };

  if (isYoutubeUrl(text)) return resolveYoutubePrompt(text, ctx);

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

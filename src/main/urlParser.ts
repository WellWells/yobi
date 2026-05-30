// src/main/urlParser.ts — URL detection, HTML fetch & prompt construction
//
// Uses a hidden Electron BrowserWindow (real Chromium) to load pages so that
// anti-bot 403 responses, Cloudflare checks and JS-rendered content are handled
// exactly like a real user browsing — no custom http/https wrangling needed.
//
// For RSS/Atom feeds, uses Electron's net.request() directly — Chromium's
// innerHTML serialization collapses <link> into a void element and drops its
// text content (the article URL), so BrowserWindow is unsuitable for RSS.
import { BrowserWindow, net } from 'electron';
import { load } from 'cheerio';
import { CLEAN_UA } from './windows';

/** Max body characters sent to AI (avoid context overflow). */
const MAX_CONTENT_CHARS = 80_000;

/** Total page-load timeout (ms) before we give up and throw. */
const LOAD_TIMEOUT_MS = 25_000;

/** Timeout for raw HTTP fetch (used for RSS/Atom feeds). */
const RAW_FETCH_TIMEOUT_MS = 15_000;

/**
 * Extra settle time (ms) after `did-finish-load`.
 * Gives JS-rendered pages (React/Vue SPAs) time to mount content.
 */
const JS_SETTLE_MS = 1_500;

/**
 * Fetches a URL via Electron's net.request() and returns the raw response body.
 * Used for RSS/Atom feeds where BrowserWindow innerHTML serialization loses
 * <link> text content (Chromium treats <link> as a void HTML element).
 */
export function fetchRawText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Raw fetch timed out after ${RAW_FETCH_TIMEOUT_MS / 1_000}s`)),
      RAW_FETCH_TIMEOUT_MS,
    );

    const request = net.request({ url, method: 'GET' });
    const chunks: Buffer[] = [];

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      response.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    request.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    request.end();
  });
}

export interface UrlParseResult {
  title: string;
  url: string;
  cleanedText: string;
  truncated: boolean;
}

/** A single parsed item from an RSS or Atom feed. */
export interface RssFeedItem {
  link: string;
  pubDate?: string; // ISO 8601 string, undefined if not present or unparseable
}

/**
 * Parses an RSS/Atom feed XML string and returns items with link + pubDate.
 * Unlike the `parseRss` parser block (which returns only URLs), this function
 * preserves pubDate metadata needed for checkpoint-based deduplication.
 */
export function parseRssFeed(rawXml: string): RssFeedItem[] {
  const $xml = load(rawXml, { xmlMode: true });
  const items: RssFeedItem[] = [];

  const toIso = (raw: string): string | undefined => {
    if (!raw) return undefined;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  // Try RSS 2.0 <item>
  $xml('item').each((_, el) => {
    const link = $xml(el).find('link').first().text().trim();
    if (!link || !/^https?:\/\//i.test(link)) return;
    const pubDate = toIso($xml(el).find('pubDate').first().text().trim());
    items.push({ link, pubDate });
  });

  // Fall back to Atom <entry>
  if (items.length === 0) {
    $xml('entry').each((_, el) => {
      const href = $xml(el).find('link').attr('href') ?? '';
      const text = $xml(el).find('link').first().text().trim();
      const link = href || text;
      if (!link || !/^https?:\/\//i.test(link)) return;
      const rawDate =
        $xml(el).find('updated').first().text().trim() ||
        $xml(el).find('published').first().text().trim();
      const pubDate = toIso(rawDate);
      items.push({ link, pubDate });
    });
  }

  return items;
}

export type ParserBlockType =
  | 'extractLinks'    // user intent: extract all <a> hrefs → URL array
  | 'extractText'     // user intent: get text content (first match)
  | 'parseRss'        // user intent: parse RSS/Atom feed items → URL array
  | 'getLinks'        // legacy alias for extractLinks
  | 'getText'         // legacy alias for extractText
  | 'getTexts'
  | 'getHtml'
  | 'getAttribute'
  | 'getByRegex';

export interface ParserBlock {
  id: string;
  type: ParserBlockType;
  selector: string;
  attribute?: string;
  // Regex-specific fields (used when type === 'getByRegex')
  pattern?: string;
  flags?: string;
  group?: number;
  // Array output limit: 0 = unlimited, positive N = keep first N items (default: 3)
  maxItems?: number;
}

export interface FetchAndParseOptions {
  rawHtml?: boolean;
  xmlMode?: boolean;
  parserBlocks?: ParserBlock[];
}

/**
 * Returns true when `text` is a single, standalone HTTP(S) URL
 * (no whitespace, no line breaks).
 */
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

/**
 * Opens a hidden Electron BrowserWindow, loads `url` as a real Chromium
 * browser (reusing the `persist:gemini` session/cookies), waits for the page
 * to finish rendering, then extracts and cleans the page content.
 *
 * When `options.rawHtml` is true, returns the full HTML source in `cleanedText`.
 * When `options.parserBlocks` is non-empty, the last block's result is returned
 * in `cleanedText` (overrides rawHtml mode).
 *
 * The window is always destroyed after extraction, even on error.
 */
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

  if (options?.rawHtml) {
    const raw = html.length > MAX_CONTENT_CHARS ? html.slice(0, MAX_CONTENT_CHARS) : html;
    return { title: url, url, cleanedText: raw, truncated: html.length > MAX_CONTENT_CHARS };
  }

  return parseHtml(html, url);
}

/**
 * Fetches multiple URLs sequentially and returns their results in order.
 * Uses sequential (not parallel) loading to avoid Electron session conflicts
 * with concurrent BrowserWindow navigations. Skips failed URLs and logs them.
 */
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

/**
 * Extracts elements matching a CSS selector from raw HTML.
 * Selector may include the uBlock-style "##" prefix (stripped automatically).
 *
 * - outputType 'links': finds <a> hrefs within or on matched elements → JSON URL array
 * - outputType 'text': extracts text content of each matched element → separator-joined string
 */
export function runCssSelector(
  html: string,
  sourceUrl: string,
  selector: string,
  outputType: 'links' | 'text',
  maxItems: number,
): string {
  const cleanSel = selector.replace(/^##/, '').trim();
  if (!cleanSel) return '';

  const $ = load(`<html>${html}</html>`);

  let baseOrigin = '';
  try {
    baseOrigin = new URL(sourceUrl).origin;
  } catch {
    // keep empty — relative URLs will not be resolved
  }

  if (outputType === 'links') {
    const links: string[] = [];
    $(cleanSel).each((_, el) => {
      const $el = $(el);
      const directHref = $el.attr('href') ?? '';
      if (directHref) {
        try {
          const resolved = new URL(directHref, baseOrigin || sourceUrl).href;
          if (/^https?:\/\//i.test(resolved)) links.push(resolved);
        } catch { /* skip unparseable href */ }
        return;
      }
      $el.find('a[href]').each((_, a) => {
        const href = $(a).attr('href') ?? '';
        if (!href) return;
        try {
          const resolved = new URL(href, baseOrigin || sourceUrl).href;
          if (/^https?:\/\//i.test(resolved)) links.push(resolved);
        } catch { /* skip */ }
      });
    });
    const limited = maxItems > 0 ? links.slice(0, maxItems) : links;
    return JSON.stringify(limited);
  }

  const texts: string[] = [];
  $(cleanSel).each((_, el) => {
    const text = $(el).text().trim();
    if (text) texts.push(text);
  });
  const limited = maxItems > 0 ? texts.slice(0, maxItems) : texts;
  return limited.join('\n\n---\n\n');
}


/**
 * Builds the analysis prompt by substituting {{title}}, {{url}},
 * {{cleaned_text}} in the template (sourced from i18n).
 */
export function buildUrlAnalysisPrompt(
  result: UrlParseResult,
  promptTemplate: string,
  truncatedLabel: string,
): string {
  const body = result.truncated
    ? `${result.cleanedText}\n\n${truncatedLabel}`
    : result.cleanedText;

  return promptTemplate
    .replace(/\{\{title\}\}/g, result.title)
    .replace(/\{\{url\}\}/g, result.url)
    .replace(/\{\{cleaned_text\}\}/g, body);
}

/**
 * Runs an ordered list of parser blocks against the fetched HTML or XML.
 * Returns the output of the last block (or empty string if the list is empty).
 *
 * DOM-based blocks query the content via CSS selectors (works for both HTML and XML):
 * - getLinks: CSS selector → JSON array of absolute href URLs
 * - getText: CSS selector → text content of the first match
 * - getTexts: CSS selector → JSON array of all matches' text content
 * - getHtml: CSS selector → innerHTML of the first match
 * - getAttribute: CSS selector + attribute → attribute value of the first match
 *
 * Regex block operates on the accumulated text output of previous blocks
 * (or the raw HTML/XML when it is the first block):
 * - getByRegex: regex pattern + flags + group → first match text or JSON array of all matches
 *
 * When xmlMode is true, cheerio parses the content with XML semantics (case-sensitive tags,
 * self-closing tags, no implicit HTML structure). Use this for RSS/Atom feeds.
 */
export function runParserBlocks(html: string, sourceUrl: string, blocks: ParserBlock[], xmlMode = false): string {
  if (blocks.length === 0) return '';

  const $ = xmlMode
    ? load(html, { xmlMode: true })
    : load(`<html>${html}</html>`);

  // Resolve relative URLs to absolute using the source URL's origin.
  let baseOrigin = '';
  try {
    const base = new URL(sourceUrl);
    baseOrigin = base.origin;
  } catch {
    // keep empty — relative URLs will not be resolved
  }

  // Regex blocks apply to the accumulated text output of previous blocks.
  // The initial value is the raw HTML so a leading getByRegex works on the full source.
  let lastOutput = html;

  for (const block of blocks) {
    if (block.type === 'getByRegex') {
      const pat = (block.pattern ?? '').trim();
      if (!pat) continue;
      try {
        const flags = block.flags ?? '';
        const group = block.group ?? 0;
        const regex = new RegExp(pat, flags);
        if (flags.includes('g')) {
          const matches: string[] = [];
          let m: RegExpExecArray | null;
          while ((m = regex.exec(lastOutput)) !== null) {
            matches.push(m[group] ?? m[0] ?? '');
            // Prevent infinite loops on zero-width matches
            if (regex.lastIndex === m.index) regex.lastIndex++;
          }
          lastOutput = JSON.stringify(applyMaxItems(matches, block.maxItems));
        } else {
          const m = regex.exec(lastOutput);
          lastOutput = m ? (m[group] ?? m[0] ?? '') : '';
        }
      } catch {
        // Invalid regex — leave lastOutput unchanged
      }
      continue;
    }

    // parseRss: auto-detect RSS/Atom items using XML-mode parsing (no selector needed)
    if (block.type === 'parseRss') {
      const $xml = load(html, { xmlMode: true });
      const links: string[] = [];

      // Try RSS <item> first
      $xml('item').each((_, el) => {
        const link = $xml(el).find('link').first().text().trim();
        if (link && /^https?:\/\//i.test(link)) links.push(link);
      });

      // Fall back to Atom <entry>
      if (links.length === 0) {
        $xml('entry').each((_, el) => {
          const href = $xml(el).find('link').attr('href') ?? '';
          const text = $xml(el).find('link').first().text().trim();
          const link = href || text;
          if (link && /^https?:\/\//i.test(link)) links.push(link);
        });
      }

      lastOutput = JSON.stringify(applyMaxItems(links, block.maxItems));
      continue;
    }

    const selector = block.selector.trim();
    if (!selector) continue;

    switch (block.type) {
      case 'extractLinks':
      case 'getLinks': {
        const links: string[] = [];
        $(selector).each((_, el) => {
          const href = $(el).attr('href') ?? '';
          if (!href) return;
          try {
            const resolved = new URL(href, baseOrigin || sourceUrl).href;
            if (/^https?:\/\//i.test(resolved)) links.push(resolved);
          } catch {
            // skip unparseable hrefs
          }
        });
        lastOutput = JSON.stringify(applyMaxItems(links, block.maxItems));
        break;
      }
      case 'extractText':
      case 'getText': {
        lastOutput = $(selector).first().text().trim();
        break;
      }
      case 'getTexts': {
        const texts: string[] = [];
        $(selector).each((_, el) => {
          const text = $(el).text().trim();
          if (text) texts.push(text);
        });
        lastOutput = JSON.stringify(applyMaxItems(texts, block.maxItems));
        break;
      }
      case 'getHtml': {
        lastOutput = $(selector).first().html() ?? '';
        break;
      }
      case 'getAttribute': {
        const attr = (block.attribute ?? '').trim();
        lastOutput = attr ? ($(selector).first().attr(attr) ?? '') : '';
        break;
      }
    }
  }

  return lastOutput;
}

/** Applies maxItems limit to an array: 0 = unlimited, otherwise keep first N. */
function applyMaxItems<T>(arr: T[], maxItems: number | undefined): T[] {
  const limit = maxItems ?? 3;
  return limit > 0 ? arr.slice(0, limit) : arr;
}

/**
 * Spins up a hidden BrowserWindow, loads the URL with the shared
 * `persist:gemini` Chromium session, waits for load + JS settle,
 * then returns the full `innerHTML` of `<html>`.
 */
function loadPageHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const win = new BrowserWindow({
      // Off-screen, invisible — never shown to the user
      x: -20_000,
      y: -20_000,
      width: 1_280,
      height: 900,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        // Share cookies/login state with the AI worker window
        partition: 'persist:gemini',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        // Block JS popups/dialogs that could stall execution
        disableDialogs: true,
      },
    });

    win.webContents.setUserAgent(CLEAN_UA);

    // Hard timeout — destroy and reject if the page never finishes
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (settleTimer) clearTimeout(settleTimer);
      safeDestroy(win);
      reject(new Error(`Page load timed out after ${LOAD_TIMEOUT_MS / 1_000}s`));
    }, LOAD_TIMEOUT_MS);

    win.webContents.on('did-finish-load', () => {
      if (settled) return;
      // Give JS-rendered content (React/Vue/Next) time to mount
      settleTimer = setTimeout(async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          const html = await win.webContents.executeJavaScript(
            'document.documentElement.innerHTML',
          ) as string;
          safeDestroy(win);
          resolve(html);
        } catch (err) {
          safeDestroy(win);
          reject(err);
        }
      }, JS_SETTLE_MS);
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (settled) return;
      // Only care about main-frame navigation failures.
      // Subresource failures (ads, tracking pixels, etc.) fire this event too
      // and should not abort the page fetch.
      if (!isMainFrame) return;
      // ERR_ABORTED (-3) fires for navigations cancelled by JS — page may still
      // have loaded (e.g. redirect via window.location). Let the settle path run.
      if (errorCode === -3) return;
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      safeDestroy(win);
      reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`));
    });

    win.loadURL(url).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      safeDestroy(win);
      reject(err);
    });
  });
}

function safeDestroy(win: BrowserWindow): void {
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
    // ignore
  }
}

function parseHtml(html: string, sourceUrl: string): UrlParseResult {
  const fullHtml = `<html>${html}</html>`;
  const $ = load(fullHtml);

  // Strip non-content elements
  $(
    'script, style, noscript, iframe, nav, footer, header, aside, ' +
    '[role="banner"], [role="navigation"], [role="complementary"], ' +
    '[aria-hidden="true"], .ad, .advertisement, .sidebar, .menu, .cookie-banner',
  ).remove();

  const title = $('title').first().text().trim() || sourceUrl;

  // Prefer article/main content; fall back to full body
  const contentEl = $('article, [role="main"], main').first();
  const rawText = (contentEl.length ? contentEl : $('body')).text();

  // Collapse whitespace
  const cleanedText = rawText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleanedText.length <= MAX_CONTENT_CHARS) {
    return { title, url: sourceUrl, cleanedText, truncated: false };
  }

  return {
    title,
    url: sourceUrl,
    cleanedText: cleanedText.slice(0, MAX_CONTENT_CHARS),
    truncated: true,
  };
}

// ── Shared URL-to-prompt helper ──────────────────────────────────────────────
// Eliminates duplication between hotkey handler (index.ts) and UI handler (ipcHandlers.ts).

interface UrlPromptContext {
  langData: Record<string, string>;
  onLog: (msg: string) => void;
  onNotify: (title: string, body: string) => void;
}

/**
 * If `text` is a single URL, fetches and parses it into an analysis prompt.
 * Otherwise returns the text unchanged.
 */
export async function resolveUrlPrompt(text: string, ctx: UrlPromptContext): Promise<string> {
  if (!isSingleUrl(text)) return text;

  const logFetching = ctx.langData['urlParser.log.fetching'] ?? '🔗 URL detected — fetching page content...';
  const notifyTitle = ctx.langData['urlParser.notify.title'] ?? 'Desktop Agent Center';
  const notifyBody = (ctx.langData['urlParser.notify.body'] ?? 'Fetching: {{url}}').replace('{{url}}', text);
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
    return prompt;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const logError = (ctx.langData['urlParser.log.error'] ?? '❌ URL fetch failed: {{error}} (sending raw URL instead)')
      .replace('{{error}}', errMsg);
    ctx.onLog(logError);
    return text;
  }
}



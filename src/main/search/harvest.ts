import { lookup } from 'node:dns/promises';
import { loadPageHtml } from '../pageLoader';
import { parseHtml } from '../urlParser';
import { extractPublishedAt } from './publishedAt';
import { readRawPage } from './rawPageRead';
import { webHostPolicy } from '../net/hostPolicyStore';
import type { HostPolicy } from '../net/hostPolicy';
import { searchRenderLane } from './renderLane';
import { recalledPage, rememberFailure, rememberPage } from './pageCache';
import type { ReadPage } from './pageCache';
import { sendLog } from '../helpers';
import { withTimeout } from '../promiseRace';
import type { SerpHit, SourceDoc } from './types';

export const DEFAULT_MAX_SOURCES = 3;
export const HARVEST_SPARE_TARGETS = 3;
const MAX_PER_HOST = 2;
const MIN_TEXT_CHARS = 400;
const PER_PAGE_TIMEOUT_MS = 35_000;

/** The dev log's p95 for reading a search's pages (2026-10): slower than this is the tail, not the norm. */
export const HEDGE_DELAY_MS = 5_000;

/** The page is not there; any other error status may still render (a 403 to a plain request). */
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

const SKIPPED_EXTENSIONS = /\.(pdf|zip|rar|7z|exe|dmg|pkg|iso|jpe?g|png|gif|webp|svg|mp3|mp4|webm|mov|avi)$/i;

/*
 * Video pages are a player plus a few hundred characters of chrome, so reading skips them. A link
 * list keeps them: a video is a fine answer to "find me a video", and the youtube tool reads its
 * transcript.
 */
const VIDEO_HOSTS: readonly string[] = [
  'youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv', 'tiktok.com', 'douyin.com',
  'vimeo.com', 'dailymotion.com', 'twitch.tv', 'nicovideo.jp',
];

export function isVideoPage(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return VIDEO_HOSTS.some((video) => host === video || host.endsWith(`.${video}`));
}

/** `forReading`: the hits become pages to read as sources, not links to hand back. */
export function selectTargets(hits: SerpHit[], limit: number, forReading = false): SerpHit[] {
  const candidates = forReading ? hits.filter((hit) => !isVideoPage(hit.url)) : hits;
  return dedupeHits(candidates).slice(0, limit);
}

interface RunningRead {
  controller: AbortController;
  hedgeTimer: ReturnType<typeof setTimeout>;
  /** Past `HEDGE_DELAY_MS`: it keeps running, but a spare now covers its slot too. */
  slow: boolean;
}

export interface HarvestOptions {
  /**
   * Reuse a page read (or failed) moments ago. Off for pages the user named: they asked for these
   * pages now, and may have just changed one.
   */
  recall?: boolean;
}

/**
 * Reads pages in rank order until `maxSources` are read. A failed page is replaced at once; a page
 * still running after `HEDGE_DELAY_MS` gets a spare started beside it and whichever reads first
 * takes the slot. Once enough are read the rest are cancelled, render windows included.
 */
export function harvest(
  targets: SerpHit[],
  maxSources: number = DEFAULT_MAX_SOURCES,
  onRead?: (url: string) => void,
  onDoc?: (doc: SourceDoc) => void,
  onFail?: (url: string) => void,
  options: HarvestOptions = {},
): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  if (maxSources <= 0 || targets.length === 0) return Promise.resolve(docs);
  const recall = options.recall ?? true;
  // A caller's progress callback that throws must not stop the harvest from refilling or finishing.
  const notify = <T>(callback: ((value: T) => void) | undefined, value: T): void => {
    try {
      callback?.(value);
    } catch (err) {
      sendLog(`🔎 [Search] progress callback failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return new Promise((resolve) => {
    const running = new Map<number, RunningRead>();
    let cursor = 0;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const read of running.values()) {
        clearTimeout(read.hedgeTimer);
        read.controller.abort(new Error('enough sources were read'));
      }
      if (running.size > 0) sendLog(`🔎 [Search] enough sources — cancelled ${running.size} slower page(s)`);
      running.clear();
      resolve(docs);
    };

    const fill = (): void => {
      if (settled) return;
      const covering = (): number => [...running.values()].filter((read) => !read.slow).length;
      while (cursor < targets.length && covering() < maxSources - docs.length) start(cursor++);
      if (running.size === 0) finish();
    };

    const start = (index: number): void => {
      const hit = targets[index];
      if (index >= maxSources) sendLog(`🔎 [Search] reading spare result ${hit.url}`);
      const controller = new AbortController();
      const startedAt = Date.now();
      const read: RunningRead = {
        controller,
        slow: false,
        hedgeTimer: setTimeout(() => {
          read.slow = true;
          if (cursor < targets.length) sendLog(`🔎 [Search] ${hit.url} still loading after ${HEDGE_DELAY_MS / 1_000}s`);
          fill();
        }, HEDGE_DELAY_MS),
      };
      running.set(index, read);

      const done = (): boolean => {
        if (settled) return false;
        clearTimeout(read.hedgeTimer);
        running.delete(index);
        return true;
      };

      withTimeout(
        readPage(hit, controller.signal, recall),
        PER_PAGE_TIMEOUT_MS,
        () => new Error(`timed out after ${PER_PAGE_TIMEOUT_MS / 1_000}s`),
        () => controller.abort(new Error('page read timed out')),
      ).then(
        ({ page, recalled }) => {
          if (!done()) return;
          const doc: SourceDoc = { ...page, id: docs.length + 1 };
          docs.push(doc);
          const how = recalled ? 'read moments ago' : `${Date.now() - startedAt} ms`;
          sendLog(`🔎 [Search] ✓ ${hit.url} (${page.text.length} chars, ${how})`);
          notify(onRead, hit.url);
          notify(onDoc, doc);
          if (docs.length >= maxSources) finish();
          else fill();
        },
        (err: unknown) => {
          if (!done()) return;
          sendLog(`🔎 [Search] ✗ ${hit.url} — ${err instanceof Error ? err.message : String(err)} (${Date.now() - startedAt} ms)`);
          notify(onFail, hit.url);
          fill();
        },
      );
    };

    fill();
  });
}

interface PageRead {
  page: ReadPage;
  recalled: boolean;
}

/**
 * With `recall`, a page read moments ago comes back as it was and one that could not be read fails
 * again without a request. What is remembered does not depend on `recall`.
 */
async function readPage(hit: SerpHit, signal: AbortSignal, recall: boolean): Promise<PageRead> {
  const recalled = recall ? recalledPage(hit.url) : undefined;
  if (recalled) {
    if ('failure' in recalled) throw new Error(`${recalled.failure} (failed moments ago)`);
    return { page: withTitle(recalled.page, hit), recalled: true };
  }
  try {
    const { page, cacheable } = await fetchClean(hit, signal);
    if (cacheable) rememberPage(hit.url, page);
    return { page: withTitle(page, hit), recalled: false };
  } catch (err) {
    // Only the page's own failures: a cancel, a timeout or the network says nothing about the page.
    if (err instanceof PageUnreadableError && !signal.aborted) rememberFailure(hit.url, err.message);
    throw err;
  }
}

function withTitle(page: ReadPage, hit: SerpHit): ReadPage {
  return page.title ? page : { ...page, title: hit.title };
}

function dedupeHits(hits: SerpHit[]): SerpHit[] {
  const seenUrls = new Set<string>();
  const hostCounts = new Map<string, number>();
  const unique: SerpHit[] = [];
  for (const hit of hits) {
    let parsed: URL;
    try {
      parsed = new URL(hit.url);
    } catch {
      continue;
    }
    if (SKIPPED_EXTENSIONS.test(parsed.pathname)) continue;
    parsed.hash = '';
    const key = parsed.href;
    if (seenUrls.has(key)) continue;
    const host = parsed.hostname.toLowerCase();
    const count = hostCounts.get(host) ?? 0;
    if (count >= MAX_PER_HOST) continue;
    seenUrls.add(key);
    hostCounts.set(host, count + 1);
    unique.push(hit.snippet ? { title: hit.title, url: key, snippet: hit.snippet } : { title: hit.title, url: key });
  }
  return unique;
}

/**
 * The page itself cannot be read (it is gone, or has no text): the same answer on another try soon.
 * Anything else (the network, a timeout, a window that would not open) may be this computer's
 * moment, not the page's.
 */
class PageUnreadableError extends Error {}

/**
 * `title` is the page's own, or empty: the caller falls back to its own search result's title.
 * `cacheable` is false when the raw answer was an error status: a long "you have been blocked" page
 * may still serve as a source now, but it is not the page to hand back to the next search.
 */
async function fetchClean(hit: SerpHit, signal: AbortSignal): Promise<{ page: ReadPage; cacheable: boolean }> {
  assertPublicHttpUrl(hit.url);
  const host = new URL(hit.url).hostname.toLowerCase();
  await assertPublicDnsResolution(host);
  const policy = webHostPolicy();
  assertNotPaused(policy, host);

  let text = '';
  let title = '';
  let publishedAt = '';
  let status = 0;
  let scripted = false;
  // A host whose bot wall refused a plain request goes straight to the window.
  if (policy.readsRaw(host)) {
    try {
      const raw = await readRawPage(hit.url, host, policy, assertPublicHost, signal);
      ({ status, scripted, text, title, publishedAt } = raw);
    } catch {
    }
  }
  // A 404/410 page with text is the error page, never the article: rendering it would only hold a
  // render slot. A short one renders unless it has no script at all (most carry an analytics tag),
  // since it may be a single-page app that answers every deep link with 404 and draws the page.
  if (GONE_STATUSES.has(status)) {
    if (text.length >= MIN_TEXT_CHARS || !scripted) throw new PageUnreadableError(`HTTP ${status}`);
    text = '';
    title = '';
    publishedAt = '';
  }

  if (text.length < MIN_TEXT_CHARS) {
    if (signal.aborted) throw new Error('page fetch cancelled (deadline exceeded)');
    // A 429 just now: a window would be one more request to the site that asked for fewer.
    assertNotPaused(policy, host);
    // Paced before the render slot is taken: a page waiting its host's turn must not hold one.
    await policy.waitTurn(host, signal);
    await searchRenderLane.acquire(signal);
    let html: string;
    try {
      if (signal.aborted) throw new Error('page fetch cancelled (deadline exceeded)');
      html = await loadPageHtml(hit.url, assertPublicHost, signal);
    } finally {
      searchRenderLane.release();
    }
    const rendered = parseHtml(html, hit.url, { blockBreaks: true });
    if (rendered.cleanedText.length > text.length) {
      text = rendered.cleanedText;
      if (rendered.title && rendered.title !== hit.url) title = rendered.title;
    }
    if (!publishedAt) publishedAt = extractPublishedAt(html);
  }

  if (text.length < MIN_TEXT_CHARS) {
    const message = `too little readable text (${text.length} chars)`;
    // Rate-limited or a server error: the site's moment, not the page's.
    throw status === 429 || status >= 500 ? new Error(message) : new PageUnreadableError(message);
  }
  return {
    page: { title, url: hit.url, text, ...(publishedAt ? { publishedAt } : {}) },
    cacheable: status < 400,
  };
}

/** A site that answered 429 gets no request at all, raw or window, until its pause is over. */
function assertNotPaused(policy: HostPolicy, host: string): void {
  const paused = policy.pausedFor(host);
  if (paused > 0) throw new Error(`${host} asked for fewer requests — ${Math.ceil(paused / 1_000)} s left`);
}

function assertPublicHttpUrl(raw: string): void {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`blocked non-http(s) URL (${u.protocol})`);
  }
  assertPublicHost(u.hostname.toLowerCase());
}

function assertPublicHost(host: string): void {
  if (!host) throw new Error('blocked empty host');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('blocked local hostname');
  }
  if (isBlockedAddressLiteral(host)) {
    throw new Error('blocked private address');
  }
}

async function assertPublicDnsResolution(host: string): Promise<void> {
  if (host.includes(':') || /^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return;
  }
  for (const { address } of addresses) {
    if (isPrivateResolvedAddress(address)) {
      throw new Error(`blocked private address (${host} resolves to ${address})`);
    }
  }
}

function isPrivateResolvedAddress(address: string): boolean {
  const addr = address.toLowerCase();
  if (!addr.includes(':')) return isBlockedAddressLiteral(addr);
  if (addr === '::1' || addr === '::') return true;
  if (/^fe[89ab]/.test(addr)) return true;
  if (/^f[cd]/.test(addr)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  return mapped ? isBlockedAddressLiteral(mapped[1]) : false;
}

function isBlockedAddressLiteral(host: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  return host.includes(':');
}


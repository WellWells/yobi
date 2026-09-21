import { load } from 'cheerio';
import { fetchAndParse, fetchRawText, parseRssFeed, type RssFeedItem } from '../../urlParser';
import { pageFetchLane, Semaphore } from '../lanes';
import { extractYoutubeVideoId, youtubeThumbnailUrl } from '../../youtubeTranscript';
import { sendLog } from '../../helpers';
import { makeCheckpointStore } from '../checkpoint';
import { cacheWindowMs, readSeenEntries, reconcileSeenCache, type SeenCheckpoint } from '../seenCache';

export { buildYoutubeEnvelope, execYoutube } from './youtube';

const rssCheckpoints = makeCheckpointStore<SeenCheckpoint>('rss');

function pushResolved(items: Array<{ title: string; link: string }>, title: string, rawLink: string, base: string): void {
  if (!rawLink) return;
  try {
    const resolved = new URL(rawLink, base).href;
    if (/^https?:\/\//i.test(resolved)) items.push({ title: title || resolved, link: resolved });
  } catch {
  }
}

export async function execRss(
  config: Record<string, string>,
  stepId: string,
): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '[]';

  if (config.fetchContent === 'true') {
    throw new Error(
      'The RSS "fetch linked content" option has been removed. Feed the RSS output into a loop and fetch each article with a browser step. See the "RSS Article Summary" template.',
    );
  }

  const FIRST_RUN_COUNT = 1;
  const BURST_CAP = 5;

  sendLog(`📡 [Flow] RSS step — fetching feed: ${url}`);

  const rawXml = await fetchRawText(url);
  const allItems = parseRssFeed(rawXml);

  if (allItems.length === 0) {
    sendLog('📡 [Flow] RSS: feed returned 0 items');
    return '[]';
  }

  const byLink = new Map(allItems.map((item) => [item.link, item]));
  const { fresh, isFirstRun } = await reconcileSeenCache(
    rssCheckpoints,
    stepId,
    allItems.map((item) => item.link),
    undefined,
  );

  let newLinks = fresh;
  if (isFirstRun) {
    sendLog(`📡 [Flow] RSS: first run — seeding the checkpoint, returning the latest ${FIRST_RUN_COUNT} item`);
    newLinks = allItems.slice(0, FIRST_RUN_COUNT).map((item) => item.link);
  } else if (newLinks.length > BURST_CAP) {
    sendLog(`📡 [Flow] RSS: burst of ${newLinks.length} — returning latest ${BURST_CAP}`);
    newLinks = allItems.slice(0, BURST_CAP).map((item) => item.link);
  } else {
    sendLog(`📡 [Flow] RSS: found ${newLinks.length} new items since checkpoint`);
  }

  if (newLinks.length === 0) return '[]';

  const items = newLinks.map((link) => ({
    title: byLink.get(link)?.title?.trim() || link,
    link,
  }));
  return JSON.stringify(items);
}

const scraperCheckpoints = makeCheckpointStore<SeenCheckpoint>('scraper');

const SCRAPER_MAX_HTML_CHARS = 2_000_000;

export async function execScraper(
  config: Record<string, string>,
  stepId: string,
): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '[]';

  sendLog(`🔍 [Flow] Web Scraper step — fetching page: ${url}`);
  const result = await pageFetchLane.runExclusive(() => fetchAndParse(url, { rawHtml: true, maxChars: SCRAPER_MAX_HTML_CHARS }));
  const html = result.cleanedText;

  const $ = load(`<html>${html}</html>`);

  let baseOrigin = '';
  try {
    baseOrigin = new URL(url).origin;
  } catch {
  }

  const items: Array<{ title: string; link: string }> = [];

  const itemSel = (config.itemSelector ?? '').trim();
  const titleSel = (config.titleSelector ?? '').trim();
  const linkSel = (config.linkSelector ?? '').trim();

  if (!titleSel && !linkSel) {
    sendLog(`⚠️ [Flow] Scraper: Both titleSelector and linkSelector are empty!`);
    return '[]';
  }

  if (itemSel) {
    const within = (row: ReturnType<typeof $>, sel: string): ReturnType<typeof $> =>
      (row.is(sel) ? row : row.find(sel).first());

    $(itemSel).each((_, el) => {
      const $el = $(el);
      const title = titleSel ? within($el, titleSel).text().trim() : $el.text().trim();
      let rawLink = '';
      if (linkSel) {
        const linkEl = within($el, linkSel);
        rawLink = linkEl.attr('href') ?? linkEl.text().trim();
      } else {
        rawLink = $el.attr('href') ?? '';
      }

      pushResolved(items, title, rawLink, baseOrigin || url);
    });
  } else if (titleSel && linkSel) {
    const titleEls = $(titleSel).toArray();
    const paired = titleEls.map((tEl) => {
      const $t = $(tEl);
      let rawLink = '';
      let $node = $t;
      for (let depth = 0; depth < 8 && $node.length; depth++) {
        if ($node.is(linkSel)) { rawLink = $node.attr('href') ?? $node.text().trim(); break; }
        const $link = $node.find(linkSel).first();
        if ($link.length) { rawLink = $link.attr('href') ?? $link.text().trim(); break; }
        $node = $node.parent();
      }
      return { title: $t.text().trim(), link: rawLink };
    });

    const resolvedLinks = paired.map((p) => p.link).filter(Boolean);
    const degenerate = resolvedLinks.length > 1 && new Set(resolvedLinks).size < resolvedLinks.length;

    if (degenerate) {
      const linkEls = $(linkSel).toArray();
      titleEls.forEach((tEl, i) => {
        const $link = linkEls[i] ? $(linkEls[i]) : null;
        const rawLink = $link ? ($link.attr('href') ?? $link.text().trim()) : '';
        pushResolved(items, $(tEl).text().trim(), rawLink, baseOrigin || url);
      });
    } else {
      for (const p of paired) pushResolved(items, p.title, p.link, baseOrigin || url);
    }
  } else if (linkSel) {
    $(linkSel).each((_, el) => {
      const $el = $(el);
      const rawLink = $el.attr('href') ?? $el.text().trim();
      pushResolved(items, $el.text().trim(), rawLink, baseOrigin || url);
    });
  }

  sendLog(`🔍 [Flow] Scraper: Found ${items.length} total items on page`);

  if (items.length === 0) {
    return '[]';
  }

  const { fresh, isFirstRun } = await reconcileSeenCache(
    scraperCheckpoints,
    stepId,
    items.map((item) => item.link),
    undefined,
  );
  const freshSet = new Set(fresh);
  const newItems = items.filter((item) => freshSet.has(item.link.trim()));

  const parsedMax = parseInt(config.maxItems ?? '', 10);
  const INITIAL_FETCH_COUNT = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 5;
  const itemsToReturn = newItems.slice(0, INITIAL_FETCH_COUNT);

  if (isFirstRun) {
    sendLog(`🔍 [Flow] Scraper: First run — returning ${itemsToReturn.length} latest items`);
  } else {
    sendLog(`🔍 [Flow] Scraper: Found ${itemsToReturn.length} new items out of ${newItems.length} total unseen items`);
  }

  return JSON.stringify(itemsToReturn);
}

const ytSubsCheckpoints = makeCheckpointStore<SeenCheckpoint>('youtube_subs');

const YT_RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

/** How many channel feeds may be in flight at once. */
const YT_SUBS_CONCURRENCY = 5;

interface ChannelFeedCheckpoint {
  feeds: Record<string, string>;
  updatedAt: string;
}

const ytChannelCheckpoints = makeCheckpointStore<ChannelFeedCheckpoint>('youtube_channels');

/**
 * How long a resolved handle is trusted. A handle can be reassigned to another channel, and
 * a cache with no end date would follow the old one forever without ever saying so.
 */
const CHANNEL_FEED_TTL_MS = 30 * 86_400_000;

function readChannelFeeds(raw: unknown, nowMs: number): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const saved = raw as ChannelFeedCheckpoint;

  const updatedAt = Date.parse(saved.updatedAt ?? '');
  if (!Number.isFinite(updatedAt) || nowMs - updatedAt > CHANNEL_FEED_TTL_MS) return {};

  const feeds = saved.feeds;
  if (!feeds || typeof feeds !== 'object') return {};

  const out: Record<string, string> = {};
  for (const [entry, feedUrl] of Object.entries(feeds)) {
    if (typeof feedUrl === 'string' && feedUrl) out[entry] = feedUrl;
  }
  return out;
}

async function saveChannelFeeds(
  stepId: string,
  cached: Record<string, string>,
  learned: Record<string, string>,
): Promise<void> {
  const changed = Object.entries(learned).some(([entry, feedUrl]) => cached[entry] !== feedUrl);
  if (!changed) return;
  await ytChannelCheckpoints.save(stepId, {
    feeds: { ...cached, ...learned },
    updatedAt: new Date().toISOString(),
  });
}

interface ChannelFetch {
  entry: string;
  feedUrl?: string;
  latest?: RssFeedItem[];
  logs: string[];
}

function isYoutubeShort(link: string): boolean {
  return /\/shorts\//i.test(link);
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** `"Title" (id, published 2026-09-19 10:31, 3 h ago)` — publish time in local time, like the log's own stamps. */
function describeVideo(v: RssFeedItem, nowMs: number): string {
  const id = extractYoutubeVideoId(v.link) ?? v.link;
  const published = v.pubDate ? Date.parse(v.pubDate) : Number.NaN;
  if (!Number.isFinite(published)) return `"${v.title ?? ''}" (${id}, no publish date)`;
  const ageMs = nowMs - published;
  const age = ageMs < HOUR_MS
    ? `${Math.max(0, Math.round(ageMs / 60_000))} min ago`
    : ageMs < 2 * DAY_MS ? `${Math.round(ageMs / HOUR_MS)} h ago` : `${Math.round(ageMs / DAY_MS)} days ago`;
  const local = new Date(published).toLocaleString('sv-SE', { hour12: false }).slice(0, 16);
  return `"${v.title ?? ''}" (${id}, published ${local}, ${age})`;
}

function sortByPubDateDesc(items: RssFeedItem[]): RssFeedItem[] {
  return [...items].sort((a, b) => {
    const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
    const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
    return tb - ta;
  });
}

/** The feed URL an entry already spells out — no network needed. */
function feedUrlFromEntry(raw: string): string | null {
  if (/feeds\/videos\.xml/i.test(raw)) return raw;

  const channelIdInUrl = raw.match(/channel\/(UC[\w-]+)/);
  if (channelIdInUrl) return `${YT_RSS_BASE}${channelIdInUrl[1]}`;

  if (/^UC[\w-]{20,}$/.test(raw)) return `${YT_RSS_BASE}${raw}`;

  return null;
}

/**
 * The id of the channel a page belongs to.
 *
 * The order is not cosmetic. A @handle page carries several channel ids, and `"channelId"`
 * is not one that identifies the page: it appeared twice on a real @JeffGeerling page and the
 * first hit was a channel the page merely links to, so matching it resolved the feed of
 * "Geerling Engineering" instead. Each pattern below names the page's own channel.
 */
function channelIdFromPage(html: string): string | null {
  const patterns = [
    /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/i,
    /"externalId"\s*:\s*"(UC[\w-]+)"/,
    /<meta\s+itemprop="(?:channelId|identifier)"\s+content="(UC[\w-]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Resolves a @handle by reading its channel page — the expensive path, which is why its
 * answer is cached. The page measured 1.37 MB against a 39 KB feed, and the id in it is
 * fixed for the life of the handle.
 */
async function resolveFeedFromChannelPage(
  entry: string,
  onLog: (message: string) => void,
): Promise<string | null> {
  const pageUrl = /^https?:\/\//i.test(entry)
    ? entry
    : `https://www.youtube.com/${entry.startsWith('@') ? entry : `@${entry}`}`;

  let html: string;
  try {
    html = await fetchRawText(pageUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onLog(`📺 [Flow] YT Subs: failed to load channel page ${pageUrl}: ${msg}`);
    return null;
  }

  const $ = load(html);
  const rssHref = $('link[rel="alternate"][type="application/rss+xml"]').attr('href');
  if (rssHref && /feeds\/videos\.xml/i.test(rssHref)) return rssHref;

  const channelId = channelIdFromPage(html);
  if (channelId) return `${YT_RSS_BASE}${channelId}`;

  onLog(`📺 [Flow] YT Subs: could not resolve an RSS feed for ${pageUrl}`);
  return null;
}

export async function execYoutubeSubs(
  config: Record<string, string>,
  stepId: string,
): Promise<string> {
  const MAX_NEW_PER_RUN = 5;

  const channels = (config.channels ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (channels.length === 0) {
    sendLog('📺 [Flow] YT Subs: no channels configured');
    return '[]';
  }

  const perChannel = Math.max(1, parseInt(config.perChannel ?? '3', 10) || 3);
  const skipShorts = config.skipShorts !== 'false';
  sendLog(`📺 [Flow] YouTube Subscriptions step — ${channels.length} channel(s), latest ${perChannel} each${skipShorts ? ' (Shorts excluded)' : ''}`);

  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const windowMs = cacheWindowMs(undefined);
  const windowDays = Math.round(windowMs / DAY_MS);
  const checkpoint = await ytSubsCheckpoints.load(stepId);
  const seen = new Set(
    readSeenEntries(checkpoint, nowIso)
      .filter((entry) => now - Date.parse(entry.seenAt) <= windowMs)
      .map((entry) => entry.link),
  );

  const emitted: RssFeedItem[] = [];
  const allKeys: string[] = [];

  const isFresh = (v: RssFeedItem): boolean =>
    !v.pubDate || now - Date.parse(v.pubDate) <= windowMs;

  const cachedFeeds = readChannelFeeds(await ytChannelCheckpoints.load(stepId), now);
  const learnedFeeds: Record<string, string> = {};

  // Fetched together, reported in the order the user listed the channels: the logs stay
  // readable and the run no longer costs one round trip per channel end to end.
  const gate = new Semaphore(YT_SUBS_CONCURRENCY);
  const fetched = await Promise.all(channels.map((entry) => gate.runExclusive(
    async (): Promise<ChannelFetch> => {
      const logs: string[] = [];
      const direct = feedUrlFromEntry(entry);
      const feedUrl = direct
        ?? cachedFeeds[entry]
        ?? await resolveFeedFromChannelPage(entry, (message) => logs.push(message));
      if (!feedUrl) return { entry, logs };
      if (!direct) learnedFeeds[entry] = feedUrl;

      try {
        const rawXml = await fetchRawText(feedUrl);
        const videos = parseRssFeed(rawXml).filter((item) => !skipShorts || !isYoutubeShort(item.link));
        return { entry, feedUrl, latest: sortByPubDateDesc(videos).slice(0, perChannel), logs };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`📺 [Flow] YT Subs: failed to read feed for ${entry}: ${msg}`);
        return { entry, logs };
      }
    },
  )));

  await saveChannelFeeds(stepId, cachedFeeds, learnedFeeds);

  for (const { entry, feedUrl, latest, logs } of fetched) {
    for (const line of logs) sendLog(line);
    if (!feedUrl || !latest || latest.length === 0) continue;

    allKeys.push(feedUrl, ...latest.map((v) => v.link));

    if (!seen.has(feedUrl)) {
      if (isFresh(latest[0])) {
        sendLog(`📺 [Flow] YT Subs: ${entry} — new channel, seeding latest 1: ${describeVideo(latest[0], now)}`);
        emitted.push(latest[0]);
      } else {
        sendLog(`📺 [Flow] YT Subs: ${entry} — new channel, latest upload ${describeVideo(latest[0], now)} is older than ${windowDays} days — seeding none`);
      }
    } else {
      const unseen = latest.filter((v) => !seen.has(v.link.trim()));
      const fresh = unseen.filter(isFresh);
      sendLog(`📺 [Flow] YT Subs: ${entry} — ${fresh.length} new video(s)`);
      for (const v of fresh) sendLog(`📺 [Flow] YT Subs: ${entry} — new: ${describeVideo(v, now)}`);
      // Rare, and exactly the case that matters when an old video turns up: a never-seen
      // upload in the window that only its date keeps out.
      for (const v of unseen.filter((u) => !isFresh(u))) {
        sendLog(`📺 [Flow] YT Subs: ${entry} — skipped ${describeVideo(v, now)}: older than ${windowDays} days`);
      }
      emitted.push(...fresh);
    }
  }

  if (allKeys.length > 0) {
    await reconcileSeenCache(ytSubsCheckpoints, stepId, allKeys, undefined);
  }

  if (emitted.length === 0) {
    sendLog('📺 [Flow] YT Subs: no new videos since last run');
    return '[]';
  }

  const byLink = new Map<string, RssFeedItem>();
  for (const v of sortByPubDateDesc(emitted)) {
    if (!byLink.has(v.link)) byLink.set(v.link, v);
  }
  let out = [...byLink.values()];
  if (out.length > MAX_NEW_PER_RUN) {
    sendLog(`📺 [Flow] YT Subs: capping to the latest ${MAX_NEW_PER_RUN} new video(s)`);
    for (const v of out.slice(MAX_NEW_PER_RUN)) sendLog(`📺 [Flow] YT Subs: dropped by the cap: ${describeVideo(v, now)}`);
    out = out.slice(0, MAX_NEW_PER_RUN);
  }
  sendLog(`📺 [Flow] YT Subs: returning ${out.length} video(s)`);

  return JSON.stringify(
    out.map((v) => ({ title: v.title ?? '', link: v.link, image: youtubeThumbnailUrl(v.link) })),
  );
}

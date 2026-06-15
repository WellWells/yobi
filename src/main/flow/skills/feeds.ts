import { load } from 'cheerio';
import { getProviderLabel, preparePromptForProvider } from '../../providers';
import { extractCoverImage, fetchAndParse, fetchRawText, parseRssFeed, type RssFeedItem } from '../../urlParser';
import { pageFetchLane } from '../lanes';
import { fetchYoutubeVideo, youtubeThumbnailUrl, type YoutubeVideoResult } from '../../youtubeTranscript';
import { sendLog } from '../../helpers';
import { makeCheckpointStore } from '../checkpoint';
import { cacheWindowMs, readSeenEntries, reconcileSeenCache, type SeenCheckpoint } from '../seenCache';

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
  targetUrl: string,
): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '[]';

  const includeImage = config.includeImage === 'true';

  const INITIAL_FETCH_COUNT = 5;

  sendLog(`📡 [AgentFlow] RSS step — fetching feed: ${url}`);

  const rawXml = await fetchRawText(url);

  const allLinks = parseRssFeed(rawXml).map((item) => item.link);

  if (allLinks.length === 0) {
    sendLog('📡 [AgentFlow] RSS: feed returned 0 items');
    return '[]';
  }

  const { fresh, isFirstRun } = await reconcileSeenCache(rssCheckpoints, stepId, allLinks, config.cacheDays);

  let newLinks = fresh;
  if (newLinks.length > INITIAL_FETCH_COUNT) {
    sendLog(`📡 [AgentFlow] RSS: ${isFirstRun ? 'first run' : `burst of ${newLinks.length}`} — returning latest ${INITIAL_FETCH_COUNT}`);
    newLinks = allLinks.slice(0, INITIAL_FETCH_COUNT);
  } else {
    sendLog(`📡 [AgentFlow] RSS: found ${newLinks.length} new items since checkpoint`);
  }

  if (newLinks.length === 0) {
    return '[]';
  }

  if (config.fetchContent !== 'true') {
    const linksJson = JSON.stringify(newLinks);
    if (!includeImage) return linksJson;
    const image = await firstLinkImage(newLinks[0]);
    return JSON.stringify({ output: linksJson, image });
  }

  sendLog(`📡 [AgentFlow] RSS: fetching content for ${newLinks.length} articles`);
  const parts: string[] = [];
  let firstImage = '';
  for (let i = 0; i < newLinks.length; i++) {
    const articleUrl = newLinks[i];
    sendLog(`📡 [${i + 1}/${newLinks.length}] Fetching: ${articleUrl}`);
    try {
      const result = await pageFetchLane.runExclusive(() => fetchAndParse(articleUrl, { rawHtml: false }));
      const title = result.title || articleUrl;
      parts.push(`title: ${title}\nlink: ${articleUrl}\ncontent: ${result.cleanedText}`);
      if (includeImage && !firstImage && result.image) firstImage = result.image;
      sendLog(`✅ [${i + 1}/${newLinks.length}] OK — ${result.cleanedText.length} chars`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parts.push(`title: (fetch failed)\nlink: ${articleUrl}\ncontent: Error: ${msg}`);
      sendLog(`❌ [${i + 1}/${newLinks.length}] Failed: ${msg}`);
    }
  }

  const rawOutput = parts.join('\n\n---\n\n');
  const prepared = preparePromptForProvider(rawOutput, targetUrl);
  if (prepared.truncated) {
    sendLog(`✂️ [AgentFlow] RSS: output truncated to ${prepared.maxChars} chars (${getProviderLabel(targetUrl)} limit)`);
  }
  if (!includeImage) return prepared.prompt;
  return JSON.stringify({ output: prepared.prompt, image: firstImage });
}

async function firstLinkImage(articleUrl: string): Promise<string> {
  if (!articleUrl) return '';
  try {
    const { cleanedText: html } = await pageFetchLane.runExclusive(() => fetchAndParse(articleUrl, { rawHtml: true }));
    return extractCoverImage(html, articleUrl);
  } catch {
    return '';
  }
}

const scraperCheckpoints = makeCheckpointStore<SeenCheckpoint>('scraper');

export async function execScraper(
  config: Record<string, string>,
  stepId: string,
): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '[]';

  sendLog(`🔍 [AgentFlow] Web Scraper step — fetching page: ${url}`);
  const result = await pageFetchLane.runExclusive(() => fetchAndParse(url, { rawHtml: true }));
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
    sendLog(`⚠️ [AgentFlow] Scraper: Both titleSelector and linkSelector are empty!`);
    return '[]';
  }

  if (itemSel) {
    $(itemSel).each((_, el) => {
      const $el = $(el);
      const title = titleSel ? $el.find(titleSel).first().text().trim() : $el.text().trim();
      let rawLink = '';
      if (linkSel) {
        const linkEl = $el.find(linkSel).first();
        rawLink = linkEl.attr('href') ?? linkEl.text().trim();
      } else {
        rawLink = $el.attr('href') ?? '';
      }

      pushResolved(items, title, rawLink, baseOrigin || url);
    });
  } else {
    const titles: string[] = [];
    if (titleSel) {
      $(titleSel).each((_, el) => {
        titles.push($(el).text().trim());
      });
    }

    const rawLinks: string[] = [];
    if (linkSel) {
      $(linkSel).each((_, el) => {
        const $el = $(el);
        const l = $el.attr('href') ?? $el.text().trim();
        rawLinks.push(l);
      });
    }

    const maxLen = Math.max(titles.length, rawLinks.length);
    for (let i = 0; i < maxLen; i++) {
      const title = titles[i] ?? '';
      const rawLink = rawLinks[i] ?? '';
      pushResolved(items, title, rawLink, baseOrigin || url);
    }
  }

  sendLog(`🔍 [AgentFlow] Scraper: Found ${items.length} total items on page`);

  if (items.length === 0) {
    return '[]';
  }

  const { fresh, isFirstRun } = await reconcileSeenCache(
    scraperCheckpoints,
    stepId,
    items.map((item) => item.link),
    config.cacheDays,
  );
  const freshSet = new Set(fresh);
  const newItems = items.filter((item) => freshSet.has(item.link.trim()));

  const INITIAL_FETCH_COUNT = parseInt(config.maxItems ?? '5', 10);
  const itemsToReturn = newItems.slice(0, INITIAL_FETCH_COUNT);

  if (isFirstRun) {
    sendLog(`🔍 [AgentFlow] Scraper: First run — returning ${itemsToReturn.length} latest items`);
  } else {
    sendLog(`🔍 [AgentFlow] Scraper: Found ${itemsToReturn.length} new items out of ${newItems.length} total unseen items`);
  }

  return JSON.stringify(itemsToReturn);
}

const ytSubsCheckpoints = makeCheckpointStore<SeenCheckpoint>('youtube_subs');

const YT_RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

function isYoutubeShort(link: string): boolean {
  return /\/shorts\//i.test(link);
}

function sortByPubDateDesc(items: RssFeedItem[]): RssFeedItem[] {
  return [...items].sort((a, b) => {
    const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
    const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
    return tb - ta;
  });
}

async function resolveChannelFeedUrl(entry: string): Promise<string | null> {
  const raw = entry.trim();
  if (!raw) return null;

  if (/feeds\/videos\.xml/i.test(raw)) return raw;

  const channelIdInUrl = raw.match(/channel\/(UC[\w-]+)/);
  if (channelIdInUrl) return `${YT_RSS_BASE}${channelIdInUrl[1]}`;

  if (/^UC[\w-]{20,}$/.test(raw)) return `${YT_RSS_BASE}${raw}`;

  const pageUrl = /^https?:\/\//i.test(raw)
    ? raw
    : `https://www.youtube.com/${raw.startsWith('@') ? raw : `@${raw}`}`;

  let html: string;
  try {
    html = await fetchRawText(pageUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog(`📺 [AgentFlow] YT Subs: failed to load channel page ${pageUrl}: ${msg}`);
    return null;
  }

  const $ = load(html);
  const rssHref = $('link[rel="alternate"][type="application/rss+xml"]').attr('href');
  if (rssHref && /feeds\/videos\.xml/i.test(rssHref)) return rssHref;

  const idMatch =
    html.match(/"(?:channelId|externalId)"\s*:\s*"(UC[\w-]+)"/)
    ?? html.match(/<meta\s+itemprop="(?:channelId|identifier)"\s+content="(UC[\w-]+)"/i);
  if (idMatch) return `${YT_RSS_BASE}${idMatch[1]}`;

  sendLog(`📺 [AgentFlow] YT Subs: could not resolve an RSS feed for ${pageUrl}`);
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
    sendLog('📺 [AgentFlow] YT Subs: no channels configured');
    return '[]';
  }

  const perChannel = Math.max(1, parseInt(config.perChannel ?? '3', 10) || 3);
  const skipShorts = config.skipShorts !== 'false';
  sendLog(`📺 [AgentFlow] YouTube Subscriptions step — ${channels.length} channel(s), latest ${perChannel} each${skipShorts ? ' (Shorts excluded)' : ''}`);

  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const windowMs = cacheWindowMs(config.cacheDays);
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

  for (const entry of channels) {
    const feedUrl = await resolveChannelFeedUrl(entry);
    if (!feedUrl) continue;

    let latest: RssFeedItem[];
    try {
      const rawXml = await fetchRawText(feedUrl);
      const videos = parseRssFeed(rawXml).filter((item) => !skipShorts || !isYoutubeShort(item.link));
      latest = sortByPubDateDesc(videos).slice(0, perChannel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog(`📺 [AgentFlow] YT Subs: failed to read feed for ${entry}: ${msg}`);
      continue;
    }
    if (latest.length === 0) continue;

    allKeys.push(feedUrl, ...latest.map((v) => v.link));

    if (!seen.has(feedUrl)) {
      if (isFresh(latest[0])) {
        sendLog(`📺 [AgentFlow] YT Subs: ${entry} — new channel, seeding latest 1`);
        emitted.push(latest[0]);
      } else {
        sendLog(`📺 [AgentFlow] YT Subs: ${entry} — new channel, latest upload older than the freshness window — seeding none`);
      }
    } else {
      const fresh = latest.filter((v) => !seen.has(v.link.trim()) && isFresh(v));
      sendLog(`📺 [AgentFlow] YT Subs: ${entry} — ${fresh.length} new video(s)`);
      emitted.push(...fresh);
    }
  }

  if (allKeys.length > 0) {
    await reconcileSeenCache(ytSubsCheckpoints, stepId, allKeys, config.cacheDays);
  }

  if (emitted.length === 0) {
    sendLog('📺 [AgentFlow] YT Subs: no new videos since last run');
    return '[]';
  }

  const byLink = new Map<string, RssFeedItem>();
  for (const v of sortByPubDateDesc(emitted)) {
    if (!byLink.has(v.link)) byLink.set(v.link, v);
  }
  let out = [...byLink.values()];
  if (out.length > MAX_NEW_PER_RUN) {
    sendLog(`📺 [AgentFlow] YT Subs: capping to the latest ${MAX_NEW_PER_RUN} new video(s)`);
    out = out.slice(0, MAX_NEW_PER_RUN);
  }

  return JSON.stringify(
    out.map((v) => ({ title: v.title ?? '', link: v.link, image: youtubeThumbnailUrl(v.link) })),
  );
}

// Exported for the test suite.
export function buildYoutubeEnvelope(result: YoutubeVideoResult, image = ''): string {
  return JSON.stringify({
    transcript: result.transcript,
    title: result.title,
    isFailed: result.ok ? '0' : '1',
    image,
  });
}

export async function execYoutube(config: Record<string, string>): Promise<string> {
  const url = (config.url ?? '').trim();
  if (!url) {
    sendLog('▶️ [AgentFlow] YouTube: no URL provided (isFailed=1)');
    return buildYoutubeEnvelope({ title: '', transcript: '', ok: false });
  }

  const image = youtubeThumbnailUrl(url);

  sendLog(`▶️ [AgentFlow] YouTube step — fetching transcript: ${url}`);
  const result = await fetchYoutubeVideo(url, {
    onLog: (message) => sendLog(`📺 [AgentFlow] ${message}`),
    show: process.env.YOBI_YT_DEBUG === '1',
  }).catch(
    (): YoutubeVideoResult => ({ title: '', transcript: '', ok: false }),
  );

  if (result.ok) {
    sendLog(`✅ [AgentFlow] YouTube: transcript fetched — ${result.transcript.length} chars (${result.title || 'untitled'}, isFailed=0)`);
  } else {
    const titleNote = result.title ? ` — "${result.title}"` : '';
    sendLog(`▶️ [AgentFlow] YouTube: no transcript available${titleNote} (isFailed=1)`);
  }
  return buildYoutubeEnvelope(result, image);
}

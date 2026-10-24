import { isPreviewableFeedUrl } from '../shared/feedPreview';
import type { FeedPreviewResult } from '../shared/feedPreview';
import { feedItemTitle, readFeed, RSS_BURST_CAP } from './flow/skills/rssRead';
import { sendLog } from './helpers';
import { localizeUserFacingError, t } from './i18n';

/** A body that is an HTML document rather than a feed: a homepage pasted where the feed goes. */
function looksLikeWebPage(body: string): boolean {
  return /<!doctype html|<html[\s>]/i.test(body.slice(0, 4_096));
}

/** The raw fetch's own English failures, in the user's words; anything else keeps its text. */
export function feedPreviewError(raw: string, strings: Record<string, string>): string {
  const http = /^HTTP (\d{3})$/.exec(raw);
  if (http) return t(strings, 'flow.feedPreview.error.http', { status: http[1] });
  if (/^Raw fetch timed out/.test(raw)) return t(strings, 'flow.feedPreview.error.timeout');
  const tooLarge = /^Raw fetch body exceeded (\d+) MB/.exec(raw);
  if (tooLarge) return t(strings, 'flow.feedPreview.error.tooLarge', { limit: `${tooLarge[1]} MB` });
  if (/ERR_NAME_NOT_RESOLVED/.test(raw)) return t(strings, 'flow.feedPreview.error.notFound');
  return t(strings, 'flow.feedPreview.error', { error: localizeUserFacingError(raw, strings) });
}

/**
 * The latest items of a feed as the rss step would read it: the same fetch, parser and error
 * rule (`readFeed`), the step's title fallback, at most as many as one run hands on. Nothing is
 * kept between calls, so an edited address never shows the last one's items.
 */
export async function previewFeed(
  url: string,
  signal: AbortSignal,
  strings: Record<string, string>,
): Promise<FeedPreviewResult> {
  const address = url.trim();
  if (!isPreviewableFeedUrl(address)) return { status: 'error', message: t(strings, 'flow.skill.rss.url.error') };
  try {
    const { items, body } = await readFeed(address, signal);
    if (items.length === 0) return { status: 'empty', notFeed: looksLikeWebPage(body) };
    return {
      status: 'items',
      items: items.slice(0, RSS_BURST_CAP).map((item) => ({
        title: feedItemTitle(item),
        link: item.link,
        ...(item.pubDate ? { date: item.pubDate } : {}),
      })),
    };
  } catch (err) {
    if (signal.aborted) return { status: 'cancelled' };
    const raw = err instanceof Error ? err.message : String(err);
    sendLog(`📡 [Flow] Feed preview failed for ${address}: ${raw}`);
    return { status: 'error', message: feedPreviewError(raw, strings) };
  }
}

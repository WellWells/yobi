import { fetchRawResponse, parseRssFeed, type RssFeedItem } from '../../urlParser';

/** The most new items one rss run hands on, and so the most the setup preview shows. */
export const RSS_BURST_CAP = 5;

export interface FeedRead {
  items: RssFeedItem[];
  body: string;
}

/**
 * One read of a feed, in feed order. The rss step and the setup preview both read through here,
 * so the preview shows what the step gets. Fails only when nothing parsed and the server answered
 * an error status: a feed body served with a 4xx keeps working.
 */
export async function readFeed(url: string, signal?: AbortSignal): Promise<FeedRead> {
  const { status, text } = signal ? await fetchRawResponse(url, { signal }) : await fetchRawResponse(url);
  const items = parseRssFeed(text);
  if (items.length === 0 && status >= 400) throw new Error(`HTTP ${status}`);
  return { items, body: text };
}

/** An item's title as the rss step outputs it: the link stands in for a missing one. */
export function feedItemTitle(item: RssFeedItem): string {
  return item.title?.trim() || item.link;
}

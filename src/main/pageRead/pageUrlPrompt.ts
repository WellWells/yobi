/**
 * A link pasted alone (chat, the hotkey, Telegram and the other bots all arrive through
 * `resolveUrlPrompt`) as the page text that prompt summarises. Null means "read it the usual way":
 * the connector is off, or this reader could not manage. A link it cannot read is no worse off than
 * before it existed, so a failure here only ever logs. A Stop is not a failure: it ends the read.
 */
import { config } from '../config';
import { sendLog } from '../helpers';
import type { UrlParseResult } from '../urlParser';
import { readPageLink } from './pageReadLive';

export async function pagePromptFor(url: string, signal?: AbortSignal): Promise<UrlParseResult | null> {
  if (!config.pageConnectorEnabled) return null;
  try {
    const page = await readPageLink(url, signal);
    const published = page.publishedAt ? `Published: ${page.publishedAt}\n\n` : '';
    return { title: page.title, url: page.url, cleanedText: `${published}${page.text}`, truncated: page.truncated };
  } catch (err) {
    if (signal?.aborted) throw err;
    sendLog(`📄 [PageRead] ${err instanceof Error ? err.message : String(err)} — reading the page the usual way`);
    return null;
  }
}

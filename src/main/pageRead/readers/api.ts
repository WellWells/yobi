import type { PageRead } from '../pageReader';
import { blueskyReader } from './bluesky';
import { mastodonReader } from './mastodon';
import { msnReader } from './msn';

/** A site whose page has no text a reader can see, and whose public API says what the page shows. */
export interface PageApiReader {
  /** Where the post's data is; null when the link is no post this reader reads. */
  address: (url: URL) => string | null;
  read: (answer: unknown, url: string) => PageRead | null;
}

export const PAGE_API_READERS: readonly PageApiReader[] = [blueskyReader, mastodonReader, msnReader];

/** The reader for this link and the address to ask, or null: it is an ordinary page. */
export function apiReaderFor(link: string): { reader: PageApiReader; address: string } | null {
  try {
    const url = new URL(link);
    for (const reader of PAGE_API_READERS) {
      const address = reader.address(url);
      if (address) return { reader, address };
    }
  } catch {
    return null;
  }
  return null;
}

/** What the API answered as a page; null for anything a reader cannot use. */
export function pageOfApiAnswer(reader: PageApiReader, body: string, url: string): PageRead | null {
  try {
    return reader.read(JSON.parse(body), url);
  } catch {
    return null;
  }
}

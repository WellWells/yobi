import type { PageFailure, PageRead } from '../pageReader';
import { blueskyReader } from './bluesky';
import { icloudShortcutReader } from './icloudShortcut';
import { mastodonReader } from './mastodon';
import { msnReader } from './msn';
import { telegramReader } from './telegram';

/** What the site's own answer says of a link that holds nothing to read: the read ends with it. */
export interface PageApiFailure {
  failure: PageFailure;
  message: string;
}

/** A site whose page has no text a reader can see, and whose public API says what the page shows. */
export interface PageApiReader {
  /** What the address answers: JSON (the default), or a page of HTML the reader parses itself. */
  answer?: 'html';
  /** Where the post's data is; null when the link is no post this reader reads. */
  address: (url: URL) => string | null;
  read: (answer: unknown, url: string) => PageRead | PageApiFailure | null;
  /**
   * A file the answer links that holds the rest, read as bytes (a shared shortcut's actions): its
   * page replaces the answer's. The answer's page stands when the file cannot be had.
   */
  attachment?: {
    address: (answer: unknown) => string | null;
    read: (bytes: Uint8Array, answer: unknown, url: string) => PageRead | null;
  };
}

export const PAGE_API_READERS: readonly PageApiReader[] = [blueskyReader, icloudShortcutReader, mastodonReader, msnReader, telegramReader];

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

function answerOf(reader: PageApiReader, body: string): unknown {
  return reader.answer === 'html' ? body : JSON.parse(body);
}

/** What the API answered as a page or a failure; null for anything a reader cannot use. */
export function pageOfApiAnswer(reader: PageApiReader, body: string, url: string): PageRead | PageApiFailure | null {
  try {
    return reader.read(answerOf(reader, body), url);
  } catch {
    return null;
  }
}

/** Where the answer's file is, when the reader reads one; null when there is none to read. */
export function attachmentAddress(reader: PageApiReader, body: string): string | null {
  try {
    return reader.attachment?.address(answerOf(reader, body)) ?? null;
  } catch {
    return null;
  }
}

/** The page the file makes; null for a file the reader cannot read (the answer's page stands). */
export function pageOfAttachment(reader: PageApiReader, body: string, bytes: Uint8Array, url: string): PageRead | null {
  try {
    return reader.attachment?.read(bytes, answerOf(reader, body), url) ?? null;
  } catch {
    return null;
  }
}

export function isApiFailure(read: PageRead | PageApiFailure): read is PageApiFailure {
  return 'failure' in read;
}

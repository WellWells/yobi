import type { PageRead } from '../pageReader';
import { bahamutReader } from './bahamut';
import { discourseReader } from './discourse';
import { linkedinReader } from './linkedin';
import { mobile01Reader } from './mobile01';
import { pinterestReader } from './pinterest';
import { xenforoReader } from './xenforo';

/**
 * A site whose visitor page holds more than the general reader can tell apart from its menus: the
 * post, who wrote it, its replies and its own media. These read the page already fetched, with no
 * request of their own, and any reader's null falls through to the general read.
 */
export interface PageSiteReader {
  matches: (url: URL, html: string) => boolean;
  read: (html: string, url: string) => PageRead | null;
}

export const PAGE_READERS: readonly PageSiteReader[] = [
  linkedinReader, pinterestReader, discourseReader, xenforoReader, bahamutReader, mobile01Reader,
];

/** The first reader that claims the page and can read it. A page they cannot parse is the general reader's. */
export function readBySite(html: string, url: string): PageRead | null {
  try {
    const address = new URL(url);
    for (const reader of PAGE_READERS) {
      const page = reader.matches(address, html) ? reader.read(html, url) : null;
      if (page) return page;
    }
  } catch {
    return null;
  }
  return null;
}

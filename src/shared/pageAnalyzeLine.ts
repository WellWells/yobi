import { xAnalyzeInput } from './linkSites/registry';

/** The analyze button under a forwarded page: open to anyone who may talk to the bot, unlike a downloader's. */
export const PAGE_ANALYZE_FLOW_ID = 'builtin-page-analyze';

/** The link in the line that button sends, `<link> analyze`; null for anything else. */
export function pageAnalyzeLink(line: string): string | null {
  const text = line.trim();
  const [link] = text.split(/\s+/);
  return link && /^https?:\/\//i.test(link) && xAnalyzeInput(link) === text ? link : null;
}

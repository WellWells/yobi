import type { Session } from 'electron';
import { SITE_PARTITIONS } from './siteAccounts';
import { READER_PARTITIONS } from './sitePage';

/**
 * Every session whose windows load someone else's page: the page readers, the agent's browser,
 * YouTube, Maps, the site readers and sign-ins. The AI worker (`persist:gemini`) and the app's own
 * window keep Electron's default.
 */
export const PAGE_READER_PARTITIONS: readonly string[] = [...new Set([
  'persist:url-parser',
  'persist:browser-flow',
  'persist:youtube',
  'persist:gmaps',
  ...SITE_PARTITIONS,
  ...READER_PARTITIONS,
])];

/**
 * Those sessions never download. Electron's default for a page that starts one is a Save dialog
 * pre-filled with whatever name the page chose (`Invoice.pdf.exe`), and a bot message can point
 * the readers at any public page. Nothing Yobi reads arrives that way: it fetches files itself.
 */
export function refusePageReaderDownloads(
  fromPartition: (partition: string) => Session,
  onLog: (message: string) => void,
): void {
  for (const partition of PAGE_READER_PARTITIONS) {
    fromPartition(partition).on('will-download', (event, item) => {
      event.preventDefault();
      onLog(`[download-guard] refused a download from ${hostOf(item.getURL())}`);
    });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || 'a page';
  } catch {
    return 'a page';
  }
}

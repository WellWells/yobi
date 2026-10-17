import type { WebContents } from 'electron';
import { applyChromeIdentity, readNativeUaData, systemAcceptLanguages } from './chromeIdentity';
import { getMainWindow, sendLog } from './helpers';
import { CLEAN_UA } from './userAgent';

/*
 * The Chrome identity a window on a site gets before its first load (`chromeIdentity.ts`), apart
 * from `siteAccounts.ts` so a hidden reader window (`sitePage.ts`) can use it without the sign-in
 * machinery; `siteAccounts.ts` re-exports it under the same name.
 */

/**
 * A sign-in window is the one place a site's own script reads Yobi: it gets Google Chrome's whole
 * identity, the same one the site's session sends with every request. The same goes for any
 * hidden window Yobi reads a site in through its own script (an Instagram profile, a signed-out
 * reader whose site checks the page's script: Dcard, a Vimeo player page behind a challenge) and
 * the human-verification window (`siteVerification.ts`). Never throws: a window without it still
 * loads, with a log line.
 */
export async function prepareSiteWindow(contents: WebContents, label: string): Promise<void> {
  try {
    const applied = await applyChromeIdentity(contents, {
      userAgent: CLEAN_UA,
      acceptLanguages: systemAcceptLanguages(),
      native: await readNativeUaData(getMainWindow()?.webContents),
    });
    if (!applied) sendLog(`⚠️ ${label} window: Chrome's brands could not be set (this machine's values unread)`);
  } catch (err) {
    sendLog(`⚠️ ${label} window: Chrome identity failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

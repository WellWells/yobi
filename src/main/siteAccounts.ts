import { session } from 'electron';
import { IPC, SITE_ACCOUNTS, SITE_ACCOUNT_LABELS } from '../shared/types';
import { bySite } from '../shared/siteConnectors';
import type { SiteAccount, SiteAccountStatus } from '../shared/types';
import { isExpiredCookie, sendLog, sendToRenderer, sendWebNotification } from './helpers';
import { getLangCache, t } from './i18n';
import { openSignInWindow } from './signInWindow';
import { prepareSiteWindow } from './siteWindowIdentity';

interface SiteSpec {
  partition: string;
  loginUrl: string;
  cookieUrl: string;
  /** The cookie that exists only while signed in. */
  sessionCookie: string;
}

// X is hand-wired; every other sign-in site is a row of the connector table.
const SITES: Record<SiteAccount, SiteSpec> = {
  x: {
    partition: 'persist:x',
    loginUrl: 'https://x.com/i/flow/login',
    cookieUrl: 'https://x.com/',
    sessionCookie: 'auth_token',
  },
  ...bySite(({ partition, loginUrl, cookieUrl, sessionCookie }) => ({ partition, loginUrl, cookieUrl, sessionCookie })),
};

/** For factory reset and session setup; one partition per site, never shared with the AI worker. */
export const SITE_PARTITIONS: readonly string[] = SITE_ACCOUNTS.map((site) => SITES[site].partition);

export function siteSession(site: SiteAccount): Electron.Session {
  return session.fromPartition(SITES[site].partition);
}

export async function getSiteAccountStatus(site: SiteAccount): Promise<boolean> {
  const { cookieUrl, sessionCookie } = SITES[site];
  const cookies = await siteSession(site).cookies.get({ url: cookieUrl, name: sessionCookie });
  return cookies.some((cookie) => Boolean(cookie.value) && !isExpiredCookie(cookie.expirationDate));
}

export async function getAllSiteAccountStatuses(): Promise<SiteAccountStatus[]> {
  return Promise.all(SITE_ACCOUNTS.map(async (site) => ({ site, loggedIn: await getSiteAccountStatus(site) })));
}

/*
 * The sign-in window, and any hidden window Yobi reads the signed-in site in (an Instagram
 * profile), get the Chrome identity first; it lives in `siteWindowIdentity.ts`.
 */
export { prepareSiteWindow };

function broadcast(site: SiteAccount, loggedIn: boolean): void {
  const status: SiteAccountStatus = { site, loggedIn };
  sendToRenderer(IPC.SITE_ACCOUNT_STATUS_CHANGED, status);
}

export async function openSiteAccountLogin(site: SiteAccount): Promise<boolean> {
  const label = SITE_ACCOUNT_LABELS[site];
  const strings = getLangCache();
  return openSignInWindow({
    id: `site:${site}`,
    label,
    title: t(strings, 'settings.accounts.loginWindow.title', { provider: label }),
    partition: SITES[site].partition,
    url: SITES[site].loginUrl,
    prepare: (contents) => prepareSiteWindow(contents, label),
    afterLoad: async () => {
      sendLog(t(strings, 'settings.accounts.login.opened', { provider: label }));
    },
    isSignedIn: () => getSiteAccountStatus(site),
    onSignedIn: () => {
      broadcast(site, true);
      sendWebNotification(t(strings, 'notify.signedIn.title'), label, 'success');
    },
    onClosed: (loggedIn) => broadcast(site, loggedIn),
  });
}

/** Signs out by wiping the site's own partition — it holds nothing else. */
export async function logoutSiteAccount(site: SiteAccount): Promise<boolean> {
  const label = SITE_ACCOUNT_LABELS[site];
  try {
    const ses = siteSession(site);
    await ses.clearStorageData();
    await ses.clearCache();
    broadcast(site, false);
    sendLog(`🧹 Signed out of ${label}`);
    return true;
  } catch (err: unknown) {
    sendLog(`⚠️ Sign-out failed for ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/*
 * App Store app links: `apps.apple.com/<storefront>/app/<name>/id<digits>`, the name and the
 * storefront optional (`/app/id<digits>`). The storefront is kept, since prices, in-app purchases and
 * even whether the app is sold differ by store; the name and every query parameter are dropped, and
 * the link is rebuilt from the id. Redeem links, developer pages, bundles, charts and searches are
 * not this row's: they reach the agent like any other link.
 */

const APP_STORE_HOST = 'apps.apple.com';
const APP_PATH = /^\/(?:([a-z]{2})\/)?app\/(?:[^/]+\/)?id(\d{1,15})\/?$/i;

export interface AppStoreLink {
  url: string;
  /** The app's numeric id (`adamId`). */
  id: string;
  /** The storefront's two-letter code, lower case; "" when the link names none. */
  storefront: string;
}

/** The app an App Store link opens, or null when it is no app page. */
export function parseAppStoreUrl(raw: string): AppStoreLink | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== APP_STORE_HOST) return null;
  const match = APP_PATH.exec(url.pathname);
  if (!match) return null;
  const storefront = (match[1] ?? '').toLowerCase();
  const id = match[2];
  return { url: `https://${APP_STORE_HOST}/${storefront ? `${storefront}/` : ''}app/id${id}`, id, storefront };
}

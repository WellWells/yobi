/**
 * Built-in connectors that read one website with the user's own sign-in (Instagram, Facebook,
 * bilibili). One row per site drives
 * everything such a connector needs: the sign-in (`SITE_ACCOUNTS`, `siteAccounts.ts`), the
 * connector entry and its opt-in flag (`builtinConnectors.ts`, `Config`), the settings card, the
 * bot permission label, the icon and the chat keywords. The main process adds the MCP server and
 * agent notes per site in `main/siteConnector.ts`; that table is keyed by the same site ids, so a
 * row without them fails typecheck.
 *
 * A row's site id names the rest: connector id `builtin-<site>`, URL `builtin://<site>`, slash
 * command `<site>`. X is a sign-in site too but is wired by hand, outside this table.
 *
 * Pure data: `shared/types.ts` imports it, so it imports nothing.
 */

export interface SiteConnectorRow {
  readonly site: string;
  /** The site's own name, never translated: the card's MCP name and the sign-in window's title. */
  readonly label: string;
  /** The config flag that records the user's opt-in. */
  readonly flag: string;
  /** Words besides the display name that name this connector in a sentence. */
  readonly keywords: readonly string[];
  /** The session partition its sign-in lives in; never the AI worker's. */
  readonly partition: string;
  readonly loginUrl: string;
  readonly cookieUrl: string;
  /** The cookie that exists only while signed in. */
  readonly sessionCookie: string;
  /** Brand colour of the connector's mark. */
  readonly hex: string;
  /** i18n keys of the settings card and its sign-in row. */
  readonly keys: {
    readonly title: string;
    readonly desc: string;
    readonly toggle: string;
    readonly signedIn: string;
    readonly signedOut: string;
  };
}

export const SITE_CONNECTOR_ROWS = [
  {
    site: 'instagram',
    label: 'Instagram',
    flag: 'instagramConnectorEnabled',
    // "IG" is how Taiwan writes it; fenced as a whole word, so "big" or "IGBT" never match.
    keywords: ['IG', 'instagram.com', '限時動態', '限时动态'],
    partition: 'persist:instagram',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    cookieUrl: 'https://www.instagram.com/',
    sessionCookie: 'sessionid',
    hex: '#FF0069',
    keys: {
      title: 'settings.mcp.instagram.title',
      desc: 'settings.mcp.instagram.desc',
      toggle: 'settings.mcp.instagram.toggle',
      signedIn: 'settings.mcp.instagram.signedIn',
      signedOut: 'settings.mcp.instagram.signedOut',
    },
  },
  {
    site: 'facebook',
    label: 'Facebook',
    flag: 'facebookConnectorEnabled',
    // "FB" and the Chinese nickname are how Taiwan says it; "FB" is fenced as a whole word like "IG".
    keywords: ['FB', 'facebook.com', 'fb.watch', '臉書', '脸书'],
    partition: 'persist:facebook',
    loginUrl: 'https://www.facebook.com/login/',
    cookieUrl: 'https://www.facebook.com/',
    sessionCookie: 'c_user',
    hex: '#0866FF',
    keys: {
      title: 'settings.mcp.facebook.title',
      desc: 'settings.mcp.facebook.desc',
      toggle: 'settings.mcp.facebook.toggle',
      signedIn: 'settings.mcp.facebook.signedIn',
      signedOut: 'settings.mcp.facebook.signedOut',
    },
  },
  {
    site: 'bilibili',
    label: 'bilibili',
    flag: 'bilibiliConnectorEnabled',
    // The nickname "B" + "station" is what people call it (keywords ignore case), beside its Chinese
    // name in both scripts. The sign-in gives subtitles (and with them summaries), read in Yobi's
    // own hidden window; qualities and downloads stay on the signed-out reader's partition
    // (`sitePage.ts`), as yt-dlp never gets a sign-in's cookies.
    keywords: ['B站', 'b23.tv', '哔哩哔哩', '嗶哩嗶哩'],
    partition: 'persist:bilibili',
    loginUrl: 'https://passport.bilibili.com/login',
    cookieUrl: 'https://www.bilibili.com/',
    sessionCookie: 'SESSDATA',
    hex: '#00A1D6',
    keys: {
      title: 'settings.mcp.bilibili.title',
      desc: 'settings.mcp.bilibili.desc',
      toggle: 'settings.mcp.bilibili.toggle',
      signedIn: 'settings.mcp.bilibili.signedIn',
      signedOut: 'settings.mcp.bilibili.signedOut',
    },
  },
] as const satisfies readonly SiteConnectorRow[];

export type SiteConnector = (typeof SITE_CONNECTOR_ROWS)[number];
export type SiteConnectorSite = SiteConnector['site'];
export type SiteConnectorFlag = SiteConnector['flag'];

export function siteConnectorServerId<S extends SiteConnectorSite>(site: S): `builtin-${S}` {
  return `builtin-${site}`;
}

export function siteConnectorUrl(site: SiteConnectorSite): string {
  return `builtin://${site}`;
}

/** One value per site, in row order, as a record keyed by site id. */
export function bySite<T>(value: (row: SiteConnector) => T): Record<SiteConnectorSite, T> {
  return Object.fromEntries(SITE_CONNECTOR_ROWS.map((row) => [row.site, value(row)])) as Record<SiteConnectorSite, T>;
}

/** One value per opt-in flag, as the slice of `Config` the rows own. */
export function bySiteFlag<T>(value: (row: SiteConnector) => T): Record<SiteConnectorFlag, T> {
  return Object.fromEntries(SITE_CONNECTOR_ROWS.map((row) => [row.flag, value(row)])) as Record<SiteConnectorFlag, T>;
}

/** Whether a `builtin://…` URL is a sign-in connector's: it reads other people's posts, not the user's own data. */
export function isSiteConnectorUrl(url: string): boolean {
  const target = (url ?? '').trim().toLowerCase();
  return SITE_CONNECTOR_ROWS.some((row) => siteConnectorUrl(row.site) === target);
}

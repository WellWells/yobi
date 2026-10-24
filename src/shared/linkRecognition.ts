/**
 * Which pasted links Yobi handles on its own — the Maps reviews report, a site's post or download
 * menu — instead of passing the message on as ordinary text. One switch per site (and one for
 * Maps), one set for the desktop and the bots alike; who on a bot may use the downloader is the
 * bot's own grant, not this.
 */
import { LINK_SITE_ROWS } from './linkSites/rows';
import type { LinkSiteId, LinkSiteRow } from './linkSites/types';

/** What one switch turns: the Maps report, or one link site. */
export type LinkRecognitionTarget = 'maps' | LinkSiteId;

/** What the user switched; a switch they never touched follows the region's default. */
export interface LinkRecognitionPrefs {
  maps?: boolean;
  sites?: Partial<Record<LinkSiteId, boolean>>;
}

/** Where this person is, as far as the system language and Yobi's own language tell. */
export interface LinkRecognitionRegion {
  /** Taiwan: the Taiwan-only sites are shown, and on until switched off. */
  taiwan: boolean;
  /** Any Chinese-speaking user (Taiwan included): every other site starts on. */
  chinese: boolean;
}

export interface LinkRecognitionSite {
  site: LinkSiteId;
  on: boolean;
}

/** The switches as they apply now: only the sites shown here, in the table's order. */
export interface LinkRecognitionState {
  maps: boolean;
  sites: LinkRecognitionSite[];
}

/** Whether a site's link runs its built-in. */
export type LinkSiteFilter = (site: LinkSiteId) => boolean;

const SITE_IDS: ReadonlySet<string> = new Set(LINK_SITE_ROWS.map((row) => row.id));

/** A Taiwan-only row (`region: 'tw'`) exists only for a Taiwan user; every other row for everyone. */
function shownIn(row: LinkSiteRow, region: LinkRecognitionRegion): boolean {
  return row.region !== 'tw' || region.taiwan;
}

/** A Taiwan-only site starts on where it is shown at all; every other site for Chinese speakers. */
function defaultFor(row: LinkSiteRow, region: LinkRecognitionRegion): boolean {
  return row.region === 'tw' ? true : region.chinese;
}

/** Maps is on for everyone until switched off; a hidden site is off whatever was stored. */
export function resolveLinkRecognition(prefs: LinkRecognitionPrefs, region: LinkRecognitionRegion): LinkRecognitionState {
  return {
    maps: prefs.maps ?? true,
    sites: LINK_SITE_ROWS
      .filter((row) => shownIn(row, region))
      .map((row) => ({ site: row.id, on: prefs.sites?.[row.id] ?? defaultFor(row, region) })),
  };
}

export function linkSiteFilter(state: Pick<LinkRecognitionState, 'sites'>): LinkSiteFilter {
  const on = new Set(state.sites.filter((entry) => entry.on).map((entry) => entry.site));
  return (site) => on.has(site);
}

function isLinkSiteId(value: unknown): value is LinkSiteId {
  return typeof value === 'string' && SITE_IDS.has(value);
}

/**
 * Only `maps` and booleans under known site ids survive. The first release stored two group
 * switches (`media`, `taiwan`); a stored group is spread over its sites, never over a site the
 * user set on its own.
 */
export function normalizeLinkRecognition(raw: unknown): LinkRecognitionPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const prefs: LinkRecognitionPrefs = {};
  if (typeof source.maps === 'boolean') prefs.maps = source.maps;
  const sites: Partial<Record<LinkSiteId, boolean>> = {};
  for (const row of LINK_SITE_ROWS) {
    const group = source[row.region === 'tw' ? 'taiwan' : 'media'];
    if (typeof group === 'boolean') sites[row.id] = group;
  }
  if (source.sites && typeof source.sites === 'object' && !Array.isArray(source.sites)) {
    for (const [site, on] of Object.entries(source.sites as Record<string, unknown>)) {
      if (isLinkSiteId(site) && typeof on === 'boolean') sites[site] = on;
    }
  }
  if (Object.keys(sites).length > 0) prefs.sites = sites;
  return prefs;
}

export function isLinkRecognitionTarget(value: unknown): value is LinkRecognitionTarget {
  return value === 'maps' || isLinkSiteId(value);
}

/** The prefs with one switch turned. */
export function withLinkRecognition(prefs: LinkRecognitionPrefs, target: LinkRecognitionTarget, on: boolean): LinkRecognitionPrefs {
  if (target === 'maps') return { ...prefs, maps: on };
  return { ...prefs, sites: { ...prefs.sites, [target]: on } };
}

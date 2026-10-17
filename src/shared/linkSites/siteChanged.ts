import { LINK_SITE_ROWS, rowById } from './rows';
import type { LinkSiteId } from './types';

/*
 * "This site changed and yt-dlp cannot read it yet", kept per site: a YouTube change pauses
 * YouTube downloads only, and another site's change leaves YouTube alone. YouTube's flag is
 * `youtubeChangedAt` in the tools' state.json; every other site's lives in `siteChangedAt`, so a
 * site's flag is only ever in one place.
 */

export type NonYoutubeSiteId = Exclude<LinkSiteId, 'youtube'>;
export type SiteChangedMap = Partial<Record<NonYoutubeSiteId, string>>;

export interface SiteChangedFlags {
  youtubeChangedAt?: string;
  siteChangedAt?: SiteChangedMap;
}

/** When `site`'s change was seen, or undefined while its downloads run. */
export function siteChangedAt(flags: SiteChangedFlags, site: LinkSiteId): string | undefined {
  return site === 'youtube' ? flags.youtubeChangedAt : flags.siteChangedAt?.[site];
}

/** Some site waits for a newer yt-dlp (the update check then runs every 6 hours, not daily). */
export function anySiteChanged(flags: SiteChangedFlags): boolean {
  if (flags.youtubeChangedAt) return true;
  return Object.values(flags.siteChangedAt ?? {}).some(Boolean);
}

export interface PausedSite {
  site: LinkSiteId;
  /** The site's own name, for the notice that names it. */
  label: string;
  /** When its change was seen. */
  at: string;
}

/** Every site whose downloads wait for a newer yt-dlp, in the table's order: one notice line each. */
export function pausedSites(flags: SiteChangedFlags): PausedSite[] {
  return LINK_SITE_ROWS.flatMap((row) => {
    const at = siteChangedAt(flags, row.id);
    return at ? [{ site: row.id, label: row.label, at }] : [];
  });
}

export function markSiteChanged(flags: SiteChangedFlags, site: LinkSiteId, at: string): void {
  if (site === 'youtube') {
    flags.youtubeChangedAt = at;
    return;
  }
  flags.siteChangedAt = { ...flags.siteChangedAt, [site]: at };
}

/** A newer yt-dlp (or other tools) may read every site again: every flag goes. */
export function clearSiteChanged(flags: SiteChangedFlags): void {
  flags.youtubeChangedAt = undefined;
  flags.siteChangedAt = undefined;
}

/** A hand-edited map keeps the known sites with a time; YouTube's entry belongs in `youtubeChangedAt`. */
export function normalizeSiteChanged(raw: unknown): SiteChangedMap | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const map: SiteChangedMap = {};
  for (const [site, at] of Object.entries(raw)) {
    if (site === 'youtube' || !rowById(site) || typeof at !== 'string' || !at) continue;
    map[site as NonYoutubeSiteId] = at;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

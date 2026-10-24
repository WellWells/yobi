/*
 * Vimeo video links: `vimeo.com/<id>`, an unlisted video's `vimeo.com/<id>/<hash>`, the embed
 * player's `player.vimeo.com/video/<id>` (its hash in `?h=`), and a video inside a channel, group,
 * showcase or album (`vimeo.com/channels/<name>/<id>`, `/groups/<name>/videos/<id>`,
 * `/showcase/<n>/video/<id>`, `/album/<n>/video/<id>`). Accounts, channels as a whole, Vimeo On
 * Demand (`ondemand/`, paid), live events (`event/`) and review pages are not this row's, so such
 * a link reaches the agent like any other. A whole showcase (album, its old name) is read apart
 * (`parseVimeoListUrl`): taken only to answer that downloads go one at a time.
 *
 * The link is rebuilt as `https://vimeo.com/<id>` (+ `/<hash>`): every other query parameter
 * (`share=copy`, `fl`, `fe`, a time) and the fragment are dropped. The hash is kept: an unlisted
 * video's player answers only with it.
 */

export interface VimeoLink {
  /** The video's number. */
  id: string;
  /** An unlisted video's ten hex digits; "" for a public one. */
  hash: string;
  /** `https://vimeo.com/<id>` or `https://vimeo.com/<id>/<hash>`. */
  url: string;
}

/** The hosts whose pages are this row's: the site and the embed player. */
const SITE_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);
const PLAYER_HOST = 'player.vimeo.com';

const ID = /^\d{1,12}$/;
const HASH = /^[\da-f]{10}$/i;

/** Paths on vimeo.com that name one video; the id is the last digits group (and the hash after it, alone). */
const SITE_PATHS: readonly RegExp[] = [
  /^\/(\d{1,12})(?:\/([\da-f]{10}))?\/?$/i,
  /^\/channels\/[\w-]+\/(\d{1,12})\/?$/i,
  /^\/groups\/[\w-]+\/videos\/(\d{1,12})\/?$/i,
  /^\/(?:showcase|album)\/\d{1,12}\/video\/(\d{1,12})\/?$/i,
];
const PLAYER_PATH = /^\/video\/(\d{1,12})\/?$/;

/** A host of Vimeo's own pages and APIs (`vimeo.com` and its subdomains). */
export function isVimeoHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'vimeo.com' || h.endsWith('.vimeo.com');
}

/** The video's page as people share it. */
export function vimeoVideoUrl(id: string, hash = ''): string {
  return `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`;
}

/** The embed player's page, which carries the player's configuration (`window.playerConfig`). */
export function vimeoPlayerUrl(id: string, hash = ''): string {
  return `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}`;
}

function link(id: string, rawHash: string | undefined): VimeoLink | null {
  if (!ID.test(id)) return null;
  const hash = rawHash && HASH.test(rawHash) ? rawHash.toLowerCase() : '';
  return { id, hash, url: vimeoVideoUrl(id, hash) };
}

const SHOWCASE_PATH = /^\/(showcase|album)\/(\d{1,12})\/?$/i;

/** A whole showcase (`vimeo.com/showcase/<n>`, or `album/<n>`): its number and page; null for anything else. */
export function parseVimeoListUrl(text: string): { id: string; url: string } | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  if (!SITE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const found = SHOWCASE_PATH.exec(url.pathname);
  return found ? { id: found[2], url: `https://vimeo.com/${found[1].toLowerCase()}/${found[2]}` } : null;
}

/**
 * A Vimeo video link; null for anything else. Only http(s) links with no user, password or port,
 * as the other video rows take them.
 */
export function parseVimeoUrl(text: string): VimeoLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === PLAYER_HOST) {
    const id = PLAYER_PATH.exec(url.pathname)?.[1];
    return id ? link(id, url.searchParams.get('h') ?? undefined) : null;
  }
  if (!SITE_HOSTS.has(host)) return null;
  for (const pattern of SITE_PATHS) {
    const found = pattern.exec(url.pathname);
    if (found) return link(found[1], found[2]);
  }
  return null;
}

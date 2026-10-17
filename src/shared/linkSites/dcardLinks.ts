/*
 * Dcard post links: a forum's post (`/f/<forum>/p/<id>`, a floor of it `…/p/<id>/b/<floor>`) and a
 * persona's (`/@<persona>/post/<id>`), on `www.dcard.tw`, the bare `dcard.tw` (which answers with a
 * 301 to `www.`) or `m.dcard.tw`. The app's share button copies such a link with query parameters
 * (`utm_*`, `ref`…), which are dropped: the link is rebuilt from the forum or persona and the id.
 * `www.dcard.tw/p/<id>` is a 404, so it is not taken; nor are forums,
 * personas' pages, topics or search: such a link reaches the agent like any other.
 */

const HOSTS = new Set(['dcard.tw', 'www.dcard.tw', 'm.dcard.tw']);

/** Forum aliases and persona names: lower-case letters, digits, `_`, `.` and `-`. */
const NAME = '[A-Za-z0-9_.-]{1,40}';
/** Post ids are numbers: nine digits today. */
const ID = '\\d{5,12}';

const FORUM_PATH = new RegExp(`^/f/(${NAME})/p/(${ID})(?:/b/\\d{1,6})?/?$`);
const PERSONA_PATH = new RegExp(`^/@(${NAME})/post/(${ID})/?$`);

export interface DcardLink {
  kind: 'post';
  id: string;
  /** The forum's alias (`trending`), or "" for a persona's link. */
  forum: string;
  /** The persona the link names, or "" for a forum's link. */
  author: string;
  /** The post's page, rebuilt from the forum or persona and the id. */
  url: string;
}

/** Dcard's own pages (not its media hosts): the readers' redirect guard. */
export function isDcardHost(host: string): boolean {
  return HOSTS.has(host.toLowerCase());
}

/** A post's page on `www.`: under its forum, or under its persona when the link named no forum. */
export function dcardPostUrl(id: string, forum: string, author = ''): string {
  return forum ? `https://www.dcard.tw/f/${forum}/p/${id}` : `https://www.dcard.tw/@${author}/post/${id}`;
}

/**
 * A Dcard post link; null for anything else. http(s) with no user, password or port; the scheme
 * may be left out, as every post row takes it.
 */
export function parseDcardUrl(raw: string): DcardLink | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  if (!isDcardHost(url.hostname)) return null;
  const forum = FORUM_PATH.exec(url.pathname);
  if (forum) {
    const alias = forum[1].toLowerCase();
    return { kind: 'post', id: forum[2], forum: alias, author: '', url: dcardPostUrl(forum[2], alias) };
  }
  const persona = PERSONA_PATH.exec(url.pathname);
  if (persona) return { kind: 'post', id: persona[2], forum: '', author: persona[1], url: dcardPostUrl(persona[2], '', persona[1]) };
  return null;
}

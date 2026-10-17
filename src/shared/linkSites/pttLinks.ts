/*
 * PTT article links: `www.ptt.cc/bbs/<board>/<article id>.html`, and the two mirrors people share
 * them through, rewritten to the article on www.ptt.cc — `www.pttweb.cc/bbs/<board>/<article id>`
 * and `moptt.tw/p/<board>.<article id>` (disp.cc numbers articles its own way: not taken). Boards,
 * board indexes, searches and the like are not this row's: such a link reaches the agent.
 *
 * Bare `ptt.cc` has no https certificate of its own, so every link is rebuilt as
 * `https://www.ptt.cc/bbs/<board>/<id>.html`, the board as written.
 */

const BOARD = '[A-Za-z0-9][A-Za-z0-9_-]{0,19}';
/** `M.<seconds>.A.<3 hex>`; `G.` is the digest's copy of one. */
const ARTICLE = '[MG]\\.\\d{9,10}\\.A\\.[0-9A-Fa-f]{3}';

const PTT_HOSTS = new Set(['ptt.cc', 'www.ptt.cc']);
const PTTWEB_HOSTS = new Set(['pttweb.cc', 'www.pttweb.cc']);
const MOPTT_HOSTS = new Set(['moptt.tw', 'www.moptt.tw']);

const PTT_PATH = new RegExp(`^/bbs/(${BOARD})/(${ARTICLE})\\.html$`);
const PTTWEB_PATH = new RegExp(`^/bbs/(${BOARD})/(${ARTICLE})(?:\\.html)?/?$`);
const MOPTT_PATH = new RegExp(`^/p/(${BOARD})\\.(${ARTICLE})/?$`);

/** The host every article is read from: the reader's redirect guard allows this one only. */
export const PTT_HOST = 'www.ptt.cc';

export interface PttLink {
  board: string;
  /** The article id, `M.1751220340.A.9D3`. */
  id: string;
  /** The article on www.ptt.cc. */
  url: string;
  /** A PTT link names no account. */
  author: '';
}

export function pttArticleUrl(board: string, id: string): string {
  return `https://${PTT_HOST}/bbs/${board}/${id}.html`;
}

function pathMatch(host: string, pathname: string): RegExpExecArray | null {
  if (PTT_HOSTS.has(host)) return PTT_PATH.exec(pathname);
  if (PTTWEB_HOSTS.has(host)) return PTTWEB_PATH.exec(pathname);
  if (MOPTT_HOSTS.has(host)) return MOPTT_PATH.exec(pathname);
  return null;
}

/**
 * A PTT article link, on PTT or a mirror; null for anything else. http(s) with no user, password
 * or port; the scheme may be left out, as every post row takes it. The query (a mirror's
 * tracking, a share's `?fbclid`) and the fragment are dropped.
 */
export function parsePttUrl(raw: string): PttLink | null {
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
  const found = pathMatch(url.hostname.toLowerCase(), url.pathname);
  if (!found) return null;
  const [, board, id] = found;
  return { board, id, url: pttArticleUrl(board, id), author: '' };
}

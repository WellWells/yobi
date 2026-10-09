/** X screen names: 1-15 letters, digits or underscores. */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);

/** Paths that look like a profile but are X's own pages. */
const RESERVED_PATHS = new Set(['home', 'explore', 'search', 'i', 'settings', 'notifications', 'messages', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy']);

function xUrl(raw: string): URL | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return X_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

/** The screen name in `@name`, `name`, or an x.com / twitter.com profile or post URL; null otherwise. */
export function parseXHandle(entry: string): string | null {
  const raw = entry.trim();
  if (!raw) return null;
  const bare = raw.startsWith('@') ? raw.slice(1) : raw;
  if (HANDLE_RE.test(bare)) return bare;
  if (!/[./]/.test(raw)) return null;
  const url = xUrl(raw);
  const first = url?.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!HANDLE_RE.test(first) || RESERVED_PATHS.has(first.toLowerCase())) return null;
  return first;
}

/** An uppercase X on its own: not inside a word ("Xbox", "3X"), not after a Latin word ("OS X", "Model X", "iPhone X"). */
const BARE_X = /(?<![A-Za-z0-9]\s*)X(?![A-Za-z0-9])/g;

/** What follows an X that is not the platform: X光, X軸, X世代, X射線, X戰警, X檔案, and math ("X 的值", "X ="). */
const NOT_THE_PLATFORM_AFTER = /^\s*(?:光|軸|轴|世代|射線|射线|戰警|战警|檔案|档案|的值|[=＝])/;

/** The sentence asks to look something up — without this a bare X is too often something else. */
const LOOKUP_INTENT = /搜尋|搜索|搜|查|找|最新|貼文|帖子|發文|发文|文章|動態|动态|帳號|账号|消息|新聞|新闻|說了|说了|講了|讲了|\b(?:post|posts|tweet|tweets|search|latest|news|account|said)\b/i;

/**
 * Whether a message names X the platform with the bare letter, as in a Chinese request for someone's
 * latest X posts. Connector keywords cannot carry a one-letter name, so this stands in for it; it is
 * strict on purpose because an auto-attached connector turns a chat turn into an agent run.
 */
export function mentionsXPlatform(text: string): boolean {
  if (!LOOKUP_INTENT.test(text)) return false;
  for (const match of text.matchAll(BARE_X)) {
    const after = text.slice((match.index ?? 0) + 1);
    if (!NOT_THE_PLATFORM_AFTER.test(after)) return true;
  }
  return false;
}

/** Splits a list the way the editor shows it: one account per line, blank lines ignored. */
export function splitXAccountLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** The post id (and author, when the URL names one) in an x.com / twitter.com status URL. */
export function parseXPostUrl(raw: string): { author: string; id: string } | null {
  const url = xUrl(raw.trim());
  if (!url) return null;
  const match = /^\/(?:([A-Za-z0-9_]{1,15})|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})/.exec(url.pathname);
  if (!match) return null;
  const author = match[1] ?? '';
  return { author: author.toLowerCase() === 'i' ? '' : author, id: match[2] };
}

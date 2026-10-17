/** threads.com, and threads.net, which redirects to it. */
const THREADS_HOSTS = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);

/** Threads (Instagram) usernames: letters, digits, dots and underscores, up to 30. */
const USERNAME = '[A-Za-z0-9._]{1,30}';
/** A post's shortcode, and a share link's id: URL-safe base64. */
const CODE = '[A-Za-z0-9_-]{4,40}';

const POST_PATH = new RegExp(`^/@(${USERNAME})/post/(${CODE})(?:/|$)`);
const SHORT_PATH = new RegExp(`^/t/(${CODE})(?:/|$)`);
const SHARE_PATH = new RegExp(`^/share/(${CODE})(?:/|$)`);

export function isThreadsHost(host: string): boolean {
  return THREADS_HOSTS.has(host.toLowerCase());
}

export interface ThreadsPostRef {
  /** The link to read, rebuilt from the parts below: nothing else the person typed reaches a request. */
  url: string;
  /** The post's shortcode, or a share link's id until the page says which post it is. */
  id: string;
  /** "" for a short or share link, which names no account. */
  author: string;
}

/**
 * A Threads post link: `/@account/post/<code>`, the short `/t/<code>`, or a share link
 * (`/share/<id>/`, what the app's share button copies), which redirects to the post.
 */
export function parseThreadsPostUrl(raw: string): ThreadsPostRef | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!isThreadsHost(url.hostname) || url.username || url.password || url.port) return null;
  const post = POST_PATH.exec(url.pathname);
  if (post) return { url: `https://www.threads.com/@${post[1]}/post/${post[2]}`, id: post[2], author: post[1] };
  const short = SHORT_PATH.exec(url.pathname);
  if (short) return { url: `https://www.threads.com/t/${short[1]}`, id: short[1], author: '' };
  const share = SHARE_PATH.exec(url.pathname);
  if (share) return { url: `https://www.threads.com/share/${share[1]}/`, id: share[1], author: '' };
  return null;
}

export function threadsPostLink(author: string, code: string): string {
  return `https://www.threads.com/@${author}/post/${code}`;
}

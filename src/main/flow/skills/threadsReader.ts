import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { getSiteAccountStatus, siteSession } from '../../siteAccounts';
import { userAgentForUrl } from '../../userAgent';
import { isThreadsHost, parseThreadsPostUrl } from '../../../shared/threadsLinks';
import { FlowUserError } from '../userError';
import { signedInOnlyError } from './readAccess';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import { readThreadsThread, threadsRestrictedViewer } from './threadsPosts';
import type { XThread } from './xPosts';
import type { XRead } from './xReader';

/**
 * Reading a Threads link. Threads sends the post's data only to what looks like a browser opening
 * the page (see `NAVIGATION_HEADERS`); a share link's redirect lands on the post. Signed out, a post
 * open to everyone is on its page; one Threads does not show to everyone is not, and needs the
 * Threads sign-in in Settings (its own partition, `persist:threads`), read with its cookies first.
 * Anything else that goes wrong signed in falls back to the visitor's page once.
 */
const stayOnThreads = stayOnHosts('Threads', isThreadsHost);

export interface ThreadsReadOptions {
  /** A flow's Stop: aborts the request in flight and ends the read, never falling back. */
  signal?: AbortSignal;
  /**
   * False: the sign-in is not used even when Threads is signed in, nor asked about
   * (`SiteReadOptions.signedIn`); a post only it shows fails as such. Absent: used when signed in.
   */
  signedIn?: boolean;
  /**
   * The sign-in reads it for someone else (`SiteReadOptions.forOthers`), after the visitor's read got
   * nothing: when the sign-in gets nothing either, no second visitor read follows.
   */
  forOthers?: boolean;
}

interface PageRead extends XRead<XThread> {
  /** Threads served its page for a post it does not show to everyone: to a visitor, or to the account. */
  heldBack: 'visitor' | 'account' | null;
}

/** The post's shortcode where the read landed: a share link names it only once redirected. */
function shortcodeOf(finalUrl: string | undefined, url: string): string {
  const ref = parseThreadsPostUrl(finalUrl ?? '') ?? parseThreadsPostUrl(url);
  return ref && !ref.url.includes('/share/') ? ref.id : '';
}

async function readPage(url: string, signedIn: boolean, signal: AbortSignal | undefined): Promise<PageRead> {
  const { status, text, finalUrl } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnThreads,
    ...(signedIn ? { cookiesFrom: siteSession('threads') } : {}),
    signal,
  });
  if (status >= 400) return { status, value: null, heldBack: null };
  const thread = readThreadsThread(text, shortcodeOf(finalUrl, url));
  return { status, value: thread, heldBack: thread ? null : threadsRestrictedViewer(text) };
}

function restrictedError(url: string): FlowUserError {
  return new FlowUserError('flow.error.threadsRestricted', { url }, `Threads does not show this post to the signed-in account either: ${url}`);
}

/**
 * A post Threads holds back from a visitor, with no sign-in that reads it. Not allowed to use the
 * sign-in (someone else's bot message): said to show only signed in (the sign-in may still read it
 * for them, `readLinkedThread`), never "sign in". Allowed: sign in in Settings.
 */
function signInRequired(url: string, allowed: boolean): FlowUserError {
  if (!allowed) return signedInOnlyError('threads', url);
  return new FlowUserError(
    'flow.error.threadsSignIn',
    { url },
    `This Threads post is not open to everyone and needs a Threads sign-in (Settings › Connectors › Threads): ${url}`,
  );
}

/**
 * The post and the replies its page carries; `value` is null when the page held no post. Signed in
 * (and allowed), the page is read with the sign-in's cookies first: the held-back page served to
 * the account is `threadsRestricted`; served to a visitor, Threads has since signed the cookies out.
 * A post held back from a visitor with no sign-in that read it asks for one (`signInRequired`).
 */
export async function readThreadsPostThread(url: string, options: ThreadsReadOptions = {}): Promise<XRead<XThread>> {
  const { signal } = options;
  const allowed = options.signedIn !== false;
  const signedIn = allowed && await getSiteAccountStatus('threads').catch(() => false);
  // A sign-in Threads has since ended still has its cookie: the page it gets is a visitor's.
  let signInEnded = false;
  if (signedIn) {
    try {
      const read = await readPage(url, true, signal);
      if (read.value) {
        sendLog(`🧵 [Threads] Read signed in — ${read.value.focal.media.length} media, ${read.value.replies.length} replies`);
        return { status: read.status, value: read.value };
      }
      if (read.heldBack === 'account') throw restrictedError(url);
      signInEnded = read.heldBack === 'visitor';
      const why = `HTTP ${read.status}${signInEnded ? ', served to a visitor: the sign-in has ended' : ''}`;
      // Someone else's read made the visitor's first: it is not made again.
      if (options.forOthers) {
        sendLog(`🧵 [Threads] The signed-in page held no post (${why})`);
        return { status: read.status, value: null };
      }
      sendLog(`🧵 [Threads] The signed-in page held no post (${why}) — reading as a visitor instead`);
    } catch (err) {
      if (err instanceof FlowUserError || signal?.aborted || options.forOthers) throw err;
      sendLog(`🧵 [Threads] Signed-in read failed: ${err instanceof Error ? err.message : String(err)} — reading as a visitor instead`);
    }
  }
  const read = await readPage(url, false, signal);
  if (read.heldBack && (!signedIn || signInEnded)) throw signInRequired(url, allowed);
  // Signed in, yet its page held no post it could read: not said to be the post's audience.
  if (read.heldBack) sendLog('🧵 [Threads] Held back from visitors, and the signed-in page held no readable post');
  if (read.value) sendLog(`🧵 [Threads] Read — ${read.value.focal.media.length} media, ${read.value.replies.length} replies`);
  return { status: read.status, value: read.value };
}

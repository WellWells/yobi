import { FlowUserError } from '../userError';
import { sendLog } from '../../helpers';
import { getSiteAccountStatus } from '../../siteAccounts';
import type { SiteAccount } from '../../../shared/types';
import type { PostSource, XMediaInput } from '../../../shared/xMedia';
import { rowById } from '../../../shared/linkSites/rows';
import type { PostRef, PostSiteId } from '../../../shared/linkSites/types';
import { readDcardThread } from './dcardReader';
import { readFacebookThread } from './facebookReader';
import { readInstagramLink } from './instagramYtdlp';
import { readPttThread } from './pttReader';
import { readRedditThread } from './redditReader';
import { readThreadsPostThread } from './threadsReader';
import { readTikTokThread } from './tiktokReader';
import { isSignedInOnly, threadForOthers } from './readAccess';
import type { ReadAccess } from './readAccess';
import { readPostThread, type XRead } from './xReader';
import type { XPost, XThread } from './xPosts';

/* A pasted post link, whichever site it is on: `x_media` and `x_thread` read X, Threads, Instagram, Facebook, TikTok, PTT, Dcard and Reddit alike. */

/** The parts of a post link a reader uses: a table row's `PostRef` and `parseXMediaInput`'s result both carry them. */
export type PostLink = Pick<PostRef, 'url' | 'id' | 'author'>;

export interface SiteReadOptions {
  /** Whether the replies are wanted: a forward shows none, so a site that pays extra for them can skip it. */
  comments: boolean;
  /** The step's own (Stop, or its timeout): aborts the request in flight and kills a probe's process tree. */
  signal?: AbortSignal;
  /**
   * Whether the person started this read at the computer (the desktop chat): only then may a site
   * whose page wants a click show them its verification window (`siteVerification.ts`).
   */
  interactive?: boolean;
  /**
   * Whether the sign-in in Settings may be used (X, Instagram, Facebook). Without it a site reads
   * as a visitor, never asks about the sign-in, and fails what only it shows: stories and
   * profiles with `notForOthersError`, a post with `signedInOnlyError`.
   */
  signedIn: boolean;
  /**
   * The owner's sign-in reads it for someone else (`readForOthers`): a post its site marks as
   * shown to some people only (`XPost.audience` `restricted`) is refused whole, so a site skips
   * the extra requests that only show more of it (Facebook's photo pages and comments,
   * Instagram's comments) once the post's own page says so.
   */
  forOthers?: boolean;
}

/** One post site's reader: the post and its replies, or the HTTP status that says why not. */
export interface SiteReader {
  read(link: PostLink, options: SiteReadOptions): Promise<XRead<XThread>>;
  /** The sign-in in Settings the reader uses when allowed; absent for a site Yobi never signs in to. */
  account?: SiteAccount;
  /**
   * The saved media's file name before the item number and extension. Absent: the author's
   * handle, or the site's id when the post has none, then the post id (`postFileStem`).
   */
  fileStem?(post: XPost): string;
}

/**
 * Every post row's reader. Exhaustive: a post row added to the link-site table without a reader
 * here fails typecheck.
 */
export const SITE_READERS: Record<PostSiteId, SiteReader> = {
  x: { read: (link, { signal, signedIn }) => readPostThread(link, signal, signedIn), account: 'x' },
  threads: { read: (link, { signal }) => readThreadsPostThread(link.url, signal) },
  // A profile's analysis reads comments under its top posts; its menu and "all" read none.
  instagram: {
    read: (link, { comments, signal, signedIn, forOthers }) => readInstagramLink(link.url, signal, comments, signedIn, forOthers),
    account: 'instagram',
  },
  // Facebook's comments are a dozen extra requests, which a forward ("media") does not show.
  facebook: {
    read: (link, { comments, signal, signedIn, forOthers }) => readFacebookThread(link.url, { comments, signal, signedIn, forOthers }),
    account: 'facebook',
    // The handle is only there for a page with a vanity name, and only on some reads of it: the
    // same video would be saved under two names. Its files are named after the site instead.
    fileStem: (post) => `facebook-${post.id}`,
  },
  // Comments are their own API calls, which a forward does not show.
  tiktok: { read: (link, { comments, signal }) => readTikTokThread(link.url, { comments, signal }) },
  // The pushes are on the article's own page: a forward reads them too, for their tally.
  ptt: { read: (link, { signal }) => readPttThread(link.url, signal) },
  // A forward reads the post alone in its hidden window; the analysis adds the comments, plain
  // requests. Most posts are anonymous (a school, no handle), so the files are named after the site.
  dcard: {
    read: (link, { comments, signal, interactive }) => readDcardThread(link.url, { comments, signal, interactive }),
    fileStem: (post) => `dcard-${post.id}`,
  },
  // The comments are on the post's own page; a forward shows none, so they are not parsed for it.
  // Its files are named after the site: the post names no handle (`author` is empty).
  reddit: {
    read: (link, { comments, signal, interactive }) => readRedditThread(link.url, { comments, signal, interactive }),
    fileStem: (post) => `reddit-${post.id}`,
  },
};

/** A saved post file's name before the item number and extension: `<author>-<id>`, or `<site>-<id>`. */
export function postFileStem(source: PostSource, post: XPost): string {
  return SITE_READERS[source].fileStem?.(post) ?? `${post.author || source}-${post.id}`;
}

/** The site's own name, from its row in the link-site table. */
export function siteName(source: PostSource): string {
  return rowById(source)?.label ?? source;
}

/**
 * The post and its replies, or the error the person can act on; `step` names the step in the log.
 * `signal` is the step's own (Stop, or its timeout): it aborts the site's request in flight and
 * kills Instagram's yt-dlp probe, rather than letting the read finish for nobody. `access`: what
 * the run allows (`readAccessOf` the step's config); anything not given is not allowed. `others`
 * (someone else's bot message) reads as a visitor, and may then fall back to the sign-in: the
 * post whole, unless its site marks it as shown to some people only — then nothing of it.
 */
export async function readLinkedThread(
  input: XMediaInput,
  step: string,
  signal: AbortSignal | undefined,
  access: Partial<ReadAccess>,
): Promise<XThread> {
  const reader = SITE_READERS[input.source];
  const signIn = access?.signIn ?? 'none';
  const options: SiteReadOptions = {
    comments: step !== 'media',
    signal,
    interactive: access?.interactive === true,
    signedIn: signIn === 'full',
  };
  // Someone else's read: the sign-in may follow the visitor's, for what `threadForOthers` allows.
  const account = signIn === 'others' ? reader.account : undefined;
  if (!account) return threadOf(input, step, await reader.read(input, options));
  return readForOthers(input, step, account, options);
}

/**
 * Someone else's read (`SignInUse` `others`): the visitor's read stands whenever it gets the post —
 * the owner's sign-in is not touched. Only a post a visitor cannot see is read again with the
 * sign-in, when the site is signed in, and `threadForOthers` decides: a post marked as shown to
 * some people only is refused, any other goes out whole. A story or a profile fails in the
 * visitor's read and is never retried. When the signed-in read gets nothing either, the visitor's
 * failure is what the person reads. Every run reads it anew: a button pressed on the reply
 * (analyze, MP3) is checked again, not trusted.
 */
async function readForOthers(input: XMediaInput, step: string, account: SiteAccount, options: SiteReadOptions): Promise<XThread> {
  const reader = SITE_READERS[input.source];
  const site = siteName(input.source);
  const { signal } = options;
  let visitorFailure: unknown;
  try {
    const visitor = await reader.read(input, options);
    if (visitor.value) return visitor.value;
    visitorFailure = missingPost(input, step, visitor.status);
  } catch (err) {
    if (!isSignedInOnly(err)) throw err;
    visitorFailure = err;
  }
  signal?.throwIfAborted();
  if (!(await getSiteAccountStatus(account).catch(() => false))) throw visitorFailure;
  let thread: XThread | null = null;
  try {
    thread = (await reader.read(input, { ...options, signedIn: true, forOthers: true })).value;
  } catch (err) {
    signal?.throwIfAborted();
    sendLog(`🔒 [${site}] Signed-in read for someone else failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!thread) throw visitorFailure;
  const audience = thread.focal.audience ?? 'unknown';
  sendLog(`🔒 [${site}] Read with the sign-in for someone else — the post is marked ${audience}`);
  return threadForOthers(thread, account, input.url);
}

/** The read post, or the error that says why there is none. */
function threadOf(input: XMediaInput, step: string, page: XRead<XThread>): XThread {
  if (page.value) return page.value;
  throw missingPost(input, step, page.status);
}

/** A read that held no post: missing (404), or a page the site may have changed. */
function missingPost(input: XMediaInput, step: string, status: number): FlowUserError {
  const { url } = input;
  const what = `${siteName(input.source)} ${step}`;
  if (status === 404) {
    return new FlowUserError('flow.error.xPostMissing', { url }, `${what}: post not found (HTTP 404): ${url}`);
  }
  return new FlowUserError(
    'flow.error.xPageUnreadable',
    { url },
    `${what}: the post page carried no readable post (HTTP ${status}; the site may have changed the page): ${url}`,
  );
}

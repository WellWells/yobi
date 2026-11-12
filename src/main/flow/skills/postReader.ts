import { FlowUserError } from '../userError';
import { sendLog } from '../../helpers';
import { ReadCache, readThrough, type CachedRead } from '../../downloader/readCache';
import { getSiteAccountStatus } from '../../siteAccounts';
import type { SiteAccount } from '../../../shared/types';
import { isAccountLink, isStoryLink, type PostSource, type XMediaInput } from '../../../shared/xMedia';
import { rowById } from '../../../shared/linkSites/rows';
import type { PostRef, PostSiteId } from '../../../shared/linkSites/types';
import { readDcardThread } from './dcardReader';
import { readFacebookThread } from './facebookReader';
import { readInstagramLink } from './instagramYtdlp';
import { readPttThread } from './pttReader';
import { readRedditThread } from './redditReader';
import { readThreadsPostThread } from './threadsReader';
import { readTikTokThread } from './tiktokReader';
import { readWeiboThread } from './weiboReader';
import { isSignedInOnly, threadForOthers } from './readAccess';
import type { ReadAccess, SignInUse } from './readAccess';
import { readPostThread, type XRead } from './xReader';
import type { XPost, XThread } from './xPosts';

/* A pasted post link, whichever site it is on: `x_media` and `x_thread` read X, Threads, Instagram, Facebook, TikTok, PTT, Dcard, Reddit and Weibo alike. */

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
   * Whether the sign-in in Settings may be used (X, Instagram, Facebook, Threads). Without it a site reads
   * as a visitor, never asks about the sign-in, and fails what only it shows: stories and
   * profiles with `notForOthersError`, a post with `signedInOnlyError`.
   */
  signedIn: boolean;
  /**
   * The owner's sign-in reads it for someone else (`readForOthers`): a post its site marks as
   * shown to some people only (`XPost.audience` `restricted`) is refused whole, so a site skips
   * the extra requests that only show more of it (Instagram's comments) once the post's own page
   * says so.
   */
  forOthers?: boolean;
}

/** One post site's reader: the post and its replies, or the HTTP status that says why not. */
export interface SiteReader {
  read(link: PostLink, options: SiteReadOptions): Promise<XRead<XThread>>;
  /** The sign-in in Settings the reader uses when allowed; absent for a site Yobi never signs in to. */
  account?: SiteAccount;
  /**
   * The site marks no audience Yobi reads, so who could read a post is the only tell (Facebook): a
   * post a visitor cannot see is shown only signed in, and someone else's read stops at the
   * visitor's — the sign-in is not asked, and the visitor's "shown only signed in" is theirs.
   */
  othersAsVisitor?: true;
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
  // A post Threads does not show to everyone is read with the sign-in; its replies are on its page.
  threads: {
    read: (link, { signal, signedIn, forOthers }) => readThreadsPostThread(link.url, { signal, signedIn, forOthers }),
    account: 'threads',
  },
  // A profile's analysis reads comments under its top posts; its menu and "all" read none.
  instagram: {
    read: (link, { comments, signal, signedIn, forOthers }) => readInstagramLink(link.url, signal, comments, signedIn, forOthers),
    account: 'instagram',
  },
  // Facebook's comments are a dozen extra requests, which a forward ("media") does not show.
  facebook: {
    read: (link, { comments, signal, signedIn }) => readFacebookThread(link.url, { comments, signal, signedIn }),
    account: 'facebook',
    othersAsVisitor: true,
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
  // Comments are their own API calls, which a forward does not show. A post names its author by
  // nickname only, which its owner can change: the files are named after the site.
  weibo: {
    read: (link, { comments, signal }) => readWeiboThread(link.url, { comments, signal }),
    fileStem: (post) => `weibo-${post.id}`,
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
 * post whole, unless its site marks it as shown to some people only — then nothing of it. `posts`
 * (an admin in a group) reads a post as `full` and a story or a profile as `others`.
 */
export async function readLinkedThread(
  input: XMediaInput,
  step: string,
  signal: AbortSignal | undefined,
  access: Partial<ReadAccess>,
): Promise<XThread> {
  return (await readLinkedThreadCached(input, step, signal, access)).value;
}

/** A single post read for a forward or its MP3: its media do not change, and their addresses last hours. */
export const POST_READ_TTL_MS = 60 * 60_000;
/** A post read with its replies (the analysis): replies keep coming, so a shorter while. */
export const THREAD_READ_TTL_MS = 30 * 60_000;
/** A person's stories or latest posts (a menu): a new one may be up any minute. */
export const MENU_READ_TTL_MS = 5 * 60_000;

const threadReads = new ReadCache<XThread>();

function readTtl(input: XMediaInput, step: string): number {
  if (isStoryLink(input) || isAccountLink(input)) return MENU_READ_TTL_MS;
  return step === 'media' ? POST_READ_TTL_MS : THREAD_READ_TTL_MS;
}

/**
 * The cache key: the link, whether the replies were read, and the sign-in use the run allows —
 * a read for someone else (`others`) or as a visitor never answers the owner's signed-in one, nor
 * the other way round. Who reads decides that use, so it is decided again on every run.
 */
function readKey(input: XMediaInput, step: string, signIn: Exclude<SignInUse, 'posts'>): string {
  return [input.source, input.url, step === 'media' ? 'media' : 'thread', signIn].join('|');
}

/**
 * `readLinkedThread`, saying whether the read came from the cache: the same link read again within
 * `readTtl` is answered from memory (`readCache.ts`), not from the site. A caller whose download
 * from a kept read fails forgets it (`forgetLinkedThread`) and reads once more, fresh.
 */
export async function readLinkedThreadCached(
  input: XMediaInput,
  step: string,
  signal: AbortSignal | undefined,
  access: Partial<ReadAccess>,
): Promise<CachedRead<XThread>> {
  const signIn = signInFor(input, access?.signIn ?? 'none');
  const read = await readThrough(threadReads, readKey(input, step, signIn), readTtl(input, step), () => readFresh(input, step, signal, access, signIn), { copy: (thread) => structuredClone(thread) });
  if (read.cached) sendLog(`♻️ [${siteName(input.source)}] ${input.id}: read a moment ago — not asking the site again`);
  return read;
}

/** Drops the kept read of this link, so the next one asks the site. */
export function forgetLinkedThread(input: XMediaInput, step: string, access: Partial<ReadAccess>): void {
  threadReads.delete(readKey(input, step, signInFor(input, access?.signIn ?? 'none')));
}

async function readFresh(
  input: XMediaInput,
  step: string,
  signal: AbortSignal | undefined,
  access: Partial<ReadAccess>,
  signIn: Exclude<SignInUse, 'posts'>,
): Promise<XThread> {
  const reader = SITE_READERS[input.source];
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
 * The run's use of the sign-in for this link. An admin in a group (`posts`) showed the group the
 * post they pasted, so it is read as in their own chat; a story or a profile is read as for anyone
 * else: viewing it is the owner's account seen looking.
 */
function signInFor(input: XMediaInput, signIn: SignInUse): Exclude<SignInUse, 'posts'> {
  if (signIn !== 'posts') return signIn;
  return isStoryLink(input) || isAccountLink(input) ? 'others' : 'full';
}

/**
 * Someone else's read (`SignInUse` `others`): the visitor's read stands whenever it gets the post —
 * the owner's sign-in is not touched. Only a post a visitor cannot see is read again with the
 * sign-in, when the site is signed in, and `threadForOthers` decides: a post marked as shown to
 * some people only is refused, any other goes out whole. A story or a profile fails in the
 * visitor's read and is never retried. When the signed-in read gets nothing either, the visitor's
 * failure is what the person reads, as it is for a site whose only tell is who could read the
 * post (`othersAsVisitor`). A button pressed on the reply (analyze, MP3) is a read of its own, not
 * trusted: answered from the cache only by an earlier read made for someone else too (`readKey`).
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
  if (reader.othersAsVisitor) throw visitorFailure;
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

import { sendLog } from '../../helpers';
import { makeCheckpointStore } from '../checkpoint';
import { Semaphore } from '../lanes';
import { cacheWindowMs, readSeenEntries, reconcileSeenCache, type SeenCheckpoint } from '../seenCache';
import { FlowUserError } from '../userError';
import { BROWSER_STEP_TIMEOUT_MS } from '../runtime';
import { parseXHandle, splitXAccountLines } from '../../../shared/xHandles';
import { parseXMediaInput } from '../../../shared/xMedia';
import { readLinkedThread, siteName } from './postReader';
import { readAccessOf } from './readAccess';
import { buildPushThreadEnvelope } from './pushThread';
import { formatPostTime, readAccountPosts, readTrendPosts, readXTrends, XSignInRequiredError, type XRead } from './xReader';
import type { XPost, XThread, XTrend } from './xPosts';

export { formatPostTime };

const xPostsCheckpoints = makeCheckpointStore<SeenCheckpoint>('x_posts');

/** Profiles fetched at once; X rate-limits aggressively. */
const X_FETCH_CONCURRENCY = 2;
const MAX_NEW_PER_RUN = 10;
const DEFAULT_PER_ACCOUNT = 5;
const DEFAULT_MAX_REPLIES = 20;
const TITLE_MAX_CHARS = 80;

const DAY_MS = 86_400_000;

function clip(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : text;
}

function titleOf(post: XPost): string {
  const firstLine = post.text.split('\n').find((line) => line.trim())?.trim() ?? '';
  return firstLine ? clip(firstLine, TITLE_MAX_CHARS) : `@${post.author}`;
}

export function postItem(post: XPost): Record<string, string> {
  return {
    title: titleOf(post),
    link: post.link,
    author: `@${post.author}`,
    name: post.name,
    date: formatPostTime(post.createdAt),
    text: post.text,
    image: post.image,
    replies: String(post.replyCount),
    likes: String(post.likeCount),
  };
}

function describePost(post: XPost, nowMs: number): string {
  const ageH = Math.round((nowMs - post.createdAt) / 3_600_000);
  return `${post.id} (${formatPostTime(post.createdAt)}, ${ageH} h ago)`;
}

interface AccountFetch {
  handle: string;
  posts?: XPost[];
  logs: string[];
}

async function fetchAccount(handle: string, perAccount: number): Promise<AccountFetch> {
  const logs: string[] = [];
  let page: XRead<XPost[]>;
  try {
    page = await readAccountPosts(handle, perAccount);
  } catch (err) {
    logs.push(`🐦 [Flow] X Posts: @${handle} — failed to load: ${err instanceof Error ? err.message : String(err)}`);
    return { handle, logs };
  }
  if (!page.value) {
    logs.push(page.status === 404
      ? `🐦 [Flow] X Posts: @${handle} — no such account`
      : `🐦 [Flow] X Posts: @${handle} — the page carried no posts (HTTP ${page.status}; X may have changed the page)`);
    return { handle, logs };
  }
  return { handle, posts: page.value, logs };
}

export async function execXPosts(config: Record<string, string>, stepId: string): Promise<string> {
  const lines = splitXAccountLines(config.accounts ?? '');
  const handles: string[] = [];
  for (const line of lines) {
    const handle = parseXHandle(line);
    if (!handle) {
      sendLog(`🐦 [Flow] X Posts: skipped "${line}" — not an X account`);
      continue;
    }
    if (!handles.some((h) => h.toLowerCase() === handle.toLowerCase())) handles.push(handle);
  }
  if (handles.length === 0) {
    sendLog('🐦 [Flow] X Posts: no accounts configured');
    return '[]';
  }

  const perAccount = Math.max(1, parseInt(config.perAccount ?? '', 10) || DEFAULT_PER_ACCOUNT);
  sendLog(`🐦 [Flow] X Posts step — ${handles.length} account(s), latest ${perAccount} each`);

  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const windowMs = cacheWindowMs(undefined);
  const windowDays = Math.round(windowMs / DAY_MS);
  const seen = new Set(
    readSeenEntries(await xPostsCheckpoints.load(stepId), nowIso)
      .filter((entry) => now - Date.parse(entry.seenAt) <= windowMs)
      .map((entry) => entry.link),
  );
  const isFresh = (post: XPost): boolean => now - post.createdAt <= windowMs;

  const gate = new Semaphore(X_FETCH_CONCURRENCY);
  const fetched = await Promise.all(handles.map((handle) => gate.runExclusive(() => fetchAccount(handle, perAccount))));

  const emitted: XPost[] = [];
  const allKeys: string[] = [];
  let readable = 0;
  for (const { handle, posts, logs } of fetched) {
    for (const line of logs) sendLog(line);
    if (!posts) continue;
    readable++;
    if (posts.length === 0) {
      sendLog(`🐦 [Flow] X Posts: @${handle} — no posts`);
      continue;
    }
    const accountKey = `x:${handle.toLowerCase()}`;
    allKeys.push(accountKey, ...posts.map((p) => p.link));

    if (!seen.has(accountKey)) {
      if (isFresh(posts[0])) {
        sendLog(`🐦 [Flow] X Posts: @${handle} — new account, seeding latest 1: ${describePost(posts[0], now)}`);
        emitted.push(posts[0]);
      } else {
        sendLog(`🐦 [Flow] X Posts: @${handle} — new account, latest post is older than ${windowDays} days — seeding none`);
      }
      continue;
    }
    const unseen = posts.filter((p) => !seen.has(p.link));
    const fresh = unseen.filter(isFresh);
    sendLog(`🐦 [Flow] X Posts: @${handle} — ${fresh.length} new post(s)`);
    for (const p of fresh) sendLog(`🐦 [Flow] X Posts: @${handle} — new: ${describePost(p, now)}`);
    emitted.push(...fresh);
  }

  // Every account failing is not "nothing new": a flow that reports nothing would go quiet for good.
  if (readable === 0) {
    throw new FlowUserError('flow.error.xUnreadable', {}, 'X Posts: none of the listed accounts could be read');
  }
  if (allKeys.length > 0) await reconcileSeenCache(xPostsCheckpoints, stepId, allKeys, undefined);

  if (emitted.length === 0) {
    sendLog('🐦 [Flow] X Posts: no new posts since last run');
    return '[]';
  }
  let out = [...emitted].sort((a, b) => b.createdAt - a.createdAt);
  if (out.length > MAX_NEW_PER_RUN) {
    sendLog(`🐦 [Flow] X Posts: capping to the latest ${MAX_NEW_PER_RUN} new post(s)`);
    for (const p of out.slice(MAX_NEW_PER_RUN)) sendLog(`🐦 [Flow] X Posts: dropped by the cap: ${describePost(p, now)}`);
    out = out.slice(0, MAX_NEW_PER_RUN);
  }
  sendLog(`🐦 [Flow] X Posts: returning ${out.length} post(s)`);
  return JSON.stringify(out.map(postItem));
}

/** "@handle"; "" for someone with only a display name — most Facebook commenters. */
function handleOf(post: XPost): string {
  return post.author ? `@${post.author}` : '';
}

function byline(post: XPost): string {
  const handle = handleOf(post);
  const who = handle ? `**${handle}**${post.name ? ` (${post.name})` : ''}` : post.name ? `**${post.name}**` : '';
  return [who, formatPostTime(post.createdAt)].filter(Boolean).join(' · ');
}

function postBlock(post: XPost): string {
  return [byline(post), post.text, post.link].filter(Boolean).join('\n');
}

/** A reply as the analysis reads it: who and what. Its own link says nothing about either. */
function replyBlock(post: XPost): string {
  return [byline(post), post.text].filter(Boolean).join('\n');
}

function postRecord(post: XPost): Record<string, string> {
  return {
    author: handleOf(post),
    name: post.name,
    date: formatPostTime(post.createdAt),
    text: post.text,
    link: post.link,
    likes: String(post.likeCount),
  };
}

/**
 * The step's output. `subject` says what was read — `post` and its replies, or a whole `account`
 * (an Instagram profile, `account` its summed-up text) — so the analysis picks its prompt.
 */
export function buildXThreadEnvelope(focal: XPost, replies: XPost[], platform = 'X', account?: XThread['account']): string {
  const replyText = replies.map(replyBlock).join('\n\n---\n\n');
  return JSON.stringify({
    output: account ? account.text : [postBlock(focal), replyText].filter(Boolean).join('\n\n---\n\n'),
    subject: account ? 'account' : 'post',
    ...(account ? { posts: String(account.posts) } : {}),
    platform,
    text: focal.text,
    author: handleOf(focal),
    name: focal.name,
    date: formatPostTime(focal.createdAt),
    link: focal.link,
    image: focal.image,
    replyCount: String(focal.replyCount),
    shown: String(replies.length),
    replies: JSON.stringify(replies.map(postRecord)),
    replyText,
  });
}

export async function execXThread(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  // The link is the first word: the built-in "analyze" passes the button's line, `<link> analyze`.
  const url = (config.url ?? '').trim().split(/\s+/)[0] ?? '';
  const link = parseXMediaInput(url);
  if (!link) {
    throw new FlowUserError('flow.error.xPostUrl', { url }, `X Thread: not an X, Threads, Instagram, Facebook, TikTok, PTT, Dcard or Reddit post URL: ${url}`);
  }
  const parsedMax = parseInt(config.maxReplies ?? '', 10);
  const maxReplies = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : DEFAULT_MAX_REPLIES;

  const site = siteName(link.source);
  sendLog(`🐦 [Flow] ${site} Thread step — ${link.id}`);
  const thread = await readLinkedThread(link, 'Thread', signal, readAccessOf(config));
  // An article's pushes (PTT) are read by a character budget, sampled past it.
  if (thread.pushes) {
    sendLog(`🐦 [Flow] ${site} Thread: ${thread.pushes.lines.length} push(es) read`);
    return buildPushThreadEnvelope(thread.focal, thread.pushes, maxReplies, site);
  }
  const replies = thread.replies.slice(0, maxReplies);
  sendLog(`🐦 [Flow] ${site} Thread: @${thread.focal.author} — ${replies.length} of ${thread.focal.replyCount} repl(ies) readable`);
  return buildXThreadEnvelope(thread.focal, replies, site, thread.account);
}

const DEFAULT_MAX_TRENDS = 20;
const DEFAULT_POSTS_PER_TREND = 5;
/** A search page holds about 20 posts before it is scrolled; that first page is what a trend gets. */
const MAX_POSTS_PER_TREND = 20;
/** A long-form post is cut here: twenty trends' worth of essays would not fit one llm prompt. */
const TREND_POST_MAX_CHARS = 500;
/** No search starts this close to the step's timeout: one slow page takes up to ~45 s, and a timed-out step returns nothing at all. */
const TREND_SEARCH_RESERVE_MS = 60_000;

/**
 * Each trend's top posts, one search at a time — each is a request on the user's own account. A
 * trend whose search fails, or that the step's time runs out before, keeps an empty list.
 */
async function readPostsPerTrend(trends: XTrend[], perTrend: number, deadline: number): Promise<XPost[][]> {
  const out: XPost[][] = trends.map(() => []);
  let read = 0;
  for (const [index, trend] of trends.entries()) {
    if (Date.now() > deadline) {
      sendLog(`🐦 [Flow] X Trends: out of time — ${trends.length - index} trend(s) left without posts`);
      break;
    }
    try {
      out[index] = (await readTrendPosts(trend)).slice(0, perTrend);
      read++;
      sendLog(`🐦 [Flow] X Trends: "${trend.name}" — ${out[index].length} top post(s)`);
    } catch (err) {
      sendLog(`🐦 [Flow] X Trends: "${trend.name}" — posts unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (read === 0 && trends.length > 0) sendLog('🐦 [Flow] X Trends: no trend\'s posts could be read — returning the names only');
  return out;
}

/** A snapshot, like gmap_reviews: no seen-cache — a trend still trending tomorrow is still news tomorrow. */
export async function execXTrends(config: Record<string, string>): Promise<string> {
  const started = Date.now();
  const parsedMax = parseInt(config.maxItems ?? '', 10);
  const maxItems = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_TRENDS;
  const parsedPosts = parseInt(config.postsPerTrend ?? '', 10);
  const perTrend = Math.min(MAX_POSTS_PER_TREND, Number.isFinite(parsedPosts) && parsedPosts >= 0 ? parsedPosts : DEFAULT_POSTS_PER_TREND);
  sendLog(`🐦 [Flow] X Trends step — up to ${maxItems} trend(s), ${perTrend} top post(s) each`);
  let trends;
  try {
    trends = await readXTrends();
  } catch (err) {
    if (err instanceof XSignInRequiredError) {
      throw new FlowUserError('flow.error.xSignInRequired', {}, `X Trends: ${err.message}`);
    }
    throw err;
  }
  const picked = trends.slice(0, maxItems);
  const posts = perTrend > 0
    ? await readPostsPerTrend(picked, perTrend, started + BROWSER_STEP_TIMEOUT_MS - TREND_SEARCH_RESERVE_MS)
    : picked.map(() => []);
  return JSON.stringify(picked.map((trend, index) => ({
    title: trend.name,
    link: trend.link,
    context: trend.context,
    volume: trend.volume,
    rank: String(index + 1),
    posts: posts[index].map((post) => ({ ...postRecord(post), text: clip(post.text, TREND_POST_MAX_CHARS) })),
  })));
}

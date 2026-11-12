import { threadsPostLink } from '../../../shared/threadsLinks';
import { arr, findJson, num, obj, scriptJson, str, type Json } from './jsonPick';
import { ownMedia, queryData, readPrefetchedQueries as readPrefetchedPageQueries } from './metaMedia';
import { audienceFromFlag, combineAudience, type PostAudience } from './postAudience';
import type { XMedia, XPost, XThread } from './xPosts';

/**
 * Reading a Threads post page. Signed out, the page a browser navigates to carries the post and
 * its first direct replies as Relay query results in `<script type="application/json" data-sjs>`
 * blocks; a signed-in page may name its queries otherwise, so the post is also found by its
 * shortcode. The JSON is parsed, never run.
 */

/** The post page's queries by name prefix: the post itself, and the replies under it. */
const TARGET_QUERY = 'adp_BarcelonaPostPageTargetQuery';
const REPLIES_QUERY = 'adp_BarcelonaPostPageDownwardQuery';

/** Every prefetched query result on the page, `data` by query name; only these blocks hold posts. */
export function readPrefetchedQueries(html: string): Map<string, Json> {
  return readPrefetchedPageQueries(html, '"adp_Barcelona');
}

function appInfo(media: Json): Json | undefined {
  return obj(media.text_post_app_info);
}

/**
 * Everything the post shows as its own: its media, then a reel or post it links inline (a text
 * post with a video under it is one of those).
 */
function postMedia(media: Json): XMedia[] {
  const linked = obj(appInfo(media)?.linked_inline_media);
  return [...ownMedia(media), ...(linked ? ownMedia(linked) : [])];
}

function captionOf(media: Json): string {
  const caption = str(obj(media.caption)?.text);
  if (caption) return caption;
  return arr(obj(appInfo(media)?.text_fragments)?.fragments).map((f) => str(obj(f)?.plaintext)).join('');
}

/** The quoted (or reposted) post, whose media stands in when the post has none. */
function quotedPost(media: Json): Json | null {
  const share = obj(appInfo(media)?.share_info);
  return obj(share?.quoted_post) ?? obj(share?.reposted_post) ?? null;
}

function quoteBlock(quoted: Json | null): string {
  if (!quoted) return '';
  const text = captionOf(quoted);
  if (!text) return '';
  const author = str(obj(quoted.user)?.username);
  return `${author ? `@${author}: ` : ''}${text}`.split('\n').map((line) => `> ${line}`).join('\n');
}

/** A shared link the text does not already hold: an inline reel's page, an article's card. */
function linkCard(media: Json): string {
  const url = str(obj(appInfo(media)?.link_preview_attachment)?.url);
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * Who Threads shows a post to, by its author: a private profile's posts only its approved
 * followers see (`text_post_app_is_private`, Threads' own flag, apart from the Instagram account's).
 * No flag: unknown. Never read from a visitor being turned away, which is about the viewer.
 */
function authorAudience(media: Json): PostAudience {
  const isPrivate = obj(media.user)?.text_post_app_is_private;
  return audienceFromFlag(typeof isPrivate === 'boolean' ? !isPrivate : undefined);
}

export function readThreadsPost(value: unknown): XPost | null {
  const media = obj(value);
  const code = str(media?.code);
  const author = str(obj(media?.user)?.username);
  if (!media || !code || !author) return null;
  const quoted = quotedPost(media);
  const own = captionOf(media);
  const card = linkCard(media);
  const items = postMedia(media);
  return {
    id: code,
    author,
    name: str(obj(media.user)?.full_name),
    createdAt: num(media.taken_at) * 1_000,
    text: [own, card && !own.includes(card) ? card : '', quoteBlock(quoted)].filter(Boolean).join('\n\n'),
    link: threadsPostLink(author, code),
    image: items[0]?.image ?? '',
    replyCount: num(appInfo(media)?.direct_reply_count),
    likeCount: num(media.like_count),
    inReplyTo: '',
    isRepost: false,
    media: items,
    quoteMedia: quoted ? postMedia(quoted) : [],
    // A quoted post goes out with it (its text, its media): both must be public.
    audience: combineAudience(quoted ? [authorAudience(media), authorAudience(quoted)] : [authorAudience(media)]),
  };
}

/** The direct replies in the page's order; each reply's thread may continue below it. */
function readReplies(data: Json | undefined, focalCode: string): XPost[] {
  const edges = arr(obj(appInfo(obj(data?.media) ?? {})?.direct_replies)?.edges);
  const out: XPost[] = [];
  for (const edge of edges) {
    for (const item of arr(obj(obj(obj(edge)?.node)?.posts)?.edges)) {
      const post = readThreadsPost(obj(item)?.node);
      if (post && post.id !== focalCode) out.push(post);
    }
  }
  return out;
}

/** How deep the shortcode search looks: a page's data blocks nest a post a dozen or more levels down. */
const FIND_DEPTH = 40;

/** How much of the post a copy carries: the page may name it more than once, some copies bare. */
function filled(post: XPost): number {
  return (post.media.length > 0 ? 2 : 0) + (post.text ? 1 : 0);
}

/**
 * The post a shortcode names, wherever the page's `data-sjs` data holds it: a node with that `code`
 * and an author, the copy carrying the most of it. For a page that does not name its queries as a
 * visitor's does (signed in).
 */
function findPostByCode(html: string, code: string): XPost | null {
  const stack: Array<[unknown, number]> = [...scriptJson(html, { sjsOnly: true, marker: `"${code}"` })].map((block) => [block, 0]);
  let best: XPost | null = null;
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (!value || typeof value !== 'object') continue;
    const node = obj(value);
    const post = node && str(node.code) === code ? readThreadsPost(node) : null;
    if (post && (!best || filled(post) > filled(best))) best = post;
    if (depth < FIND_DEPTH) for (const child of Object.values(value)) stack.push([child, depth + 1]);
  }
  return best;
}

/** The page's direct replies: the visitor page's replies query, else whatever post node carries them. */
function repliesData(html: string, queries: Map<string, Json>): Json | undefined {
  const named = queryData(queries, REPLIES_QUERY);
  if (named) return named;
  const blocks = [...scriptJson(html, { sjsOnly: true, marker: '"direct_replies"' })];
  const media = findJson(blocks, (node) => arr(obj(appInfo(node)?.direct_replies)?.edges).length > 0);
  return media ? { media } : undefined;
}

/**
 * The post and the replies the page carries; null when the page held no post. `code`, the post's
 * shortcode, finds it where the visitor page's query names do not (a signed-in page); replies
 * missing from the page leave the post alone, never a failed read.
 */
export function readThreadsThread(html: string, code = ''): XThread | null {
  const queries = readPrefetchedQueries(html);
  const named = readThreadsPost(queryData(queries, TARGET_QUERY)?.media);
  const focal = named ?? (code ? findPostByCode(html, code) : null);
  if (!focal) return null;
  const replies = named ? queryData(queries, REPLIES_QUERY) : repliesData(html, queries);
  return { focal, replies: readReplies(replies, focal.id) };
}

/** The route of the page Threads answers with, at a post's own address, for a post it holds back. */
const RESTRICTED_ROUTE = 'BarcelonaGeoBlockRoute';

/** That page's route in its `data-sjs` data; undefined on any other page. */
function restrictedRoute(html: string): Json | undefined {
  const blocks = [...scriptJson(html, { sjsOnly: true, marker: RESTRICTED_ROUTE })];
  const route = findJson(blocks, (node) => typeof node.canonicalRouteName === 'string');
  return str(route?.canonicalRouteName).endsWith(`.${RESTRICTED_ROUTE}`) ? route : undefined;
}

/**
 * Who that page was served to, by the `actorID` on its route: "0" is a visitor — sent with the
 * sign-in's cookies, Threads no longer counts them as signed in — anything else an account. null
 * when the page is not that one.
 */
export function threadsRestrictedViewer(html: string): 'visitor' | 'account' | null {
  const route = restrictedRoute(html);
  if (!route) return null;
  return route.actorID === '0' || route.actorID === 0 ? 'visitor' : 'account';
}

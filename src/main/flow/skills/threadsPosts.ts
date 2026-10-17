import { threadsPostLink } from '../../../shared/threadsLinks';
import { arr, num, obj, str, type Json } from './jsonPick';
import { ownMedia, queryData, readPrefetchedQueries as readPrefetchedPageQueries } from './metaMedia';
import type { XMedia, XPost, XThread } from './xPosts';

/**
 * Reading a Threads post page. Signed out, the page a browser navigates to carries the post and
 * its first direct replies as Relay query results in `<script type="application/json" data-sjs>`
 * blocks. The JSON is parsed, never run.
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

/** The post and the replies the page carries; null when the page held no post. */
export function readThreadsThread(html: string): XThread | null {
  const queries = readPrefetchedQueries(html);
  const focal = readThreadsPost(queryData(queries, TARGET_QUERY)?.media);
  if (!focal) return null;
  return { focal, replies: readReplies(queryData(queries, REPLIES_QUERY), focal.id) };
}

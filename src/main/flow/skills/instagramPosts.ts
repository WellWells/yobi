import {
  instagramHighlightLink, instagramMediaId, instagramPostLink, instagramStoriesLink, instagramStoryLink, type InstagramRef,
} from '../../../shared/instagramLinks';
import { arr, num, obj, str, type Json } from './jsonPick';
import { idOf, mediaItem, ownMedia, queryData, readPrefetchedQueries } from './metaMedia';
import { audienceFromFlag, type PostAudience } from './postAudience';
import type { PostPicks, XMedia, XPost, XThread } from './xPosts';

/**
 * Instagram posts, reels and stories, from a signed-out post page or the signed-in web API. Media
 * is Threads' shape, read by `metaMedia`. The JSON is parsed, never run.
 */

const PAGE_QUERY = 'adp_PolarisLoggedOutDesktopWWWPostRootContentQuery';

function emptyPost(): Omit<XPost, 'id' | 'author' | 'name' | 'createdAt' | 'text' | 'link'> {
  return { image: '', replyCount: 0, likeCount: 0, inReplyTo: '', isRepost: false, media: [], quoteMedia: [] };
}

function linkOf(media: Json, author: string): string {
  if (str(media.product_type) === 'story') return instagramStoryLink(author, idOf(media.pk));
  return instagramPostLink(str(media.code), str(media.product_type) === 'clips');
}

/**
 * Who Instagram shows a post to: a private account's posts only its approved followers see
 * (`user.is_private`, on both the page's and the API's user); a post shared with the author's
 * close friends alone carries an `audience` other than the default.
 */
function instagramAudience(media: Json, user: Json | undefined): PostAudience {
  const audience = str(media.audience);
  if (audience && audience !== 'default') return 'restricted';
  return audienceFromFlag(typeof user?.is_private === 'boolean' ? !user.is_private : undefined);
}

/** A post, reel or story as the page or the API describes it; null without a code or an account. */
export function readInstagramPost(value: unknown): XPost | null {
  const media = obj(value);
  const user = obj(media?.user);
  const author = str(user?.username);
  if (!media || !author || !(str(media.code) || idOf(media.pk))) return null;
  const items = ownMedia(media);
  return {
    ...emptyPost(),
    id: str(media.code) || idOf(media.pk),
    author,
    name: str(user?.full_name),
    createdAt: num(media.taken_at) * 1_000,
    text: str(obj(media.caption)?.text),
    link: linkOf(media, author),
    image: items[0]?.image ?? '',
    replyCount: num(media.comment_count),
    likeCount: num(media.like_count),
    media: items,
    audience: instagramAudience(media, user),
  };
}

/** A comment, from the page's `comments_connection` node or the API's `comments` list. */
function readComment(value: unknown, postLink: string): XPost | null {
  const comment = obj(value);
  const user = obj(comment?.user);
  const id = idOf(comment?.pk) || idOf(comment?.id);
  const text = str(comment?.text);
  if (!comment || !id || !text) return null;
  return {
    ...emptyPost(),
    id,
    author: str(user?.username),
    name: str(user?.full_name),
    createdAt: num(comment.created_at) * 1_000,
    text,
    link: `${postLink}c/${id}/`,
    replyCount: num(comment.child_comment_count),
    likeCount: num(comment.comment_like_count),
  };
}

export function readComments(list: readonly unknown[], postLink: string): XPost[] {
  return list.map((c) => readComment(c, postLink)).filter((c): c is XPost => c !== null);
}

/** The post and the comments a signed-out post page carries; null when it held no post. */
export function readInstagramPage(html: string): XThread | null {
  const data = queryData(readPrefetchedQueries(html, `"${PAGE_QUERY}`), PAGE_QUERY);
  const root = obj(data?.xig_polaris_media);
  const focal = readInstagramPost(root?.if_not_gated_logged_out);
  if (!root || !focal) return null;
  const nodes = arr(obj(root.comments_connection)?.edges).map((edge) => obj(edge)?.node);
  return { focal, replies: readComments(nodes, focal.link) };
}

/** The first item of a `media/<id>/info/` answer. */
export function readInfoItem(body: unknown): XPost | null {
  return readInstagramPost(arr(obj(body)?.items)[0]);
}

/** How deep `findPostIn` looks: a page's own JSON blocks nest the post about 16 levels down. */
const FIND_DEPTH = 40;

/**
 * The post a shortcode names, wherever it sits in what a signed-in post page held or received
 * (`signedInPage.ts`), found by its id rather than by a query name. null when none is there.
 */
export function findPostIn(values: readonly unknown[], code: string): XPost | null {
  const mediaId = instagramMediaId(code);
  const stack: Array<[unknown, number]> = values.map((value) => [value, 0]);
  // The page names the post more than once, some copies without its media:
  // the first copy with media wins, a bare one only when there is no other.
  let bare: XPost | null = null;
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (Array.isArray(value)) {
      if (depth < FIND_DEPTH) for (const item of value) stack.push([item, depth + 1]);
      continue;
    }
    const node = obj(value);
    if (!node) continue;
    const pk = idOf(node.pk) || idOf(node.id).split('_')[0];
    if (pk === mediaId && str(node.code) && obj(node.user)) {
      const post = readInstagramPost(node);
      if (post && post.media.length > 0) return post;
      bare ??= post;
    }
    if (depth < FIND_DEPTH) for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push([child, depth + 1]);
  }
  return bare;
}

/** "All" takes at most this many items of an account's stories or a highlight, the newest. */
export const MAX_STORY_ITEMS = 20;

export interface StoryReelItem {
  /** The story's media id, the last part of its own link. */
  id: string;
  /** Epoch ms. */
  createdAt: number;
  media: XMedia;
}

export interface StoryReel {
  author: string;
  name: string;
  /** A highlight's name; "" for an account's current stories. */
  title: string;
  /** Oldest first, as Instagram plays them; items with nothing to download are left out. */
  items: StoryReelItem[];
  /** The newest item's time, epoch ms. */
  latestAt: number;
}

/** One reel of a `feed/reels_media/` answer — an account's stories or a highlight — by its key. */
export function readStoryReel(body: unknown, key: string): StoryReel | null {
  const reel = obj(obj(obj(body)?.reels)?.[key]);
  const user = obj(reel?.user);
  if (!reel || !user) return null;
  const items = arr(reel.items).map(obj).filter((m): m is Json => m !== undefined);
  return {
    author: str(user.username),
    name: str(user.full_name),
    title: str(reel.title),
    items: items.flatMap((m) => {
      const id = idOf(m.pk);
      const media = id ? mediaItem(m) : null;
      return media ? [{ id, createdAt: num(m.taken_at) * 1_000, media }] : [];
    }),
    latestAt: Math.max(0, ...items.map((m) => num(m.taken_at))) * 1_000,
  };
}

/** The link that takes every item of the reel a link names: the account's stories, or the highlight. */
function allLink(reel: StoryReel, ref: InstagramRef): string {
  return ref.kind === 'highlight' ? instagramHighlightLink(ref.id, 'all') : instagramStoriesLink(reel.author, 'all');
}

/** The link that takes one item alone: the story's own, or the highlight naming the item. */
function oneLink(reel: StoryReel, ref: InstagramRef, item: StoryReelItem): string {
  return ref.kind === 'highlight' ? instagramHighlightLink(ref.id, 'one', item.id) : instagramStoryLink(reel.author, item.id, 'one');
}

/**
 * A reel as one post to forward: whose it is, the highlight's name, the newest 20 items' media.
 * Unless the link chose `all` (or there is only one), it also offers every item to choose from
 * (`picks`, a menu as a person's Facebook stories get), each button a link to that story alone;
 * a story link stars its own. A button's link (`one`) is read from the same reel as the menu, the
 * item picked out by its id. null when that item is gone.
 */
export function storyReelPost(reel: StoryReel, ref: InstagramRef): XPost | null {
  const newest = reel.items.slice(-MAX_STORY_ITEMS);
  const post: XPost = {
    ...emptyPost(),
    id: ref.id,
    author: reel.author,
    name: reel.name,
    createdAt: reel.latestAt,
    text: reel.title,
    // The link as Instagram writes it: Yobi's own choice (`?yobi=`, a highlight's item) is the only query a rebuilt link has.
    link: ref.url.replace(/\?.*$/, ''),
    image: newest[0]?.media.image ?? '',
    media: newest.map((item) => item.media),
  };
  if (ref.pick === 'one') {
    const item = reel.items.find((i) => i.id === ref.item);
    return item ? { ...post, id: item.id, createdAt: item.createdAt, image: item.media.image, media: [item.media] } : null;
  }
  if (ref.pick === 'all' || reel.items.length === 1) return post;
  const linked = ref.kind === 'story' ? ref.id : '';
  const picks: PostPicks = {
    items: reel.items.map((item, index) => ({
      link: oneLink(reel, ref, item),
      number: index + 1,
      media: item.media,
      linked: item.id === linked,
    })),
    all: allLink(reel, ref),
  };
  return { ...post, picks };
}

/** The account id an Instagram profile page names, which the stories API asks for. */
export function readProfileId(html: string): string {
  return /"profile_id":"(\d{1,25})"/.exec(html)?.[1] ?? '';
}

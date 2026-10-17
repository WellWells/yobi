import { compactPreview } from '../../../shared/textBudget';
import type { PhotoCopy } from '../../../shared/xMedia';
import { arr, num, obj, str, type Json } from './jsonPick';
import type { XMedia, XPost } from './xPosts';

/*
 * A Dcard post is read from, in order: the page's Next.js data, the v2 posts API, the page's
 * `SocialMediaPosting` ld+json, then its head; comments come from the v3 comments API.
 */

/**
 * A comment's length in the analysis: 130 of Dcard's at full length could fill Gemini's web input
 * (33,499 characters) on their own; the most-liked come first, so a cut tail loses the least.
 */
export const COMMENT_MAX_CHARS = 300;

/** Dcard's own media host; anything else in a post's data is not fetched. */
export function isDcardMediaHost(host: string): boolean {
  return /^megapx(?:-assets)?\.dcard\.tw$/i.test(host);
}

/** An https URL on Dcard's media host, as written; "" for anything else. */
export function dcardMediaUrl(value: unknown): string {
  try {
    const url = new URL(str(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    return isDcardMediaHost(url.hostname) ? url.toString() : '';
  } catch {
    return '';
  }
}

/** The long sides megapx resizes a picture to (`<base>/<n>`). */
const COPY_SIDES = [640, 1280] as const;

/** A picture's base (`…/images/<uuid>`): its URL without the size, for the resized copies. */
function pictureBase(url: string): string {
  const found = /^(https:\/\/[^/]+\/images\/[0-9a-f-]{36})(?:\/|$)/i.exec(url);
  return found?.[1] ?? '';
}

/** The resized copies of a picture of `width`×`height`, smaller than the original only. */
function pictureCopies(url: string, width: number, height: number): PhotoCopy[] {
  const base = pictureBase(url);
  const long = Math.max(width, height);
  if (!base || long <= 0) return [];
  const copies = COPY_SIDES.filter((side) => side < long).map((side) => ({
    url: `${base}/${side}`,
    width: Math.round(width * side / long),
    height: Math.round(height * side / long),
  }));
  return [...copies, { url, width, height }];
}

function photo(url: string, width: number, height: number): XMedia {
  const copies = pictureCopies(url, width, height);
  return { kind: 'photo', image: url, width, height, durationMs: 0, variants: [], ...(copies.length > 0 ? { copies } : {}) };
}

/** The post's pictures and videos, in order: each `image/megapx` and `video/megapx` once. */
export function dcardMedia(mediaMeta: unknown): XMedia[] {
  const seen = new Set<string>();
  const out: XMedia[] = [];
  for (const raw of arr(mediaMeta)) {
    const meta = obj(raw);
    const type = str(meta?.type);
    const url = dcardMediaUrl(meta?.url);
    if (!meta || !url || seen.has(url)) continue;
    const width = num(meta.width);
    const height = num(meta.height);
    if (type === 'image/megapx') {
      seen.add(url);
      out.push(photo(url, width, height));
    } else if (type === 'video/megapx') {
      seen.add(url);
      const poster = dcardMediaUrl(meta.thumbnail);
      out.push({
        kind: 'video',
        image: poster,
        width,
        height,
        durationMs: Math.round(num(meta.duration) * 1_000),
        variants: [{ url, bitrate: 0, width, height }],
      });
    }
  }
  return out;
}

/** Epoch ms of an ISO time; 0 when there is none. */
function time(value: unknown): number {
  const ms = Date.parse(str(value));
  return Number.isFinite(ms) ? ms : 0;
}

const MEDIA_LINK = /https:\/\/megapx(?:-assets)?\.dcard\.tw\/\S+/gi;

/**
 * The body as read: the media links Dcard writes inline dropped (the pictures and videos go as
 * files), runs of blank lines closed up.
 */
function bodyText(content: string): string {
  return content
    .replace(MEDIA_LINK, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withTitle(title: string, body: string): string {
  return [title.trim(), body].filter(Boolean).join('\n\n');
}

/** Who posted, as Dcard shows it: the persona's nickname, else the school (anonymous posts show only that). */
function posterName(post: Json): string {
  return str(post.personaNickname).trim() || str(post.school).trim() || str(post.department).trim();
}

/** The post's own link: under its forum when the answer says which, else the link that was read. */
function postLink(post: Json, id: string, fallback: string): string {
  const forum = str(post.forumAlias);
  return /^[A-Za-z0-9_.-]{1,40}$/.test(forum) ? `https://www.dcard.tw/f/${forum.toLowerCase()}/p/${id}` : fallback;
}

/**
 * The post in a `/service/api/v2/posts/<id>` answer; null when it is not one (an error body,
 * another post's id).
 */
export function dcardPostFromApi(body: unknown, id: string, link: string): XPost | null {
  const post = obj(body);
  if (!post || String(post.id ?? '') !== id) return null;
  const title = str(post.title);
  const content = str(post.content);
  if (!title && !content) return null;
  const media = dcardMedia(post.mediaMeta);
  return {
    id,
    author: str(post.personaUid).trim(),
    name: posterName(post),
    createdAt: time(post.createdAt),
    text: withTitle(title, bodyText(content)),
    link: postLink(post, id, link),
    image: media[0]?.image ?? '',
    // Replies included, as the page shows it: `commentCount` counts the top-level ones only.
    replyCount: num(post.totalCommentCount) || num(post.commentCount),
    likeCount: num(post.likeCount),
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia: [],
  };
}

/**
 * The post in the page's own Next.js data (the `__NEXT_DATA__` script's text): the React Query
 * entry `["post", "<id>", …]` the server rendered into the page, the same record the v2 API
 * answers. Null when the text is not JSON or holds no such entry with that post.
 */
export function dcardPostFromNextData(text: string, id: string, link: string): XPost | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  for (const raw of arr(obj(obj(obj(data)?.props)?.dehydratedState)?.queries)) {
    const query = obj(raw);
    const key = arr(query?.queryKey);
    if (key[0] === 'post' && String(key[1] ?? '') === id) return dcardPostFromApi(obj(query?.state)?.data, id, link);
  }
  return null;
}

/** A schema.org count by its interaction type (`LikeAction`, `CommentAction`). */
function interactionCount(posting: Json, action: string): number {
  for (const raw of arr(posting.interactionStatistic)) {
    const stat = obj(raw);
    const type = str(stat?.interactionType) || str(obj(stat?.interactionType)?.['@type']);
    if (stat && type.endsWith(action)) return num(stat.userInteractionCount);
  }
  return 0;
}

/** An ld+json image: a URL, or an `ImageObject` with `url`/`contentUrl`. */
function ldImageUrl(value: unknown): string {
  if (typeof value === 'string') return dcardMediaUrl(value);
  const image = obj(value);
  return dcardMediaUrl(image?.contentUrl) || dcardMediaUrl(image?.url);
}

function ldMedia(posting: Json): XMedia[] {
  const images = Array.isArray(posting.image) ? posting.image : posting.image ? [posting.image] : [];
  const out: XMedia[] = images.flatMap((raw): XMedia[] => {
    const url = ldImageUrl(raw);
    if (!url) return [];
    const image = obj(raw);
    return [photo(url, num(image?.width), num(image?.height))];
  });
  const videos = Array.isArray(posting.video) ? posting.video : posting.video ? [posting.video] : [];
  for (const raw of videos) {
    const video = obj(raw);
    const url = dcardMediaUrl(video?.contentUrl);
    if (!video || !url) continue;
    const thumbnail = Array.isArray(video.thumbnailUrl) ? video.thumbnailUrl[0] : video.thumbnailUrl;
    out.push({
      kind: 'video', image: dcardMediaUrl(thumbnail), width: num(video.width), height: num(video.height),
      durationMs: 0, variants: [{ url, bitrate: 0, width: num(video.width), height: num(video.height) }],
    });
  }
  return out;
}

function authorName(value: unknown): string {
  const author = Array.isArray(value) ? obj(value[0]) : obj(value);
  return str(author?.name).trim();
}

/** The `SocialMediaPosting` among a page's ld+json blocks (each a JSON text); undefined when none parses. */
function findPosting(blocks: readonly string[]): Json | undefined {
  for (const text of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed, ...arr(obj(parsed)?.['@graph'])];
    for (const raw of nodes) {
      const node = obj(raw);
      const type = node?.['@type'];
      if (node && (type === 'SocialMediaPosting' || (Array.isArray(type) && type.includes('SocialMediaPosting')))) return node;
    }
  }
  return undefined;
}

/**
 * The post in the rendered page's `SocialMediaPosting` ld+json, and the comments it lists (the first
 * 30); null when the page has no such block.
 */
export function dcardPostFromLd(blocks: readonly string[], id: string, link: string): { post: XPost; comments: XPost[] } | null {
  const posting = findPosting(blocks);
  if (!posting) return null;
  const title = str(posting.headline);
  const body = str(posting.articleBody) || str(posting.text);
  if (!title && !body) return null;
  const media = ldMedia(posting);
  const post: XPost = {
    id,
    author: '',
    name: authorName(posting.author),
    createdAt: time(posting.datePublished),
    text: withTitle(title, bodyText(body)),
    link,
    image: media[0]?.image ?? '',
    replyCount: interactionCount(posting, 'CommentAction') || num(posting.commentCount),
    likeCount: interactionCount(posting, 'LikeAction'),
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia: [],
  };
  const comments = arr(posting.comment).flatMap((raw, index): XPost[] => {
    const comment = obj(raw);
    const text = bodyText(str(comment?.text));
    if (!comment || !text) return [];
    return [reply(`${id}-ld-${index + 1}`, authorName(comment.author), time(comment.datePublished), text, link, 0, 0)];
  });
  return { post, comments };
}

/** What the page's head says when nothing else could be read: og title, description and pictures. */
export interface DcardPageMeta {
  title: string;
  description: string;
  images: string[];
}

/** Dcard's own suffix on a page title (` | Dcard`), and the forum name before it. */
function withoutSiteSuffix(title: string): string {
  return title
    .replace(/\s*[|｜\-–]\s*[^|｜\-–]*Dcard\s*$/i, '')
    .replace(/\s*[|｜\-–]\s*[^|｜\-–]{1,20}板\s*$/, '')
    .trim();
}

/**
 * The post as far as the page's head tells it (the title and a 150-character description): the
 * last resort, when neither the API nor the rendered page answered. Null when even the title is
 * missing.
 */
export function dcardPostFromMeta(meta: DcardPageMeta, id: string, link: string): XPost | null {
  const title = withoutSiteSuffix(meta.title);
  // Dcard's own name alone is a page that is not a post (its home, its "not found").
  if (!title || /^dcard$/i.test(title)) return null;
  const media = meta.images.map(dcardMediaUrl).filter(Boolean).slice(0, 3).map((url) => photo(url, 0, 0));
  return {
    id,
    author: '',
    name: '',
    createdAt: 0,
    text: withTitle(title, meta.description.trim()),
    link,
    image: media[0]?.image ?? '',
    replyCount: 0,
    likeCount: 0,
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia: [],
  };
}

function reply(id: string, name: string, createdAt: number, text: string, link: string, likes: number, replies: number): XPost {
  return {
    id, author: '', name, createdAt, text, link, image: '', replyCount: replies, likeCount: likes,
    inReplyTo: '', isRepost: false, media: [], quoteMedia: [],
  };
}

/**
 * One page of `/service/api/v3/posts/<id>/comments`: the comments with text, in the order asked
 * for. Each is named as Dcard shows it — its floor (`B5`, a reply `B5-1`) and who wrote it, the
 * poster marked `(OP)` — so the analysis can tell a reply from a comment and the poster from the
 * rest. `parent` is the comment `parentId` asked for, when this is its replies.
 */
export function dcardComments(body: unknown, postLink: string, parent?: DcardComment): DcardComment[] {
  return arr(obj(body)?.items).flatMap((raw): DcardComment[] => {
    const comment = obj(raw);
    if (!comment || comment.hidden === true || comment.hiddenByAuthor === true || comment.inReview === true) return [];
    // One line each, and a long one cut: up to 130 of them go into one analysis prompt.
    const text = compactPreview(str(comment.content), COMMENT_MAX_CHARS);
    const id = str(comment.id);
    if (!text || !id) return [];
    const floor = num(comment.floor);
    const author = obj(comment.author);
    const who = str(author?.displayName).trim() || str(comment.school).trim();
    const op = author?.isPostAuthor === true || comment.host === true ? ' (OP)' : '';
    const place = parent ? `B${parent.floor}-${floor}` : `B${floor}`;
    const link = !parent && floor > 0 ? `${postLink}/b/${floor}` : postLink;
    const post = reply(id, `${place} ${who}${op}`.trim(), time(comment.createdAt), text, link, num(comment.likeCount), num(comment.subCommentCount));
    return [{ post: parent ? { ...post, inReplyTo: parent.post.id } : post, floor }];
  });
}

/** A comment as read, and its floor (the `5` of `B5`): what asking for its replies takes. */
export interface DcardComment {
  post: XPost;
  floor: number;
}

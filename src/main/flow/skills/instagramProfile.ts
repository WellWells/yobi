import { instagramMediaId, instagramProfileLink, instagramStoriesLink, type InstagramRef } from '../../../shared/instagramLinks';
import { xAnalyzeInput } from '../../../shared/builtinFlows';
import { sendLog } from '../../helpers';
import { decodeHtmlEntities } from '../../htmlEntities';
import { TIMELINE_KEY, type CapturedPage } from '../../instagram/signedInPage';
import { FlowUserError } from '../userError';
import { readInstagramPost, readProfileId, readStoryReel } from './instagramPosts';
import { arr, findJson, obj, str, type Json } from './jsonPick';
import { formatPostTime } from './xReader';
import type { XMedia, XPost, XThread } from './xPosts';

/**
 * An Instagram profile, read signed in, to download from or analyze, with requests kept slow.
 * One profile view, as a person makes it: the page opened in a
 * hidden window gives the account id, the summary Instagram writes, the bio and picture, and —
 * from what its own script fetches — the latest 12 posts with their media, captions, likes and
 * comment counts. Then, each spaced out, the menu asks whether stories are up and the analysis
 * reads one page of comments under the three most engaged posts.
 */

/** One page of the account's feed: what the menu, "all" and the analysis read. */
export const PROFILE_POSTS = 12;
/** Posts with a button of their own: a bot's 12 buttons also hold "analyze", "stories" and "all". */
export const MENU_POSTS = 9;
/** Files "all" takes at most, whole posts only (a carousel holds up to 10). */
export const PROFILE_MEDIA_MAX = 40;
/** Posts whose comments the analysis reads, one page (15) each. */
const COMMENTED_POSTS = 3;

/**
 * What reading the profile needs from the reader: the profile page opened signed in with what its
 * script received (`readSignedInProfile`), the API, comments, and the wait between requests.
 */
export interface ProfileIo {
  profile(author: string): Promise<CapturedPage>;
  api(path: string): Promise<{ status: number; body: unknown }>;
  comments(mediaId: string, postLink: string): Promise<XPost[]>;
  pause(): Promise<void>;
}

/** The page's meta values, entities decoded: `og:title`, `description`, `og:image`. */
function metaContent(html: string, name: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`\\b(?:name|property)=["']${name.replace(/[.:]/g, '\\$&')}["']`, 'i').test(tag)) continue;
    const content = /\bcontent=(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? '';
    return decodeHtmlEntities(content).trim();
  }
  return '';
}

export interface ProfilePage {
  id: string;
  /** The display name; "" when the page names none. */
  name: string;
  /** Instagram's own one-line summary (followers, following, posts), in the session's language. */
  summary: string;
  bio: string;
  /** The profile picture, https only. */
  picture: string;
}

/**
 * The account's own user record among the page's JSON: the object named `author` that carries a
 * bio. Signed in, the page also holds the VIEWER's record — bio and all, and earlier in the page —
 * so the first `biography` on the page is the user's own, not the account's. A post's `user`
 * names the account too but has no bio.
 */
export function findProfileUser(answers: readonly unknown[], author: string): Json | undefined {
  const name = author.toLowerCase();
  return findJson(answers, (node) => str(node.username).toLowerCase() === name && typeof node.biography === 'string');
}

/** What a signed-in profile page says about the account; `id` "" when it holds none. */
export function readProfilePage(page: Pick<CapturedPage, 'html' | 'answers'>, author: string): ProfilePage {
  const { html } = page;
  const title = metaContent(html, 'og:title');
  const name = new RegExp(`^(.*?)\\s*\\(@${author.replace(/\./g, '\\.')}\\)`, 'i').exec(title)?.[1]?.trim() ?? '';
  const user = findProfileUser(page.answers, author);
  const userId = [user?.id, user?.pk].map((v) => (typeof v === 'number' ? String(v) : str(v))).find((v) => /^\d{1,25}$/.test(v));
  const picture = metaContent(html, 'og:image');
  return {
    id: userId ?? readProfileId(html),
    name: name || str(user?.full_name).trim(),
    summary: metaContent(html, 'description') || metaContent(html, 'og:description'),
    bio: str(user?.biography).trim(),
    picture: /^https:\/\//i.test(picture) ? picture : '',
  };
}

/**
 * The posts the profile page's script received, newest first: the nodes of every
 * `TIMELINE_KEY` connection among its answers (the v1 media shape `readInstagramPost` reads), each
 * post once.
 */
export function readTimelinePosts(answers: readonly unknown[]): XPost[] {
  const out: XPost[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    const connection = obj(obj(obj(answer)?.data)?.[TIMELINE_KEY]);
    for (const edge of arr(connection?.edges)) {
      const post = readInstagramPost(obj(edge)?.node);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      out.push(post);
    }
  }
  return out;
}

/** How many stories the account has up: the menu's "stories" button; 0 when none or unreadable. */
async function storyCount(io: ProfileIo, id: string): Promise<number> {
  try {
    const { body } = await io.api(`feed/reels_media/?reel_ids=${id}`);
    return readStoryReel(body, id)?.items.length ?? 0;
  } catch (err) {
    sendLog(`📷 [Instagram] Stories unreadable on the profile: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** The posts "all" takes: the newest whole posts while their files fit `PROFILE_MEDIA_MAX`. */
export function allPosts(posts: readonly XPost[]): XPost[] {
  const out: XPost[] = [];
  let files = 0;
  for (const post of posts) {
    if (post.media.length === 0) continue;
    if (files + post.media.length > PROFILE_MEDIA_MAX) break;
    files += post.media.length;
    out.push(post);
  }
  return out;
}

/** The posts drawing the most likes and comments, among those with comments to read. */
export function mostEngaged(posts: readonly XPost[], count = COMMENTED_POSTS): XPost[] {
  return posts
    .filter((p) => p.replyCount > 0)
    .sort((a, b) => b.likeCount + b.replyCount - (a.likeCount + a.replyCount))
    .slice(0, count);
}

function mediaSummary(media: readonly XMedia[]): string {
  const photos = media.filter((m) => m.kind === 'photo').length;
  const videos = media.length - photos;
  const parts = [photos ? `${photos} photo${photos > 1 ? 's' : ''}` : '', videos ? `${videos} video${videos > 1 ? 's' : ''}` : ''];
  return parts.filter(Boolean).join(', ') || 'no media';
}

/**
 * The account as the analysis reads it: who, Instagram's summary and the bio, every post read
 * (time, media, likes, comments, caption), then the comments read under the most engaged posts.
 * Plain labels: the whole text is fenced as material, never instructions.
 */
export function accountDigest(profile: ProfilePage, author: string, link: string, posts: readonly XPost[], comments: ReadonlyMap<XPost, XPost[]>): string {
  const head = [
    `ACCOUNT: @${author}${profile.name ? ` (${profile.name})` : ''}`,
    profile.summary ? `PROFILE SUMMARY: ${profile.summary}` : '',
    `BIO: ${profile.bio || '(none)'}`,
    `LINK: ${link}`,
  ].filter(Boolean).join('\n');
  const postBlocks = posts.map((p, index) => [
    `[${index + 1}] ${formatPostTime(p.createdAt)} · ${mediaSummary(p.media)} · ${p.likeCount} likes · ${p.replyCount} comments`,
    p.text || '(no caption)',
    p.link,
  ].join('\n'));
  const commentBlocks = [...comments.entries()].map(([post, list]) => [
    `[${posts.indexOf(post) + 1}] ${list.length} of ${post.replyCount} comments read`,
    ...list.map((c) => `${c.author ? `@${c.author}` : c.name}: ${c.text}`),
  ].join('\n'));
  return [
    head,
    `LATEST POSTS (${posts.length}, newest first):\n\n${postBlocks.join('\n\n')}`,
    commentBlocks.length > 0 ? `COMMENTS ON THE MOST ENGAGED POSTS:\n\n${commentBlocks.join('\n\n')}` : 'COMMENTS: none could be read.',
  ].join('\n\n---\n\n');
}

/**
 * The profile as one post: its picture, bio and the media "all" takes; alone (the link without
 * `?yobi=all`) also a menu of the latest posts. With `comments` (the analysis), the account summed
 * up for the model instead of the stories count.
 */
export async function readInstagramProfile(ref: InstagramRef, io: ProfileIo, comments: boolean): Promise<XThread> {
  const author = ref.author;
  const page = await io.profile(author);
  const profile = page.status < 400 ? readProfilePage(page, author) : null;
  if (!profile?.id) {
    throw new FlowUserError('flow.error.instagramNoAccount', { account: `@${author}` }, `Instagram account not found: @${author} (HTTP ${page.status})`);
  }
  if (!findProfileUser(page.answers, author)) {
    // No bio shown rather than a wrong one; where to look when Instagram moves the record.
    sendLog(`📷 [Instagram] Profile @${author}: the account's own record (username + biography) is not among the page's data — bio left empty`);
  }
  const posts = readTimelinePosts(page.answers).slice(0, PROFILE_POSTS);
  if (posts.length === 0) {
    // What the page asked for instead: where to look when Instagram renames the query.
    sendLog(`📷 [Instagram] Profile @${author}: no posts among the page's answers — it asked ${page.operations.join(', ') || 'nothing'}`);
    throw new FlowUserError('flow.error.instagramNoPosts', { account: `@${author}` }, `No readable posts on @${author}: none yet, a private account, or the page changed`);
  }
  const name = profile.name || posts[0].name;
  const link = instagramProfileLink(author);
  const taken = allPosts(posts);
  const focal: XPost = {
    id: author,
    author,
    name,
    createdAt: posts[0].createdAt,
    text: profile.bio,
    link,
    image: profile.picture || posts[0].image,
    replyCount: 0,
    likeCount: 0,
    inReplyTo: '',
    isRepost: false,
    media: taken.flatMap((p) => p.media),
    quoteMedia: [],
  };

  if (comments) {
    const read = new Map<XPost, XPost[]>();
    for (const post of mostEngaged(posts)) {
      await io.pause();
      const list = await io.comments(instagramMediaId(post.id), post.link).catch((err: unknown) => {
        sendLog(`📷 [Instagram] Comments of ${post.link} unreadable: ${err instanceof Error ? err.message : String(err)}`);
        return [] as XPost[];
      });
      if (list.length > 0) read.set(post, list);
    }
    sendLog(`📷 [Instagram] Profile @${author}: ${posts.length} post(s), comments under ${read.size}`);
    return { focal, replies: [], account: { text: accountDigest({ ...profile, name }, author, link, posts, read), posts: posts.length } };
  }
  if (ref.pick === 'all') return { focal, replies: [] };

  await io.pause();
  const stories = await storyCount(io, profile.id);
  sendLog(`📷 [Instagram] Profile @${author}: ${posts.length} post(s), ${stories} stor${stories === 1 ? 'y' : 'ies'} up`);
  const items = posts.slice(0, MENU_POSTS).flatMap((post, index) =>
    post.media[0] ? [{ link: post.link, number: index + 1, media: post.media[0], linked: false }] : []);
  return {
    focal: {
      ...focal,
      picks: {
        items,
        all: instagramProfileLink(author, 'all'),
        account: {
          cover: profile.picture || posts[0].image,
          allCount: taken.length,
          ...(stories > 0 ? { stories: { count: stories, link: instagramStoriesLink(author) } } : {}),
          analyze: xAnalyzeInput(link),
        },
      },
    },
    replies: [],
  };
}

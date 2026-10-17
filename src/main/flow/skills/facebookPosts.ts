import { facebookHandleOf, parseFacebookUrl, type FacebookRef } from '../../../shared/facebookLinks';
import { photoMedia, videoMedia, type FacebookPage } from './facebookMedia';
import { arr, num, obj, str, type Json } from './jsonPick';
import { combineAudience, type PostAudience } from './postAudience';
import type { XMedia, XPost, XThread } from './xPosts';

/**
 * A Facebook post on its page: a video's post found by the video's id; a
 * post page's own post by the single-post route's node (`CometSinglePost…` › `node_v2`, a group's
 * post too), since a signed-in page also carries the home feed. Its fields are spread over several
 * copies of it, so every object with its id is read.
 */

export { photoMedia, readFacebookPage, readPhotoPage, videoMedia, type FacebookPage } from './facebookMedia';

/** The text of a `{ text }` field, or "". */
function textOf(value: unknown): string {
  return str(obj(value)?.text);
}

/** A post's own comments thread: `feedback:<post id>`, never a comment's (`feedback:<post>_<comment>`). */
function postFeedbackId(value: unknown): string {
  const id = str(obj(value)?.id);
  try {
    return /^feedback:\d+$/.test(atob(id)) ? id : '';
  } catch {
    return '';
  }
}

/**
 * How many comments the post has, as its comments thread says on the page (`total_comment_count`,
 * or the list's `total_count`); 0 when the page gives none.
 */
function commentTotal(page: FacebookPage, feedbackId: string): number {
  let total = 0;
  for (const o of feedbackId ? page.byId.get(feedbackId) ?? [] : []) {
    const counts = [
      num(o.total_comment_count),
      num(obj(obj(o.comment_rendering_instance)?.comments)?.total_count),
      num(obj(obj(o.comment_rendering_instance_for_feed_location)?.comments)?.total_count),
    ];
    total = Math.max(total, ...counts);
  }
  return total;
}

/** Depth-first over everything under `node`, `visit` seeing each object once. */
function eachObject(node: unknown, visit: (json: Json) => void, skip: ReadonlySet<string> = new Set(), depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) eachObject(item, visit, skip, depth + 1);
    return;
  }
  const json = node as Json;
  visit(json);
  for (const [key, value] of Object.entries(json)) if (!skip.has(key)) eachObject(value, visit, skip, depth + 1);
}

/** The photos and videos an attachment list holds, in order, each once. */
function attachedMedia(attachments: unknown): Array<{ kind: 'Photo' | 'Video'; id: string }> {
  const out: Array<{ kind: 'Photo' | 'Video'; id: string }> = [];
  eachObject(attachments, (json) => {
    const kind = json.__typename;
    const id = str(json.id);
    if ((kind === 'Photo' || kind === 'Video') && id && !out.some((m) => m.id === id)) out.push({ kind, id });
  }, new Set(['creation_story']));
  return out;
}

/** What a post's own fields say, the first object naming each one winning. */
interface PostFields {
  text: string;
  name: string;
  author: string;
  createdAt: number;
  feedbackId: string;
  postId: string;
  link: string;
}

function actorOf(o: Json): Json | undefined {
  const story = obj(o.creation_story);
  return obj(arr(o.actors)[0]) ?? obj(o.owner) ?? obj(arr(story?.actors)[0]) ?? obj(o.video_owner)
    ?? obj(obj(story?.short_form_video_context)?.video_owner) ?? obj(obj(o.short_form_video_context)?.video_owner)
    ?? obj(obj(o.feedback)?.owning_profile);
}

/** A person or page, with the name and link another object on the page gives when this one names only the id. */
function personOf(page: FacebookPage, actor: Json | undefined): { name: string; url: string } {
  const all = [actor, ...(page.byId.get(str(actor?.id)) ?? [])].filter((o): o is Json => o !== undefined);
  return { name: all.map((o) => str(o.name)).find(Boolean) ?? '', url: all.map((o) => str(o.url)).find(Boolean) ?? '' };
}

function messageOf(o: Json): string {
  const story = obj(o.creation_story);
  const content = obj(obj(obj(o.comet_sections)?.content)?.story);
  return textOf(o.message) || textOf(content?.message) || textOf(story?.message)
    || textOf(obj(obj(obj(story?.comet_sections)?.message)?.story)?.message);
}

function readFields(page: FacebookPage, objects: readonly Json[]): PostFields {
  const fields: PostFields = { text: '', name: '', author: '', createdAt: 0, feedbackId: '', postId: '', link: '' };
  for (const o of objects) {
    const story = obj(o.creation_story);
    const actor = personOf(page, actorOf(o));
    fields.text ||= messageOf(o);
    fields.name ||= actor.name;
    fields.author ||= facebookHandleOf(actor.url);
    fields.createdAt ||= (num(o.creation_time) || num(story?.creation_time) || num(o.publish_time)) * 1_000;
    fields.feedbackId ||= postFeedbackId(o.feedback) || postFeedbackId(story?.feedback);
    fields.postId ||= str(o.post_id) || str(story?.post_id);
    fields.link ||= parseFacebookUrl(str(o.permalink_url) || str(story?.url))?.url ?? '';
  }
  return fields;
}

/** Whether a post-like object is this video's: its id, its `video`, or an attachment. */
function refersTo(o: Json, videoId: string): boolean {
  if (o.id === videoId || obj(o.video)?.id === videoId) return true;
  return attachedMedia(o.attachments).some((m) => m.id === videoId);
}

export interface FacebookRead {
  thread: XThread;
  /** The post's comments thread for the comments query; "" when the page named none. */
  feedbackId: string;
}

/** The audience icon Facebook draws for "Public" (a globe), by its name. */
const PUBLIC_ICON = 'everyone';

/**
 * Who Facebook shows a post to: the audience icon its header draws, `privacy_scope.icon_image.name`
 * on the story or on another object with the story's id — a video's story is its `creation_story`.
 * `everyone` is public; any other name (friends, a list, a group, only me) is restricted; an icon
 * given only as a picture (a reel page's) marks nothing.
 */
function storyAudience(page: FacebookPage, objects: readonly Json[]): PostAudience {
  const names = new Set<string>();
  const stories = objects.flatMap((o) => [o, obj(o.creation_story)]).filter((o): o is Json => o !== undefined);
  for (const o of stories) {
    for (const copy of [o, ...(page.byId.get(str(o.id)) ?? [])]) {
      const name = str(obj(obj(copy.privacy_scope)?.icon_image)?.name);
      if (name) names.add(name);
    }
  }
  if (names.size === 0) return 'unknown';
  return names.size === 1 && names.has(PUBLIC_ICON) ? 'public' : 'restricted';
}

function postOf(
  page: FacebookPage, fields: PostFields, ref: FacebookRef, media: XMedia[], quoteMedia: XMedia[], audience: PostAudience,
): XPost {
  return {
    id: fields.postId || ref.id,
    author: fields.author,
    name: fields.name,
    createdAt: fields.createdAt,
    text: fields.text,
    link: fields.link || ref.url,
    image: media[0]?.image ?? '',
    replyCount: commentTotal(page, fields.feedbackId),
    likeCount: 0,
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia,
    audience,
  };
}

/**
 * A reel or video page, read by the video's id; null when the page names neither that video's post
 * nor a version of it. A video with no H.264 version still gives its text and comments.
 */
export function readVideoPage(page: FacebookPage, ref: FacebookRef): FacebookRead | null {
  const video = videoMedia(page, ref.id);
  const posts = page.posts.filter((o) => refersTo(o, ref.id));
  const fields = readFields(page, posts);
  if (!video && !fields.text && !fields.feedbackId) return null;
  // The link it was read from: a reel stays a reel, rather than the page's `/videos/` permalink.
  const focal = postOf(page, { ...fields, link: '' }, ref, video ? [video] : [], [], storyAudience(page, posts));
  return { thread: { focal, replies: [] }, feedbackId: fields.feedbackId };
}

/** The single-post route's own post; with a numbered id, the post of that id. */
function focalStory(page: FacebookPage, ref: FacebookRef): Json | undefined {
  for (const { name, data } of page.queries) {
    const node = obj(data.node_v2);
    if (name.startsWith('adp_CometSinglePost') && node?.__typename === 'Story') return node;
  }
  if (!/^\d+$/.test(ref.id)) return undefined;
  return page.posts.find((o) => o.__typename === 'Story' && str(o.post_id) === ref.id && 'comet_sections' in o);
}

function mediaOf(page: FacebookPage, attachments: unknown, photos: ReadonlyMap<string, Json[]>): XMedia[] {
  return attachedMedia(attachments)
    .map((m) => (m.kind === 'Video' ? videoMedia(page, m.id) : photoMedia(page, m.id, photos.get(m.id))))
    .filter((m): m is XMedia => m !== null);
}

/** The photo ids a post's own attachments hold, for reading each photo's page at full size. */
export function postPhotoIds(page: FacebookPage, ref: FacebookRef): string[] {
  const story = focalStory(page, ref);
  return story ? attachedMedia(story.attachments).filter((m) => m.kind === 'Photo').map((m) => m.id) : [];
}

/**
 * A story and every other object the page gives its id: Facebook spreads one post's fields over
 * several of them (the text is often only in the message section's copy).
 */
function storyObjects(page: FacebookPage, story: Json): Json[] {
  const content = obj(obj(obj(story.comet_sections)?.content)?.story);
  return [story, ...(content ? [content] : []), ...(page.byId.get(str(story.id)) ?? [])];
}

/**
 * The post a post shares, whichever of its copies carries the attachments. Signed in, a shared
 * reel comes as an attachment's `fb_shorts_story` instead.
 */
function sharedStory(objects: readonly Json[]): Json | undefined {
  const shared = objects.map((o) => obj(o.attached_story)).filter((o): o is Json => o !== undefined);
  const attached = shared.find((o) => arr(o.attachments).length > 0) ?? shared[0];
  if (attached) return attached;
  let shorts: Json | undefined;
  for (const o of objects) eachObject(o.attachments, (json) => { shorts ??= obj(json.fb_shorts_story); });
  return shorts;
}

/** The pages a post links to (its link preview), which go after its text as Threads' do. */
function linkPreviews(attachments: unknown): string[] {
  const out: string[] = [];
  eachObject(attachments, (json) => {
    const url = str(json.url);
    if (json.__typename === 'ExternalWebLink' && /^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
  });
  return out;
}

function sameMedia(a: XMedia, b: XMedia): boolean {
  return a.image === b.image && a.variants[0]?.url === b.variants[0]?.url;
}

/** A shared post's text under the sharer's, quoted as an X quote is: `> name: text`. */
function quoteBlock(fields: PostFields): string {
  if (!fields.text) return '';
  const who = fields.author ? `@${fields.author}` : fields.name;
  return `${who ? `${who}: ` : ''}${fields.text}`.split('\n').map((line) => `> ${line}`).join('\n');
}

function attachmentsOf(objects: readonly Json[]): unknown {
  return objects.find((o) => arr(o.attachments).length > 0)?.attachments;
}

/**
 * A post page: its text, photos and videos, and a shared post's text (quoted) and media (as
 * `quoteMedia`); null when the page held no post. `photos` holds what each photo's own page added
 * (signed in, full size).
 */
export function readPostPage(page: FacebookPage, ref: FacebookRef, photos: ReadonlyMap<string, Json[]> = new Map()): FacebookRead | null {
  const story = focalStory(page, ref);
  if (!story) return null;
  const objects = storyObjects(page, story);
  const fields = readFields(page, objects);
  const attachments = attachmentsOf(objects);
  const media = mediaOf(page, attachments, photos);
  const shared = sharedStory(objects);
  const sharedObjects = shared ? storyObjects(page, shared) : [];
  const quote = quoteBlock(readFields(page, sharedObjects));
  const quoteMedia = mediaOf(page, attachmentsOf(sharedObjects), photos).filter((q) => !media.some((m) => sameMedia(m, q)));
  const links = linkPreviews(attachments).filter((url) => !fields.text.includes(url));
  const text = [[fields.text, ...links].filter(Boolean).join('\n'), quote].filter(Boolean).join('\n\n');
  // A shared post goes out with it (its text, its media): both must be public.
  const audience = combineAudience([storyAudience(page, objects), ...(shared ? [storyAudience(page, sharedObjects)] : [])]);
  return { thread: { focal: postOf(page, { ...fields, text }, ref, media, quoteMedia, audience), replies: [] }, feedbackId: fields.feedbackId };
}

import type { XGraphqlResult } from './xSsr';

export interface XPost {
  id: string;
  /** Screen name without the "@". */
  author: string;
  /** Display name. */
  name: string;
  /** Epoch ms; derived from the id when the payload carries no time. */
  createdAt: number;
  /** The visible text: reply mentions and the trailing media link cut, t.co links expanded, a quoted post appended. */
  text: string;
  link: string;
  /** First photo, video poster or link-card image; "" when the post has none. */
  image: string;
  replyCount: number;
  likeCount: number;
  /** Id of the post this one answers; "" when it is not a reply. */
  inReplyTo: string;
  /** A repost of someone else's post. */
  isRepost: boolean;
}

export interface TimelinePost {
  post: XPost;
  pinned: boolean;
}

export interface XThread {
  focal: XPost;
  replies: XPost[];
}

type Json = Record<string, unknown>;

const X_EPOCH_MS = 1_288_834_974_657;
const SNOWFLAKE_TIME_SHIFT = 4_194_304;

function obj(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** A post id is a snowflake: its high bits are the creation time. Float precision loses well under a millisecond. */
export function snowflakeTime(id: string): number {
  if (!/^\d{6,}$/.test(id)) return 0;
  return Math.floor(Number(id) / SNOWFLAKE_TIME_SHIFT) + X_EPOCH_MS;
}

export function postLink(author: string, id: string): string {
  return `https://x.com/${author || 'i'}/status/${id}`;
}

/** Decodes the HTML entities that legacy-schema text carries. */
function decodeLegacyEntities(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function expandLinks(text: string, entities: unknown): string {
  let out = text;
  for (const raw of arr(entities)) {
    const entity = obj(raw);
    const short = str(entity?.url);
    const expanded = str(entity?.expanded_url);
    if (short && expanded) out = out.split(short).join(expanded);
  }
  return out;
}

/** Twitter's display range counts code points, not UTF-16 units. */
function sliceCodePoints(text: string, range: unknown): string {
  const bounds = arr(range);
  if (bounds.length !== 2 || typeof bounds[0] !== 'number' || typeof bounds[1] !== 'number') return text;
  return Array.from(text).slice(bounds[0], bounds[1]).join('');
}

function ownText(tweet: Json): string {
  const note = obj(obj(obj(tweet.note_tweet)?.note_tweet_results)?.result);
  const noteText = str(note?.text);
  if (noteText) return expandLinks(noteText, obj(note?.entity_set)?.urls).trim();

  const details = obj(tweet.details);
  if (details && typeof details.full_text === 'string') {
    return expandLinks(sliceCodePoints(details.full_text, details.display_text_range), tweet.url_entities).trim();
  }
  const legacy = obj(tweet.legacy);
  const legacyText = str(legacy?.full_text);
  const sliced = sliceCodePoints(legacyText, legacy?.display_text_range);
  return decodeLegacyEntities(expandLinks(sliced, obj(legacy?.entities)?.urls)).trim();
}

function firstImage(tweet: Json): string {
  for (const raw of arr(tweet.media_entities2)) {
    const url = str(obj(raw)?.media_url_https);
    if (url) return url;
  }
  const legacy = obj(tweet.legacy);
  for (const raw of arr(obj(legacy?.extended_entities)?.media)) {
    const url = str(obj(raw)?.media_url_https);
    if (url) return url;
  }
  const bindings = arr(obj(obj(tweet.card)?.legacy)?.binding_values);
  for (const key of ['photo_image_full_size_large', 'thumbnail_image_large', 'summary_photo_image_large']) {
    const binding = bindings.map(obj).find((b) => b?.key === key);
    const url = str(obj(obj(binding?.value)?.image_value)?.url);
    if (url) return url;
  }
  return '';
}

function authorOf(tweet: Json): { author: string; name: string } {
  const user = obj(obj(obj(tweet.core)?.user_results)?.result);
  const core = obj(user?.core);
  const legacy = obj(user?.legacy);
  return {
    author: str(core?.screen_name) || str(legacy?.screen_name),
    name: str(core?.name) || str(legacy?.name),
  };
}

/** The Tweet object behind a `tweet_results.result`; a tombstone or an unavailable post is null. */
function unwrapTweet(result: unknown): Json | null {
  const node = obj(result);
  if (!node) return null;
  if (node.__typename === 'TweetWithVisibilityResults') {
    // The wrapped post may omit `__typename`.
    const inner = obj(node.tweet);
    return inner && (inner.__typename ?? 'Tweet') === 'Tweet' && typeof inner.rest_id === 'string' ? inner : null;
  }
  if (node.__typename !== 'Tweet' || typeof node.rest_id !== 'string') return null;
  return node;
}

function quoteBlock(tweet: Json): string {
  // The quoted post's key differs between the two schemas.
  const quoted = unwrapTweet(obj(tweet.quoted_tweet_results ?? tweet.quoted_status_result)?.result);
  if (!quoted) return '';
  const { author } = authorOf(quoted);
  const text = ownText(quoted);
  if (!text) return '';
  const lines = `${author ? `@${author}: ` : ''}${text}`.split('\n');
  return lines.map((line) => `> ${line}`).join('\n');
}

export function readTweet(result: unknown): XPost | null {
  const tweet = unwrapTweet(result);
  if (!tweet) return null;
  const id = tweet.rest_id as string;
  const { author, name } = authorOf(tweet);
  const details = obj(tweet.details);
  const legacy = obj(tweet.legacy);
  const counts = obj(tweet.counts);
  const legacyTime = Date.parse(str(legacy?.created_at));
  const createdAt = num(details?.created_at_ms)
    || (Number.isFinite(legacyTime) ? legacyTime : 0)
    || snowflakeTime(id);
  const quote = quoteBlock(tweet);
  const own = ownText(tweet);
  return {
    id,
    author,
    name,
    createdAt,
    text: [own, quote].filter(Boolean).join('\n\n'),
    link: postLink(author, id),
    image: firstImage(tweet),
    replyCount: num(counts?.reply_count ?? legacy?.reply_count),
    likeCount: num(counts?.favorite_count ?? legacy?.favorite_count),
    inReplyTo: str(obj(tweet.reply_to_results)?.rest_id) || str(legacy?.in_reply_to_status_id_str),
    isRepost: Boolean(obj(legacy?.retweeted_status_result) ?? obj(tweet.retweeted_tweet_results)),
  };
}

/** The first `instructions` array under `data`, at any depth. */
function findInstructions(node: unknown, depth = 0): unknown[] | null {
  if (depth > 12) return null;
  const o = obj(node);
  if (!o) return null;
  if (Array.isArray(o.instructions)) return o.instructions;
  for (const value of Object.values(o)) {
    const found = findInstructions(value, depth + 1);
    if (found) return found;
  }
  return null;
}

interface Entry {
  post: XPost;
  pinned: boolean;
  /** Inside a conversation module — on a post page, that is a reply. */
  inModule: boolean;
}

/** A node's kind under either schema's naming. */
function kindOf(node: Json | undefined): unknown {
  return node?.__typename ?? node?.type ?? node?.entryType;
}

function tweetIn(holder: Json | undefined): XPost | null {
  const content = obj(holder?.content) ?? obj(holder?.itemContent);
  return readTweet(obj(content?.tweet_results)?.result);
}

function entryPosts(entry: unknown, pinned: boolean): Entry[] {
  const content = obj(obj(entry)?.content);
  if (!content) return [];
  if (kindOf(content) === 'TimelineTimelineModule' || content.entryType === 'TimelineTimelineModule') {
    return arr(content.items).flatMap((raw) => {
      const post = tweetIn(obj(obj(raw)?.item));
      return post ? [{ post, pinned, inModule: true }] : [];
    });
  }
  const post = tweetIn(content);
  return post ? [{ post, pinned, inModule: false }] : [];
}

function timelineEntries(data: unknown): Entry[] {
  const out: Entry[] = [];
  for (const raw of findInstructions(data) ?? []) {
    const instruction = obj(raw);
    const kind = kindOf(instruction);
    if (kind === 'TimelinePinEntry') out.push(...entryPosts(instruction?.entry, true));
    if (kind === 'TimelineAddEntries') {
      for (const entry of arr(instruction?.entries)) out.push(...entryPosts(entry, false));
    }
  }
  return out;
}

function sameHandle(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

/**
 * The profile timeline for `handle`, or null when the page carries none. A result that names no
 * `screenName` is matched by its posts' author.
 */
export function readProfilePosts(results: XGraphqlResult[], handle: string): TimelinePost[] | null {
  for (const result of results) {
    if ('focalTweetId' in result.variables) continue;
    const named = typeof result.variables.screenName === 'string';
    if (named && !sameHandle(result.variables.screenName, handle)) continue;
    if (!findInstructions(result.data)) continue;
    const entries = timelineEntries(result.data);
    if (!named && !entries.some((entry) => sameHandle(entry.post.author, handle))) continue;
    return entries.map(({ post, pinned }) => ({ post, pinned }));
  }
  return null;
}

export interface XTrend {
  /** The trend as X shows it: a phrase, a #hashtag or a name. */
  name: string;
  /** Where it trends or what it is about ("Trending in Taiwan", "Politics · Trending"); "" when X gives none. */
  context: string;
  /** X's own count line ("12.3K posts"); "" when X gives none. */
  volume: string;
  /** The search page for it — what opening the trend on X shows, its "Top" tab. */
  link: string;
}

function searchLink(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=trend_click&vertical=trends`;
}

interface RankedTrend extends XTrend {
  rank: number;
}

function readTrend(node: Json): RankedTrend | null {
  const name = str(node.name).trim();
  if (!name) return null;
  const meta = obj(node.trend_metadata) ?? obj(node.trendMetadata);
  const context = str(meta?.domain_context) || str(meta?.domainContext) || str(node.domain_context);
  // Usually absent; read when present.
  const volume = str(meta?.meta_description) || str(meta?.metaDescription) || str(node.meta_description);
  const rank = num(node.rank);
  return { name, context: context.trim(), volume: volume.trim(), link: searchLink(name), rank };
}

/** Every trend item under `node`, in page order, at any depth. */
function collectTrends(node: unknown, out: RankedTrend[], depth = 0): void {
  if (depth > 40) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTrends(item, out, depth + 1);
    return;
  }
  const o = obj(node);
  if (!o) return;
  if (kindOf(o) === 'TimelineTrend' || o.itemType === 'TimelineTrend') {
    const trend = readTrend(o);
    if (trend) out.push(trend);
    return;
  }
  for (const value of Object.values(o)) collectTrends(value, out, depth + 1);
}

/** The ranked Trending tab timeline, as opposed to the unranked "For you" selection. */
function isTrendingTimeline(result: XGraphqlResult): boolean {
  return typeof result.variables.timelineId === 'string';
}

/** The trending timeline has arrived — the moment a trends read can stop waiting. */
export function hasTrendingTimeline(results: XGraphqlResult[]): boolean {
  return results.some((result) => isTrendingTimeline(result) && (readTrends([result])?.length ?? 0) > 0);
}

/**
 * What the Trending tab lists, ranked, each once; the "For you" selection only when the Trending
 * tab never arrived. Null when the page carries no trend at all.
 */
export function readTrends(results: XGraphqlResult[]): XTrend[] | null {
  const timeline = results.filter(isTrendingTimeline);
  const source = timeline.length > 0 ? timeline : results;
  const found: RankedTrend[] = [];
  for (const result of source) collectTrends(result.data, found);
  if (found.length === 0) return null;
  const ranked = found.every((trend) => trend.rank > 0)
    ? [...found].sort((a, b) => a.rank - b.rank)
    : found;
  const seen = new Set<string>();
  return ranked
    .filter((trend) => {
      const key = trend.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ name, context, volume, link }) => ({ name, context, volume, link }));
}

/**
 * The posts a search page received, in X's order — newest first on "Latest", its own ranking on
 * "Top"; null when the page carries no search result (signed out it never does — the search page
 * redirects to sign-in).
 */
export function readSearchPosts(results: XGraphqlResult[]): XPost[] | null {
  let found = false;
  const seen = new Set<string>();
  const posts: XPost[] = [];
  for (const result of results) {
    if (typeof result.variables.rawQuery !== 'string' || !findInstructions(result.data)) continue;
    found = true;
    for (const { post } of timelineEntries(result.data)) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }
  return found ? posts : null;
}

/**
 * The post and the replies the page shows under it; ancestors of a reply are left out. A
 * signed-in page may receive the replies in several pages, all for the same post, so every
 * result for it is read.
 */
export function readThread(results: XGraphqlResult[], focalId: string): XThread | null {
  let focal: XPost | undefined;
  const seen = new Set<string>([focalId]);
  const replies: XPost[] = [];
  for (const result of results) {
    if (result.variables.focalTweetId !== focalId) continue;
    const entries = timelineEntries(result.data);
    focal ??= entries.find((e) => e.post.id === focalId)?.post;
    for (const { post, inModule } of entries) {
      if (!inModule || seen.has(post.id)) continue;
      seen.add(post.id);
      replies.push(post);
    }
  }
  return focal ? { focal, replies } : null;
}

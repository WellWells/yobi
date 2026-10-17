import { facebookHandleOf, isFacebookHost } from '../../../shared/facebookLinks';
import { arr, num, obj, str, type Json } from './jsonPick';
import type { XPost } from './xPosts';

/**
 * A post's comments, read through the site's own comments query, about ten a page, signed out too.
 * The query id is read from the bundles the page preloads, never hard-coded; the JSON is parsed,
 * never run.
 */

export const COMMENTS_QUERY = 'CommentsListComponentsPaginationQuery';
const QUERY_MODULE_RE = new RegExp(`__d\\("${COMMENTS_QUERY}_facebookRelayOperation",\\[\\],\\(function\\([^)]*\\)\\{[a-z]\\.exports="(\\d{6,25})"`);

/**
 * Every comment, not "most relevant", which stops early. Some posts answer it with none at all where
 * the default order lists them: those are asked again without it.
 */
export const ALL_COMMENTS = 'RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1';

export interface PageTokens {
  lsd: string;
  /** Signed in only. */
  dtsg: string;
}

export function readPageTokens(html: string): PageTokens {
  return {
    lsd: /"LSD",\[\],\{"token":"([^"]+)"/.exec(html)?.[1] ?? '',
    dtsg: /"DTSGInitialData",\[\],\{"token":"([^"]+)"/.exec(html)?.[1] ?? '',
  };
}

/** The script bundles a page loads from Facebook's static CDN, preloads first. */
export function readBundleUrls(html: string): string[] {
  const flat = html.replace(/&amp;/g, '&');
  const urls = [
    ...[...flat.matchAll(/<link[^>]+href="(https:\/\/static\.[a-z0-9.-]+\.fbcdn\.net\/rsrc\.php\/[^"]+)"[^>]*>/g)].map((m) => m[1]),
    ...[...flat.matchAll(/<script[^>]+src="(https:\/\/static\.[a-z0-9.-]+\.fbcdn\.net\/rsrc\.php\/[^"]+)"/g)].map((m) => m[1]),
  ];
  return [...new Set(urls)];
}

/** The comments query's id, if this bundle defines it. */
export function readCommentsQueryId(js: string): string {
  return QUERY_MODULE_RE.exec(js)?.[1] ?? '';
}

export interface CommentsRequest {
  queryId: string;
  feedbackId: string;
  cursor: string;
  tokens: PageTokens;
  /** The signed-in account's id (`c_user`); "0" signed out. */
  user: string;
  /** The order asked for: `ALL_COMMENTS`, or "" for the site's default ("most relevant"). */
  order: string;
}

/** The form body the site's own page sends for one page of comments. */
export function commentsRequestBody(request: CommentsRequest): string {
  const variables = {
    commentsAfterCount: -1,
    commentsAfterCursor: request.cursor || null,
    commentsBeforeCount: null,
    commentsBeforeCursor: null,
    commentsIntentToken: request.order || null,
    feedLocation: 'TAHOE',
    focusCommentID: null,
    scale: 1,
    targetDialect: null,
    useDefaultActor: false,
    id: request.feedbackId,
    __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
    __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
    __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
    __relay_internal__pv__IsWorkUserrelayprovider: false,
  };
  return new URLSearchParams({
    av: request.user,
    __user: request.user,
    __a: '1',
    ...(request.tokens.dtsg ? { fb_dtsg: request.tokens.dtsg } : {}),
    lsd: request.tokens.lsd,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: COMMENTS_QUERY,
    server_timestamps: 'true',
    variables: JSON.stringify(variables),
    doc_id: request.queryId,
  }).toString();
}

export interface CommentPage {
  comments: XPost[];
  /** "" when there is no next page. */
  cursor: string;
}

/** A count the site writes for people ("12", "1,024", "1.2K"); 0 when it is none of those. */
function countOf(value: unknown): number {
  const text = str(value).replace(/,/g, '');
  const match = /^(\d+(?:\.\d+)?)([KkMm])?$/.exec(text);
  if (!match) return num(value);
  const scale = match[2] ? (match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1;
  return Math.round(Number(match[1]) * scale);
}

/** A comment's own link; the post's when the site gave none on Facebook. */
function commentLink(node: Json, postLink: string): string {
  const url = str(obj(node.feedback)?.url);
  try {
    return isFacebookHost(new URL(url).hostname) ? url : postLink;
  } catch {
    return postLink;
  }
}

function readComment(value: unknown, postLink: string): XPost | null {
  const node = obj(value);
  const author = obj(node?.author);
  const text = str(obj(node?.body)?.text);
  const id = str(node?.legacy_fbid) || str(node?.id);
  // A sticker or photo comment has no text to read.
  if (!node || !id || !text) return null;
  const feedback = obj(node.feedback);
  return {
    id,
    author: facebookHandleOf(str(author?.url)),
    name: str(author?.name),
    createdAt: num(node.created_time) * 1_000,
    text,
    link: commentLink(node, postLink),
    image: '',
    replyCount: num(obj(feedback?.replies_fields)?.total_count),
    likeCount: countOf(obj(feedback?.reactors)?.count_reduced),
    inReplyTo: '',
    isRepost: false,
    media: [],
    quoteMedia: [],
  };
}

/**
 * Whether the answer is the API refusing the query itself — what an id Facebook has since replaced
 * gets — rather than a post with comments turned off, a sign-in wall or a rate limit, after which
 * the id is still good.
 */
export function isQueryError(text: string): boolean {
  try {
    const body = obj(JSON.parse(text.split('\n')[0]));
    return arr(body?.errors).length > 0 && !obj(obj(body?.data)?.node);
  } catch {
    return false;
  }
}

/**
 * One page of the query's answer; null when it is not the comments (an error, a sign-in wall).
 * The answer may carry more JSON lines after the first (deferred parts).
 */
export function readCommentPage(text: string, postLink: string): CommentPage | null {
  for (const line of text.split('\n')) {
    let body: unknown;
    try {
      body = JSON.parse(line);
    } catch {
      continue;
    }
    const comments = obj(obj(obj(obj(obj(body)?.data)?.node)?.comment_rendering_instance_for_feed_location)?.comments);
    if (!comments) continue;
    const pageInfo = obj(comments.page_info);
    return {
      comments: arr(comments.edges).map((edge) => readComment(obj(edge)?.node, postLink)).filter((c): c is XPost => c !== null),
      cursor: pageInfo?.has_next_page === true ? str(pageInfo.end_cursor) : '',
    };
  }
  return null;
}

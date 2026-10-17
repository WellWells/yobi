/**
 * In-process MCP server exposing Facebook reading as a tool for `/agent`.
 *
 * Takes an injected reader; the real one, which reads facebook.com with the user's sign-in, is
 * wired in facebookConnection.ts.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { parseFacebookUrl } from '../../shared/facebookLinks';
import { localIso } from '../x/xMcpServer';
import { createToolServer } from '../mcp/inProcessServer';
import type { XMedia, XPost, XThread } from '../flow/skills/xPosts';

export const FACEBOOK_SERVER_NAME = 'Facebook';

export interface FacebookServiceLike {
  /** The post at a rebuilt facebook.com URL; throws what the person can act on. */
  read: (url: string) => Promise<XThread>;
}

const COMMENTS_MAX = 40;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const FACEBOOK_TOOLS: Tool[] = [
  {
    name: 'facebook_post',
    description:
      'Read one Facebook post, reel or video: author, time, text (a shared post\'s text quoted under it), the photo and video URLs, and up to 40 comments — a sample, so comments_read is usually below comment_count on a busy post. Share links (facebook.com/share/…, fb.watch) work too. Posts only friends or a group\'s members may see need the user signed in to Facebook in Yobi.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post, reel or video URL (https://www.facebook.com/reel/<id>/, /<page>/posts/<id>, /watch/?v=<id>, or a share link)' },
        max_comments: { type: 'number', description: `Max comments (default 20, at most ${COMMENTS_MAX})` },
      },
      required: ['url'],
    },
    annotations: { title: 'Read a Facebook post', ...READ_ONLY },
  },
];

function mediaView(media: XMedia): Record<string, unknown> {
  const video = media.variants[0];
  return { kind: media.kind, url: video?.url ?? media.image, ...(video ? { poster: media.image } : {}) };
}

function who(post: XPost): string {
  return post.author ? `@${post.author}` : post.name;
}

function postView(post: XPost): Record<string, unknown> {
  return { author: who(post), name: post.name, time: localIso(post.createdAt), text: post.text, link: post.link };
}

function commentView(comment: XPost): Record<string, unknown> {
  return { author: comment.name || who(comment), time: localIso(comment.createdAt), text: comment.text, likes: comment.likeCount };
}

function limitOf(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

async function dispatch(service: FacebookServiceLike, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name !== 'facebook_post') throw new Error(`Unknown tool: ${name}`);
  const raw = typeof args.url === 'string' ? args.url.trim() : '';
  const ref = parseFacebookUrl(raw);
  if (!ref) {
    throw new Error(`Not a Facebook post URL: '${raw}'. Expected https://www.facebook.com/reel/<id>/, /<page>/posts/<id>, /watch/?v=<id> or a share link.`);
  }
  const thread = await service.read(ref.url);
  const media = thread.focal.media.length > 0 ? thread.focal.media : thread.focal.quoteMedia;
  const comments = thread.replies.slice(0, limitOf(args.max_comments, 20, COMMENTS_MAX));
  return {
    post: postView(thread.focal),
    media: media.map(mediaView),
    comment_count: thread.focal.replyCount,
    comments_read: comments.length,
    comments: comments.map(commentView),
  };
}

export function createFacebookMcpServer(service: FacebookServiceLike): Server {
  return createToolServer({
    name: FACEBOOK_SERVER_NAME,
    tools: FACEBOOK_TOOLS,
    dispatch: (name, args) => dispatch(service, name, args),
  });
}

/**
 * In-process MCP server exposing Threads reading as a tool for `/agent`.
 *
 * Takes an injected reader; the real one, which reads threads.com with the user's sign-in, is
 * wired in threadsConnection.ts.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { parseThreadsPostUrl } from '../../shared/threadsLinks';
import { localIso } from '../x/xMcpServer';
import { createToolServer, type ToolServer } from '../mcp/inProcessServer';
import type { XMedia, XPost, XThread } from '../flow/skills/xPosts';

export const THREADS_SERVER_NAME = 'Threads';

export interface ThreadsServiceLike {
  /** The post at a rebuilt threads.com URL; throws what the person can act on. */
  read: (url: string) => Promise<XThread>;
}

const REPLIES_MAX = 40;
const REPLIES_DEFAULT = 20;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const THREADS_TOOLS: Tool[] = [
  {
    name: 'threads_post',
    description:
      'Read one Threads post: author, time, text (a quoted post\'s text quoted under it), the photo and video URLs, and the first direct replies its page shows (about 10) — a sample, so replies_read is usually below reply_count. Short links (/t/…), share links (threads.com/share/…) and threads.net work too. Posts not open to everyone need the user signed in to Threads in Yobi.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post URL (https://www.threads.com/@<account>/post/<code>, /t/<code>, or a share link)' },
        max_replies: { type: 'number', description: `Max replies (default ${REPLIES_DEFAULT}, at most ${REPLIES_MAX})` },
      },
      required: ['url'],
    },
    annotations: { title: 'Read a Threads post', ...READ_ONLY },
  },
];

function mediaView(media: XMedia): Record<string, unknown> {
  const video = media.variants[0];
  return { kind: media.kind, url: video?.url ?? media.image, ...(video ? { poster: media.image } : {}) };
}

function postView(post: XPost): Record<string, unknown> {
  return { author: `@${post.author}`, name: post.name, time: localIso(post.createdAt), text: post.text, link: post.link };
}

function replyView(reply: XPost): Record<string, unknown> {
  return { author: `@${reply.author}`, time: localIso(reply.createdAt), text: reply.text, likes: reply.likeCount };
}

function limitOf(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

async function dispatch(service: ThreadsServiceLike, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name !== 'threads_post') throw new Error(`Unknown tool: ${name}`);
  const raw = typeof args.url === 'string' ? args.url.trim() : '';
  const ref = raw ? parseThreadsPostUrl(raw) : null;
  if (!ref) {
    throw new Error(`Not a Threads post URL: '${raw}'. Expected https://www.threads.com/@<account>/post/<code>, /t/<code> or a share link.`);
  }
  const thread = await service.read(ref.url);
  const media = thread.focal.media.length > 0 ? thread.focal.media : thread.focal.quoteMedia;
  const replies = thread.replies.slice(0, limitOf(args.max_replies, REPLIES_DEFAULT, REPLIES_MAX));
  return {
    post: postView(thread.focal),
    media: media.map(mediaView),
    reply_count: Math.max(thread.focal.replyCount, thread.replies.length),
    replies_read: replies.length,
    replies: replies.map(replyView),
  };
}

export function createThreadsMcpServer(service: ThreadsServiceLike): ToolServer {
  return createToolServer({
    name: THREADS_SERVER_NAME,
    tools: THREADS_TOOLS,
    dispatch: (name, args) => dispatch(service, name, args),
  });
}

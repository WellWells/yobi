/**
 * In-process MCP server exposing X (Twitter) reading as tools for `/agent`.
 *
 * Takes an injected service so the tool surface is tested offline with a fake; the real one,
 * which loads x.com pages, is wired in xConnection.ts.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { localIsoString } from '../../shared/localTime';
import { parseXHandle, parseXPostUrl } from '../../shared/xHandles';
import type { XPost, XThread, XTrend } from '../flow/skills/xPosts';
import { createToolServer } from '../mcp/inProcessServer';

export const X_SERVER_NAME = 'X';

export interface XServiceLike {
  search: (query: string) => Promise<XPost[]>;
  /** null when the page held no timeline: no such account, or X changed the page. */
  accountPosts: (handle: string, limit: number) => Promise<XPost[] | null>;
  /** null when the post could not be read. */
  thread: (ref: { author: string; id: string }) => Promise<XThread | null>;
  trends: () => Promise<XTrend[]>;
}

const SEARCH_MAX = 40;
const POSTS_MAX = 20;
const REPLIES_MAX = 40;
const TRENDS_MAX = 40;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const X_TOOLS: Tool[] = [
  {
    name: 'x_search',
    description:
      'Search X (Twitter) for the newest posts matching a query — what X shows under "Latest". Use it for what people on X are saying right now about a person, event or topic. The query takes X search operators: from:account, since:2026-10-01, until:…, lang:ja, min_faves:100, -filter:replies, "exact phrase". Returns only the first page (about 20), newest first — a sample of the conversation, never all of it. Needs the user signed in to X in Yobi; signed out it fails and says so.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search words and optional X operators' },
        limit: { type: 'number', description: `Max posts (default 20, at most ${SEARCH_MAX})` },
      },
      required: ['query'],
    },
    annotations: { title: 'Search X', ...READ_ONLY },
  },
  {
    name: 'x_user_posts',
    description:
      "Read one X account's newest posts (its own posts — reposts of others are left out). Signed out, X shows only the newest 4; signed in, about 20.",
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: '@handle or x.com profile URL' },
        limit: { type: 'number', description: `Max posts (default 10, at most ${POSTS_MAX})` },
      },
      required: ['account'],
    },
    annotations: { title: 'Read an X account', ...READ_ONLY },
  },
  {
    name: 'x_post_replies',
    description:
      'Read one X post and the replies under it, each with author, time, text and link. X lists only the replies it ranks first (about 40 signed in, about 3 signed out), so replies_read is usually below reply_count — never say a post has no other replies.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post URL (https://x.com/<account>/status/<id>)' },
        max_replies: { type: 'number', description: `Max replies (default 20, at most ${REPLIES_MAX})` },
      },
      required: ['url'],
    },
    annotations: { title: 'Read an X post and its replies', ...READ_ONLY },
  },
  {
    name: 'x_trends',
    description:
      "What is trending on X right now (Explore › Trending) for the region set in the user's X account: each trend's name, what or where it trends in, X's post count, and the search link for it. To see what people say about a trend, follow up with x_search on its name. Needs the user signed in to X in Yobi; signed out it fails and says so.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Max trends (default 20, at most ${TRENDS_MAX})` },
      },
    },
    annotations: { title: 'Read X trends', ...READ_ONLY },
  },
];

/** `2026-10-03T22:09:05+08:00` — the reader's own zone, with the offset said out loud. */
export function localIso(ms: number): string {
  return ms ? localIsoString(new Date(ms)) : '';
}

function postView(post: XPost): Record<string, unknown> {
  return {
    author: `@${post.author}`,
    name: post.name,
    time: localIso(post.createdAt),
    text: post.text,
    link: post.link,
    replies: post.replyCount,
    likes: post.likeCount,
    ...(post.image ? { image: post.image } : {}),
  };
}

function limitOf(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required argument: ${field}`);
  return value.trim();
}

async function dispatch(service: XServiceLike, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'x_search': {
      const query = requireString(args.query, 'query');
      const posts = (await service.search(query)).slice(0, limitOf(args.limit, 20, SEARCH_MAX));
      return { query, posts: posts.map(postView) };
    }
    case 'x_user_posts': {
      const raw = requireString(args.account, 'account');
      const handle = parseXHandle(raw);
      if (!handle) throw new Error(`Not an X account: '${raw}'. Pass an @handle or an x.com profile URL.`);
      const posts = await service.accountPosts(handle, limitOf(args.limit, 10, POSTS_MAX));
      // "No posts" and "no such account" must not look alike to the model.
      if (!posts) throw new Error(`Could not read @${handle}: the account does not exist, is protected, or X changed its page.`);
      return { account: `@${handle}`, posts: posts.map(postView) };
    }
    case 'x_post_replies': {
      const url = requireString(args.url, 'url');
      const ref = parseXPostUrl(url);
      if (!ref) throw new Error(`Not an X post URL: '${url}'. Expected https://x.com/<account>/status/<id>.`);
      const thread = await service.thread(ref);
      if (!thread) throw new Error(`Could not read the post at ${url}: it was deleted, is protected, or X changed its page.`);
      const replies = thread.replies.slice(0, limitOf(args.max_replies, 20, REPLIES_MAX));
      return {
        post: postView(thread.focal),
        reply_count: thread.focal.replyCount,
        replies_read: replies.length,
        replies: replies.map(postView),
      };
    }
    case 'x_trends': {
      const trends = (await service.trends()).slice(0, limitOf(args.limit, 20, TRENDS_MAX));
      return {
        trends: trends.map((trend, index) => ({
          rank: index + 1,
          name: trend.name,
          ...(trend.context ? { context: trend.context } : {}),
          ...(trend.volume ? { volume: trend.volume } : {}),
          link: trend.link,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createXMcpServer(service: XServiceLike): Server {
  // The X readers cannot be cancelled, so the call's abort signal is not passed on.
  return createToolServer({ name: X_SERVER_NAME, tools: X_TOOLS, dispatch: (name, args) => dispatch(service, name, args) });
}

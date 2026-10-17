/**
 * In-process MCP server exposing Instagram reading as tools for `/agent`.
 *
 * Takes an injected reader; the real one, which reads instagram.com with the user's sign-in, is
 * wired in instagramConnection.ts.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { instagramStoriesLink, instagramStoryLink, parseInstagramUrl } from '../../shared/instagramLinks';
import { localIso } from '../x/xMcpServer';
import { createToolServer } from '../mcp/inProcessServer';
import type { XMedia, XPost, XThread } from '../flow/skills/xPosts';

export const INSTAGRAM_SERVER_NAME = 'Instagram';

export interface InstagramServiceLike {
  /** The post or stories at a rebuilt instagram.com URL; throws what the person can act on. */
  read: (url: string) => Promise<XThread>;
}

const COMMENTS_MAX = 40;
const ACCOUNT_RE = /^@?([A-Za-z0-9._]{1,30})$/;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const INSTAGRAM_TOOLS: Tool[] = [
  {
    name: 'instagram_post',
    description:
      'Read one Instagram post or reel: author, time, caption, like and comment counts, the photo and video URLs, and the comments Instagram lists first (about 15 signed out, up to 40 signed in) — a sample, so comments_read is usually below comment_count. Posts from private accounts need the user signed in to Instagram in Yobi.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post URL (https://www.instagram.com/p/<code>/ or /reel/<code>/)' },
        max_comments: { type: 'number', description: `Max comments (default 20, at most ${COMMENTS_MAX})` },
      },
      required: ['url'],
    },
    annotations: { title: 'Read an Instagram post', ...READ_ONLY },
  },
  {
    name: 'instagram_stories',
    description:
      "Read an Instagram account's stories up now, one story, or a highlight: each item's kind (photo or video), its media URL and time. Stories disappear after 24 hours. Needs the user signed in to Instagram in Yobi; signed out it fails and says so.",
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: "@account, for that account's current stories" },
        url: { type: 'string', description: 'A story or highlight URL (https://www.instagram.com/stories/<account>/<id>/ or /stories/highlights/<id>/)' },
      },
    },
    annotations: { title: 'Read Instagram stories', ...READ_ONLY },
  },
];

function mediaView(media: XMedia): Record<string, unknown> {
  const video = media.variants[0];
  return {
    kind: media.kind,
    url: video?.url ?? media.image,
    ...(video ? { poster: media.image } : {}),
  };
}

function postView(post: XPost): Record<string, unknown> {
  return {
    author: `@${post.author}`,
    name: post.name,
    time: localIso(post.createdAt),
    text: post.text,
    link: post.link,
    likes: post.likeCount,
  };
}

function commentView(comment: XPost): Record<string, unknown> {
  return { author: `@${comment.author}`, time: localIso(comment.createdAt), text: comment.text, likes: comment.likeCount };
}

function limitOf(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function dispatch(service: InstagramServiceLike, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'instagram_post': {
      const raw = optionalString(args.url);
      const ref = parseInstagramUrl(raw);
      if (!ref || ref.kind !== 'post') {
        throw new Error(`Not an Instagram post URL: '${raw}'. Expected https://www.instagram.com/p/<code>/ or /reel/<code>/; use instagram_stories for a story.`);
      }
      const thread = await service.read(ref.url);
      const comments = thread.replies.slice(0, limitOf(args.max_comments, 20, COMMENTS_MAX));
      return {
        post: postView(thread.focal),
        media: thread.focal.media.map(mediaView),
        comment_count: thread.focal.replyCount,
        comments_read: comments.length,
        comments: comments.map(commentView),
      };
    }
    case 'instagram_stories': {
      const account = optionalString(args.account);
      const raw = optionalString(args.url);
      const handle = ACCOUNT_RE.exec(account)?.[1];
      const ref = raw ? parseInstagramUrl(raw) : handle ? parseInstagramUrl(`https://www.instagram.com/stories/${handle}/`) : null;
      if (!ref || ref.kind === 'post') {
        throw new Error('Pass account (an @account) or url (a story or highlight URL). For a post, use instagram_post.');
      }
      // A story's own link is that story: the chat's link reads the account's whole set for its menu.
      // A profile's link names whose stories.
      const url = ref.kind === 'story' ? instagramStoryLink(ref.author, ref.id, 'one')
        : ref.kind === 'profile' ? instagramStoriesLink(ref.author) : ref.url;
      const thread = await service.read(url);
      return {
        account: `@${thread.focal.author}`,
        ...(thread.focal.text ? { title: thread.focal.text } : {}),
        link: thread.focal.link,
        items: thread.focal.media.map(mediaView),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createInstagramMcpServer(service: InstagramServiceLike): Server {
  return createToolServer({
    name: INSTAGRAM_SERVER_NAME,
    tools: INSTAGRAM_TOOLS,
    dispatch: (name, args) => dispatch(service, name, args),
  });
}

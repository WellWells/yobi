/**
 * In-process MCP server exposing a bilibili video's details and subtitles as a tool for `/agent`.
 *
 * Takes an injected reader; the real one, which reads the video's page in the site's hidden window
 * with the user's sign-in, is wired in bilibiliConnection.ts. Never the danmaku (bullet comments).
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { bilibiliVideoRef } from '../../shared/linkSites/rows';
import { localIso } from '../x/xMcpServer';
import { createToolServer } from '../mcp/inProcessServer';

export const BILIBILI_SERVER_NAME = 'bilibili';

/** One video as the reader saw it. */
export interface BilibiliVideoRead {
  title: string;
  owner: string;
  /** Unix seconds; 0 when the page gave none. */
  pubdate: number;
  durationS: number;
  desc: string;
  /** The video's canonical page (with `?p=N` for a later part). */
  link: string;
  /** Whether bilibili saw a signed-in account; null when its subtitle list could not be read. */
  signedIn: boolean | null;
  /** The subtitle track read (a person's Chinese first), or null when the video has none. */
  subtitles: { language: string; ai: boolean; text: string } | null;
}

export interface BilibiliServiceLike {
  /**
   * The video behind a bilibili video link (`/video/<BV or av>`, `b23.tv`); throws what the person
   * can act on. `signal` aborts when the call is cancelled, ending the page read and freeing the
   * site's one-page slot.
   */
  read: (url: string, signal?: AbortSignal) => Promise<BilibiliVideoRead>;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const BILIBILI_TOOLS: Tool[] = [
  {
    name: 'bilibili_video',
    description:
      'Read one bilibili video: title, uploader, time, length, description and its subtitles as text (a person\'s Chinese subtitles first, then bilibili\'s machine ones). Takes www.bilibili.com/video/<BV or av id> (with ?p=N for a later part) or a b23.tv share link. bilibili gives subtitles only to a signed-in account: signed out, subtitles is null.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The video URL (https://www.bilibili.com/video/BV…/ or https://b23.tv/<code>)' },
      },
      required: ['url'],
    },
    annotations: { title: 'Read a bilibili video', ...READ_ONLY },
  },
];

/** Why `subtitles` is null, so the model says it instead of guessing what the video says. */
function subtitlesNote(video: BilibiliVideoRead): string | undefined {
  if (video.subtitles) return undefined;
  if (video.signedIn === false) return 'Not signed in to bilibili in Yobi, and bilibili gives subtitles only to a signed-in account.';
  if (video.signedIn === null) return 'bilibili did not answer with the subtitle list.';
  return 'This video has no subtitles.';
}

async function dispatch(
  service: BilibiliServiceLike,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (name !== 'bilibili_video') throw new Error(`Unknown tool: ${name}`);
  const raw = typeof args.url === 'string' ? args.url.trim() : '';
  const ref = bilibiliVideoRef(raw);
  if (!ref) {
    throw new Error(`Not a bilibili video URL: '${raw}'. Expected https://www.bilibili.com/video/<BV or av id>/ or a b23.tv share link; series episodes, courses and live rooms are not read.`);
  }
  const video = await service.read(ref.url, signal);
  const note = subtitlesNote(video);
  return {
    video: {
      title: video.title,
      uploader: video.owner,
      time: video.pubdate ? localIso(video.pubdate * 1_000) : '',
      duration_seconds: video.durationS,
      description: video.desc,
      link: video.link,
    },
    subtitles: video.subtitles
      ? { language: video.subtitles.language, machine_generated: video.subtitles.ai, text: video.subtitles.text }
      : null,
    ...(note ? { subtitles_note: note } : {}),
  };
}

export function createBilibiliMcpServer(service: BilibiliServiceLike): Server {
  return createToolServer({
    name: BILIBILI_SERVER_NAME,
    tools: BILIBILI_TOOLS,
    dispatch: (name, args, signal) => dispatch(service, name, args, signal),
  });
}

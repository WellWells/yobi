/**
 * In-process MCP server for reading a page's text by its link. Takes the reader as a parameter; the
 * real one is wired in pageReadConnection.ts.
 *
 * On by default, so it carries no connector notes (they sit in every turn): what the model must know
 * is in the description's first sentence, the part the catalog shows.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolError, createToolServer, type ToolServer } from '../mcp/inProcessServer';
import { ALSO_NAMED } from '../mcp/schemaAliases';
import { PageReadError, type PageRead } from './pageReader';

export const PAGE_SERVER_NAME = 'Universal Page Reader';

export interface PageReadMcpDeps {
  read: (url: string, signal?: AbortSignal) => Promise<PageRead>;
}

/** Sized like `ptt_read_post`: arrives whole as a BYOK observation and on a browser run. */
export const PAGE_TEXT_MAX_CHARS = 12_000;

const PREVIEW_NOTE = 'The page marks itself as for subscribers, so this may be its public opening only. If the text stops short, tell the user so.';
const WHOLE_PAGE_NOTE = 'Not an article: this is all the text on the page, menus included.';

export const PAGE_TOOLS: Tool[] = [
  {
    name: 'page_read',
    description: 'Text of a public web page by its link; use it, not browser, when you have the link. Reads articles, blogs, documentation, forum threads with their replies, posts on X, Threads, Instagram, Facebook, TikTok, PTT, Dcard, Reddit and Weibo, and news.google.com links. Reads signed out, so pages behind a sign-in or a paywall stay shut. Returns the title, site, author, date and text. With `next_start` in the result there is more: call again with `start` set to it. A Google News link is followed to the article itself, and `url` in the result is the real address to cite.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page link', [ALSO_NAMED]: ['link', 'article_url', 'href'] },
        start: { type: 'integer', description: 'Where to go on from: the `next_start` of the last result' },
      },
      required: ['url'],
    },
    annotations: { title: 'Read a web page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

function noteOn(page: PageRead): Record<string, string> {
  if (page.preview) return { note: PREVIEW_NOTE };
  return page.method === 'whole page' ? { note: WHOLE_PAGE_NOTE } : {};
}

export function createPageReadMcpServer(deps: PageReadMcpDeps): ToolServer {
  // Going on through a long page names the same link again, and reading it can take a hidden
  // window half a minute. Only public pages, read signed out, so any caller may share it.
  let last: { asked: string; page: PageRead } | null = null;
  const pageFor = async (url: string, start: number, signal?: AbortSignal): Promise<PageRead> => {
    if (start > 0 && last && (last.asked === url || last.page.url === url)) return last.page;
    const page = await deps.read(url, signal);
    last = { asked: url, page };
    return page;
  };

  return createToolServer({
    name: PAGE_SERVER_NAME,
    tools: PAGE_TOOLS,
    dispatch: async (toolName, args, signal) => {
      if (toolName !== 'page_read') throw new Error(`Unknown tool: ${toolName}`);
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) throw new ToolError('MissingUrl', 'Give the page link in `url`.');
      const start = Math.max(0, Math.floor(Number(args.start) || 0));
      try {
        const page = await pageFor(url, start, signal);
        const end = start + PAGE_TEXT_MAX_CHARS;
        const more = end < page.text.length;
        return {
          title: page.title,
          site: page.site,
          ...(page.author ? { author: page.author } : {}),
          ...(page.publishedAt ? { published: page.publishedAt } : {}),
          url: page.url,
          text: page.text.slice(start, end),
          ...(more ? { next_start: end, total_chars: page.text.length } : {}),
          ...(page.truncated && !more ? { truncated: true } : {}),
          ...noteOn(page),
        };
      } catch (err) {
        if (err instanceof PageReadError) throw new ToolError('PageUnreadable', err.message, { reason: err.reason });
        throw err;
      }
    },
  });
}

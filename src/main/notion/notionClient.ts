import type { NotionUpdate } from '../../shared/notion/notionDiff';
import {
  classifyNotionError,
  parseFetchResult,
  parsePageList,
  parseSearchResult,
  type NotionCallError,
  type NotionPage,
  type NotionPageList,
  type NotionSearchHit,
} from '../../shared/notion/notionFetch';
import { getMcpRegistry, McpNotConnectedError } from '../mcp/mcpRegistry';

/*
 * The few Notion MCP calls a document sync makes, sent straight to the user's connected Notion
 * server: no model and no agent loop decide anything here. Writes go out only from `pushNotionDoc`,
 * after the user confirmed the preview. Never `replace_content`, never `allow_deleting_content`.
 */

export type NotionWrite = { ok: true; queued: boolean } | { ok: false; error: NotionCallError };

export interface NotionApi {
  server: string;
  fetch(page: string): Promise<NotionPage | { error: NotionCallError | 'notPage' }>;
  update(page: string, update: NotionUpdate): Promise<NotionWrite>;
  insert(page: string, content: string): Promise<NotionWrite>;
  setTitle(page: string, title: string): Promise<NotionWrite>;
  search(query: string): Promise<NotionSearchHit[] | { error: NotionCallError }>;
  /** A stretch of the user's sidebar list; null when the server has no such list. */
  list(kind: NotionListKind, limit: number, cursor?: string): Promise<NotionPageList | null | { error: NotionCallError }>;
}

export type NotionListKind = 'favorites' | 'recent';

/** The tools that make a connected server a Notion server, whatever the user named it. */
const FETCH_TOOL = 'notion-fetch';
const UPDATE_TOOL = 'notion-update-page';
const SEARCH_TOOL = 'notion-search';
/** Lists the page picker shows before anything is typed; older servers may not have them. */
const LIST_TOOLS: Record<NotionListKind, string> = {
  favorites: 'notion-list-favorite-pages',
  recent: 'notion-list-recent-pages',
};

function errorOf(err: unknown): NotionCallError {
  if (err instanceof McpNotConnectedError) return 'notConnected';
  return classifyNotionError(err instanceof Error ? err.message : String(err));
}

/**
 * The connected Notion server to use. With no `server` (importing): the first there is. For a
 * document: its own server and no other — a page's text must never go to another workspace, or to
 * any server that merely names its tools like Notion's. The one exception is a document whose
 * server was removed from Yobi (re-added under a new id): then the single connected Notion server,
 * if there is exactly one.
 */
export function findNotionServer(server?: string): string | null {
  const registry = getMcpRegistry();
  if (!registry) return null;
  const connected = registry.getConnectedTools().filter(({ tools }) => {
    const names = new Set(tools.map((tool) => tool.name));
    return names.has(FETCH_TOOL) && names.has(UPDATE_TOOL);
  });
  if (server === undefined) return connected[0]?.serverId ?? null;
  if (connected.some((entry) => entry.serverId === server)) return server;
  const stillConfigured = registry.listServers().some((entry) => entry.id === server);
  return !stillConfigured && connected.length === 1 ? connected[0]?.serverId ?? null : null;
}

/** An API bound to a connected Notion server, or null when none is connected. */
export function notionApiFor(preferred?: string): NotionApi | null {
  const server = findNotionServer(preferred);
  const registry = getMcpRegistry();
  if (!server || !registry) return null;

  const call = async (tool: string, args: Record<string, unknown>, replayable: boolean): Promise<{ text: string } | { error: NotionCallError }> => {
    try {
      const result = await registry.callTool(server, tool, args, undefined, replayable);
      return result.isError ? { error: classifyNotionError(result.text) } : { text: result.text };
    } catch (err: unknown) {
      return { error: errorOf(err) };
    }
  };
  const write = async (args: Record<string, unknown>): Promise<NotionWrite> => {
    const result = await call(UPDATE_TOOL, { ...args, allow_async: false }, false);
    if ('error' in result) return { ok: false, error: result.error };
    // Past the server's synchronous deadline the edit is queued, not yet on the page.
    return { ok: true, queued: /"async_task"|"task_id"/.test(result.text) };
  };

  return {
    server,
    async fetch(page) {
      const result = await call(FETCH_TOOL, { id: page }, true);
      if ('error' in result) return result;
      const parsed = parseFetchResult(result.text);
      if ('error' in parsed) return { error: parsed.error === 'notPage' ? 'notPage' : 'failed' };
      return parsed;
    },
    update: (page, update) => write({
      page_id: page,
      command: 'update_content',
      content_updates: [{ old_str: update.old_str, new_str: update.new_str }],
    }),
    insert: (page, content) => write({ page_id: page, command: 'insert_content', content }),
    setTitle: (page, title) => write({ page_id: page, command: 'update_properties', properties: { title } }),
    async search(query) {
      const result = await call(SEARCH_TOOL, { query, page_size: 20, max_highlight_length: 0 }, true);
      if ('error' in result) return result;
      return parseSearchResult(result.text);
    },
    async list(kind, limit, cursor) {
      const tool = LIST_TOOLS[kind];
      const offered = registry.getConnectedTools().find((entry) => entry.serverId === server)?.tools.some((entry) => entry.name === tool);
      if (!offered) return null;
      const result = await call(tool, { limit, ...(cursor ? { cursor } : {}) }, true);
      if ('error' in result) return result;
      return parsePageList(result.text);
    },
  };
}

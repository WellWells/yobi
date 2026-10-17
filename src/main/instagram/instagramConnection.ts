/**
 * Builds the live, in-process Instagram MCP connection: the instagram.com reader behind an
 * McpServer, linked to an SDK Client over InMemoryTransport (no network, no port). Loaded lazily by
 * the registry.
 */
import { readInstagramLink } from '../flow/skills/instagramYtdlp';
import type { XThread } from '../flow/skills/xPosts';
import { createInstagramMcpServer, type InstagramServiceLike } from './instagramMcpServer';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';

async function read(url: string): Promise<XThread> {
  const page = await readInstagramLink(url);
  if (page.value) return page.value;
  throw new Error(page.status === 404
    ? `Instagram post not found (HTTP 404): ${url}`
    : `Instagram showed no post at ${url} (HTTP ${page.status}): deleted, private, or the page changed.`);
}

const service: InstagramServiceLike = { read };

export async function connectInstagramMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createInstagramMcpServer(service), clientName, clientVersion);
}

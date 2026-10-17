/**
 * Builds the live, in-process Facebook MCP connection: the facebook.com reader behind an
 * McpServer, linked to an SDK Client over InMemoryTransport (no network, no port). Loaded lazily by
 * the registry.
 */
import { readFacebookThread } from '../flow/skills/facebookReader';
import type { XThread } from '../flow/skills/xPosts';
import { createFacebookMcpServer, type FacebookServiceLike } from './facebookMcpServer';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';

async function read(url: string): Promise<XThread> {
  const page = await readFacebookThread(url);
  if (page.value) return page.value;
  throw new Error(page.status === 404
    ? `Facebook post not found (HTTP 404): ${url}`
    : `Facebook showed no post at ${url} (HTTP ${page.status}): deleted, not shared with this account, or the page changed.`);
}

const service: FacebookServiceLike = { read };

export async function connectFacebookMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createFacebookMcpServer(service), clientName, clientVersion);
}

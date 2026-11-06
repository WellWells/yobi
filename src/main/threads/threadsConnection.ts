/**
 * Builds the live, in-process Threads MCP connection: the threads.com reader behind an McpServer,
 * linked to an SDK Client over InMemoryTransport (no network, no port). Loaded lazily by the
 * registry. The agent's tool is the owner's, so it reads with the sign-in whenever there is one.
 */
import { readThreadsPostThread } from '../flow/skills/threadsReader';
import type { XThread } from '../flow/skills/xPosts';
import { createThreadsMcpServer, type ThreadsServiceLike } from './threadsMcpServer';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';

async function read(url: string): Promise<XThread> {
  const page = await readThreadsPostThread(url);
  if (page.value) return page.value;
  throw new Error(page.status === 404
    ? `Threads post not found (HTTP 404): ${url}`
    : `Threads showed no post at ${url} (HTTP ${page.status}): deleted, not shown to this account, or the page changed.`);
}

const service: ThreadsServiceLike = { read };

export async function connectThreadsMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createThreadsMcpServer(service), clientName, clientVersion);
}

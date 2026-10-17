/**
 * Builds the live, in-process X MCP connection: the x.com readers behind an McpServer, linked to
 * an SDK Client over InMemoryTransport (no network, no port). Loaded lazily by the registry.
 */
import { readAccountPosts, readPostThread, readXTrends, searchXPosts } from '../flow/skills/xReader';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { createXMcpServer, type XServiceLike } from './xMcpServer';

const service: XServiceLike = {
  search: searchXPosts,
  accountPosts: async (handle, limit) => (await readAccountPosts(handle, limit)).value,
  thread: async (ref) => (await readPostThread(ref)).value,
  trends: readXTrends,
};

export async function connectXMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createXMcpServer(service), clientName, clientVersion);
}

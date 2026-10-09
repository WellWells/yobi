/**
 * Builds the live, in-process X MCP connection: the x.com readers behind an McpServer, linked to
 * an SDK Client over InMemoryTransport (no network, no port). Loaded lazily by the registry.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readAccountPosts, readPostThread, readXTrends, searchXPosts } from '../flow/skills/xReader';
import { createXMcpServer, type XServiceLike } from './xMcpServer';

const service: XServiceLike = {
  search: searchXPosts,
  accountPosts: async (handle, limit) => (await readAccountPosts(handle, limit)).value,
  thread: async (ref) => (await readPostThread(ref)).value,
  trends: readXTrends,
};

export async function connectXMcp(clientName: string, clientVersion: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createXMcpServer(service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: clientVersion });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

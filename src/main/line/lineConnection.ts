/**
 * Builds a live, in-process LINE MCP connection: a real LineService behind an
 * McpServer, linked to an SDK Client over InMemoryTransport (no network, no port).
 *
 * Loads the native driver via LineService, so the MCP registry imports this lazily
 * (dynamic import) to keep itself out of the offline test path.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLineMcpServer } from './lineMcpServer';
import { getSharedLineService, resetSharedLineService } from './sharedService';
import type { LineService } from './lineService';

export interface LineConnection {
  client: Client;
  service: LineService;
  close: () => Promise<void>;
}

export async function connectLineMcp(clientName: string, clientVersion: string): Promise<LineConnection> {
  // Shared with the line_read flow skill so the ~80s key extraction is paid once per session.
  const service = getSharedLineService();
  const server = createLineMcpServer(service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: clientVersion });
  await client.connect(clientTransport);
  return {
    client,
    service,
    close: async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      resetSharedLineService();
    },
  };
}

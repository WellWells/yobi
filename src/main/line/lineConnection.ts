/**
 * Builds a live, in-process LINE MCP connection: a real LineService behind an
 * McpServer, linked to an SDK Client over InMemoryTransport (no network, no port).
 *
 * Loads the native driver via LineService, so the MCP registry imports this lazily
 * (dynamic import): the driver loads only when the LINE connector is used.
 */
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { createLineMcpServer } from './lineMcpServer';
import { getSharedLineService, resetSharedLineService } from './sharedService';

export async function connectLineMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  // Shared with the line_read flow skill so the slow key extraction runs once per session.
  const connection = await connectInProcess(createLineMcpServer(getSharedLineService()), clientName, clientVersion);
  return {
    client: connection.client,
    close: async () => {
      // Never throws (both closes swallow their errors), so the reset always runs.
      await connection.close();
      resetSharedLineService();
    },
  };
}

/** Builds the live, in-process page reading connection. Loaded lazily by the registry. */
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { readPageLink } from './pageReadLive';
import { createPageReadMcpServer } from './pageReadMcpServer';

export async function connectPageReadMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createPageReadMcpServer({ read: readPageLink }), clientName, clientVersion);
}

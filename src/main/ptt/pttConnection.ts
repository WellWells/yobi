/**
 * Builds the live, in-process PTT MCP connection: the app's one PTT service (its board directory
 * outlives a connection, so switching the connector off and on rereads nothing) and the article
 * reader, behind an MCP server linked to an SDK Client. Loaded lazily by the registry.
 */
import { readPttThread } from '../flow/skills/pttReader';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { createPttMcpServer } from './pttMcpServer';
import { pttService } from './pttService';

export async function connectPttMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createPttMcpServer({ service: pttService(), readThread: readPttThread }), clientName, clientVersion);
}

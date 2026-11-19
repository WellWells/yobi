/**
 * Builds the live, in-process Taiwan law MCP connection. The app has one law store (its open index
 * outlives a connection); connecting — which switching the connector on does at once — starts the
 * download and build in the background, so the index is usually ready by the first question.
 * Loaded lazily by the registry.
 */
import * as path from 'node:path';
import { app } from 'electron';
import { sendLog } from '../helpers';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { createLawMcpServer } from './lawMcpServer';
import { LAW_DIR_NAME } from './lawPaths';
import { LawStore } from './lawStore';

let store: LawStore | null = null;

export function lawStore(): LawStore {
  store ??= new LawStore({ dir: path.join(app.getPath('userData'), LAW_DIR_NAME), log: sendLog });
  return store;
}

export async function connectLawMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  const laws = lawStore();
  laws.prepare();
  return connectInProcess(createLawMcpServer({ index: () => laws.ready() }), clientName, clientVersion);
}

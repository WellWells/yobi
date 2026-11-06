/**
 * Builds the live, in-process translation connection: the translator over the network and the
 * files on this computer, behind an MCP server linked to an SDK Client. Loaded lazily by the registry.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from '../atomicWrite';
import { getOutputDir } from '../files';
import { agentReadPathFor } from '../flow/agent/agentSandbox';
import { reserveName } from '../flow/skills/savedDownloads';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { createTranslateMcpServer } from './translateMcpServer';
import { createTranslator } from './translateService';

/** The output folder is the one place the agent may write, under a name nothing there uses yet. */
async function saveOutput(fileName: string, content: string): Promise<string> {
  const dir = await getOutputDir();
  await fs.mkdir(dir, { recursive: true });
  const name = await reserveName(dir, fileName);
  const file = path.join(dir, name);
  try {
    await writeFileAtomic(file, content);
  } catch (err) {
    await fs.rm(file, { force: true }).catch(() => {});
    throw err;
  }
  return (await agentReadPathFor(file)) ?? name;
}

export async function connectTranslateMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  const server = createTranslateMcpServer({
    translate: createTranslator({ fetchFn: (url, init) => fetch(url, init) }),
    fileSize: async (file) => (await fs.stat(file)).size,
    readFile: (file) => fs.readFile(file),
    saveOutput,
  });
  return connectInProcess(server, clientName, clientVersion);
}

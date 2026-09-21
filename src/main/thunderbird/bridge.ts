/**
 * Hosts the Thunderbird MCP bridge — `mcp-bridge.cjs` from thunderbird-mcp by Tomasz Kasperczyk, a
 * pinned dependency — as a child process and speaks MCP to it over stdio. The bridge and the
 * Thunderbird add-on it talks to are the author's; this file only starts the bridge and decides
 * when starting it is worthwhile.
 *
 * Electron-free, so it is tested against the real bridge and a fake add-on.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { THUNDERBIRD_UNAVAILABLE_ERROR } from '../../shared/builtinConnectors';

export const CONNECTION_FILE_ENV = 'THUNDERBIRD_MCP_CONNECTION_FILE';

const BRIDGE_SEGMENTS = ['node_modules', 'thunderbird-mcp', 'mcp-bridge.cjs'] as const;

/**
 * The bridge's own sentence for "no Thunderbird answered", in both its discovery and its connection
 * failure. Any other failure is passed through untouched, so a wording change upstream degrades to
 * the raw message rather than to a wrong one.
 */
const THUNDERBIRD_MISSING = 'Is Thunderbird running';

export interface BridgeLocation {
  isPackaged: boolean;
  resourcesPath: string;
  /** Project root in development, where `node_modules` sits. */
  devRoot: string;
}

/** A packaged build unpacks the bridge beside the asar, so the child process reads a plain file. */
export function bridgeScriptPath(location: BridgeLocation): string {
  return location.isPackaged
    ? path.join(location.resourcesPath, 'app.asar.unpacked', ...BRIDGE_SEGMENTS)
    : path.join(location.devRoot, ...BRIDGE_SEGMENTS);
}

/** Where the add-on writes its connection file, as its README documents. The bridge does the real discovery. */
export function connectionFilePath(env: NodeJS.ProcessEnv = process.env, tmpdir: string = os.tmpdir()): string {
  return env[CONNECTION_FILE_ENV]?.trim() || path.join(tmpdir, 'thunderbird-mcp', 'connection.json');
}

/**
 * Null while there is no connection file: Thunderbird is closed — the add-on deletes the file on
 * shutdown — or the add-on is not installed. Otherwise the file's modification time, which moves
 * each time Thunderbird starts and writes it again.
 */
export function connectionFileFingerprint(file: string = connectionFilePath()): string | null {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? String(stat.mtimeMs) : null;
  } catch {
    return null;
  }
}

export interface BridgeOptions {
  command: string;
  script: string;
  /** Added to the short list of variables the SDK passes to a child process. */
  env?: Record<string, string>;
  clientName: string;
  clientVersion: string;
}

export interface BridgeConnection {
  client: Client;
  close: () => Promise<void>;
}

export async function connectBridge(options: BridgeOptions): Promise<BridgeConnection> {
  const transport = new StdioClientTransport({ command: options.command, args: [options.script], env: options.env });
  const client = new Client({ name: options.clientName, version: options.clientVersion });
  const close = async (): Promise<void> => {
    await client.close().catch(() => undefined);
  };
  await client.connect(transport);
  try {
    // The bridge completes the handshake by itself even with Thunderbird closed. Only a real
    // request reaches the add-on, so this is what separates a working connection from a started process.
    await client.listTools();
  } catch (err) {
    await close();
    const message = err instanceof Error ? err.message : String(err);
    throw message.includes(THUNDERBIRD_MISSING) ? new Error(THUNDERBIRD_UNAVAILABLE_ERROR) : err;
  }
  return { client, close };
}

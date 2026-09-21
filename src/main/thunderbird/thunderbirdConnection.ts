/**
 * Electron wiring for the Thunderbird connector: where this build keeps the bridge, the variables it
 * needs, and the `/agent` file sandbox as the attachment guard. The MCP registry loads this lazily,
 * the same way it loads the LINE connection.
 */
import * as path from 'node:path';
import { app } from 'electron';
import { denyReasonForFileTool, getAgentFileRoots } from '../flow/agent/agentSandbox';
import { resolveUserPath } from '../flow/skills/fileOps';
import { applyAttachmentPolicy, type CallVerdict } from './attachmentPolicy';
import { bridgeScriptPath, CONNECTION_FILE_ENV, connectBridge, type BridgeConnection } from './bridge';

/**
 * The SDK hands a child process only a short list of variables. ELECTRON_RUN_AS_NODE makes Yobi's own
 * binary run the bridge as plain Node, so no separate Node install is needed; TMPDIR carries macOS's
 * per-account temp folder, which is where the add-on writes its connection file.
 */
function bridgeEnv(): Record<string, string> {
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
  for (const key of ['TMPDIR', 'TMP', CONNECTION_FILE_ENV]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export function connectThunderbirdMcp(clientName: string, clientVersion: string): Promise<BridgeConnection> {
  return connectBridge({
    command: process.execPath,
    script: bridgeScriptPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      devRoot: path.join(__dirname, '../..'),
    }),
    env: bridgeEnv(),
    clientName,
    clientVersion,
  });
}

/** The same rule `file_read` follows, so mailing a file is never a way around the read sandbox. */
export function prepareThunderbirdCall(args: Record<string, unknown>): Promise<CallVerdict> {
  return applyAttachmentPolicy(args, async (raw) => {
    const denied = await denyReasonForFileTool('file_read', { path: raw }, await getAgentFileRoots());
    return denied ? { denied } : { path: await resolveUserPath(raw) };
  });
}

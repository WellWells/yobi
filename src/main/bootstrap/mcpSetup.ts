import { app, shell } from 'electron';
import { IPC } from '../../shared/types';
import type { McpServerView } from '../../shared/types';
import { sendLog, sendToRenderer } from '../helpers';
import { getLangCache, t } from '../i18n';
import { initMcpRegistry } from '../mcp';

export function initMcp(): void {
  const registry = initMcpRegistry({
    clientVersion: app.getVersion(),
    broadcast: (servers: McpServerView[]) => sendToRenderer(IPC.MCP_SERVER_STATUS, servers),
    openExternal: (url: string) => shell.openExternal(url),
    log: sendLog,
    authSuccessMessage: t(getLangCache(), 'mcp.auth.success'),
  });
  void registry.syncOnBoot();
}

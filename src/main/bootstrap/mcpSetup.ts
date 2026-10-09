import { app, shell } from 'electron';
import { IPC } from '../../shared/types';
import type { McpServerView } from '../../shared/types';
import { sendLog, sendToRenderer } from '../helpers';
import { getLangCache, t } from '../i18n';
import { initMcpRegistry } from '../mcp';
import { localizeServerViews } from '../mcp/mcpServerViews';

export function initMcp(): void {
  const registry = initMcpRegistry({
    clientVersion: app.getVersion(),
    broadcast: (servers: McpServerView[]) => sendToRenderer(IPC.MCP_SERVER_STATUS, localizeServerViews(servers)),
    openExternal: (url: string) => shell.openExternal(url),
    log: sendLog,
    // Read when the browser arrives, not at boot, so a language changed since then applies.
    authPageText: (key, vars) => t(getLangCache(), key, vars),
  });
  void registry.syncOnBoot();
}

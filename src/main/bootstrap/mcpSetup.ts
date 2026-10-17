import { app, shell } from 'electron';
import { IPC } from '../../shared/types';
import type { McpServerView } from '../../shared/types';
import { config, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { getLangCache, t } from '../i18n';
import { initMcpRegistry } from '../mcp';
import { localizeServerViews } from '../mcp/mcpServerViews';
import { decideTaiwanRailDefault } from '../rail/railDefault';

/** Connectors whose default depends on where the user is; decided once, before the registry reads the flags. */
function applyLocaleConnectorDefaults(): void {
  const patch = decideTaiwanRailDefault(config, app.getPreferredSystemLanguages());
  if (!patch) return;
  Object.assign(config, patch);
  saveConfig(patch);
  sendLog(`Taiwan rail connector default: ${patch.taiwanRailEnabled ? 'on' : 'off'} (system language ${app.getPreferredSystemLanguages()[0] ?? 'unknown'})`);
}

export function initMcp(): void {
  applyLocaleConnectorDefaults();
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

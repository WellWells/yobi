import { app, shell } from 'electron';
import { IPC } from '../../shared/types';
import type { McpServerView } from '../../shared/types';
import { config, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { getLangCache, t } from '../i18n';
import { initMcpRegistry } from '../mcp';
import { localizeServerViews } from '../mcp/mcpServerViews';
import { decidePttConnectorDefault } from '../ptt/pttDefault';
import { decideTaiwanRailDefault } from '../rail/railDefault';

/** Connectors whose default depends on where the user is; decided once, before the registry reads the flags. */
function applyLocaleConnectorDefaults(): void {
  const languages = app.getPreferredSystemLanguages();
  const rail = decideTaiwanRailDefault(config, languages);
  const ptt = decidePttConnectorDefault(config, languages);
  if (!rail && !ptt) return;
  const patch = { ...rail, ...ptt };
  Object.assign(config, patch);
  saveConfig(patch);
  const system = `system language ${languages[0] ?? 'unknown'}`;
  if (rail) sendLog(`Taiwan rail connector default: ${rail.taiwanRailEnabled ? 'on' : 'off'} (${system})`);
  if (ptt) sendLog(`PTT connector default: ${ptt.pttConnectorEnabled ? 'on' : 'off'} (${system})`);
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

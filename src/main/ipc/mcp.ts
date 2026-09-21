import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { McpServerActionResult, McpServerSaveRequest, McpServerView } from '../../shared/types';
import { getMcpRegistry } from '../mcp';
import { getLangCache, localizeUserFacingError } from '../i18n';

function emptyResult(error?: string): McpServerActionResult {
  return { ok: false, servers: [], error };
}

export function registerMcpHandlers(): void {
  ipcMain.handle(IPC.MCP_LIST_SERVERS, (): McpServerView[] => getMcpRegistry()?.listServers() ?? []);

  ipcMain.handle(IPC.MCP_SAVE_SERVER, async (_event, req: McpServerSaveRequest): Promise<McpServerActionResult> => {
    const registry = getMcpRegistry();
    if (!registry) return emptyResult('MCP is unavailable');
    try {
      return await registry.saveServer(req);
    } catch (err) {
      return { ok: false, servers: registry.listServers(), error: localizeUserFacingError(errText(err), getLangCache()) };
    }
  });

  ipcMain.handle(IPC.MCP_DELETE_SERVER, (_event, id: string): McpServerActionResult => {
    const registry = getMcpRegistry();
    if (!registry) return emptyResult('MCP is unavailable');
    return registry.removeServer((id ?? '').trim());
  });

  ipcMain.handle(IPC.MCP_CONNECT_SERVER, async (_event, id: string): Promise<McpServerActionResult> => {
    const registry = getMcpRegistry();
    if (!registry) return emptyResult('MCP is unavailable');
    try {
      const result = await registry.connectServer((id ?? '').trim());
      return { ...result, error: result.error ? localizeUserFacingError(result.error, getLangCache()) : undefined };
    } catch (err) {
      return { ok: false, servers: registry.listServers(), error: localizeUserFacingError(errText(err), getLangCache()) };
    }
  });

  ipcMain.handle(IPC.MCP_DISCONNECT_SERVER, (_event, id: string): McpServerActionResult => {
    const registry = getMcpRegistry();
    if (!registry) return emptyResult('MCP is unavailable');
    return registry.disconnectServer((id ?? '').trim());
  });

  ipcMain.handle(IPC.MCP_SET_BUILTIN_ENABLED, async (_event, id: string, enabled: boolean): Promise<McpServerActionResult> => {
    const registry = getMcpRegistry();
    if (!registry) return emptyResult('MCP is unavailable');
    try {
      const result = await registry.setBuiltinEnabled((id ?? '').trim(), enabled === true);
      return { ...result, error: result.error ? localizeUserFacingError(result.error, getLangCache()) : undefined };
    } catch (err) {
      return { ok: false, servers: registry.listServers(), error: localizeUserFacingError(errText(err), getLangCache()) };
    }
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

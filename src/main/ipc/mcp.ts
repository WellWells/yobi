import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { McpServerActionResult, McpServerSaveRequest, McpServerView } from '../../shared/types';
import { errorText } from '../../shared/errorText';
import { getMcpRegistry } from '../mcp';
import { MCP_UNAVAILABLE } from '../mcp/mcpErrors';
import { localizeActionResult, localizeServerViews } from '../mcp/mcpServerViews';
import { listFlowTools } from '../mcp/flowTools';
import type { McpFlowToolsRequest, McpFlowToolsResult } from '../../shared/mcpFlowStep';

// Every result leaves through localizeActionResult: both the action's own error and each card's.
function unavailableResult(): McpServerActionResult {
  return localizeActionResult({ ok: false, servers: [], error: MCP_UNAVAILABLE });
}

export function registerMcpHandlers(): void {
  ipcMain.handle(IPC.MCP_LIST_SERVERS, (): McpServerView[] => localizeServerViews(getMcpRegistry()?.listServers() ?? []));

  ipcMain.handle(IPC.MCP_SAVE_SERVER, async (_event, req: McpServerSaveRequest): Promise<McpServerActionResult> => {
    const registry = getMcpRegistry();
    if (!registry) return unavailableResult();
    try {
      return localizeActionResult(await registry.saveServer(req));
    } catch (err) {
      return localizeActionResult({ ok: false, servers: registry.listServers(), error: errorText(err) });
    }
  });

  ipcMain.handle(IPC.MCP_DELETE_SERVER, (_event, id: string): McpServerActionResult => {
    const registry = getMcpRegistry();
    if (!registry) return unavailableResult();
    return localizeActionResult(registry.removeServer((id ?? '').trim()));
  });

  ipcMain.handle(IPC.MCP_CONNECT_SERVER, async (_event, id: string): Promise<McpServerActionResult> => {
    const registry = getMcpRegistry();
    if (!registry) return unavailableResult();
    try {
      return localizeActionResult(await registry.connectServer((id ?? '').trim()));
    } catch (err) {
      return localizeActionResult({ ok: false, servers: registry.listServers(), error: errorText(err) });
    }
  });

  ipcMain.handle(IPC.MCP_DISCONNECT_SERVER, (_event, id: string): McpServerActionResult => {
    const registry = getMcpRegistry();
    if (!registry) return unavailableResult();
    return localizeActionResult(registry.disconnectServer((id ?? '').trim()));
  });

  ipcMain.handle(IPC.MCP_SET_BUILTIN_ENABLED, async (_event, id: string, enabled: boolean): Promise<McpServerActionResult> => {
    const registry = getMcpRegistry();
    if (!registry) return unavailableResult();
    try {
      return localizeActionResult(await registry.setBuiltinEnabled((id ?? '').trim(), enabled === true));
    } catch (err) {
      return localizeActionResult({ ok: false, servers: registry.listServers(), error: errorText(err) });
    }
  });

  // The flow editor's connector step. Connects only what needs no sign-in; never opens a browser.
  ipcMain.handle(IPC.MCP_FLOW_TOOLS, async (_event, req: McpFlowToolsRequest): Promise<McpFlowToolsResult> => {
    const registry = getMcpRegistry();
    if (!registry || !req || typeof req !== 'object') return { status: 'missing', tools: [] };
    try {
      return await listFlowTools(registry, req);
    } catch {
      return { status: 'unavailable', tools: [] };
    }
  });
}

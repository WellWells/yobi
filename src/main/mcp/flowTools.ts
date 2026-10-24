/**
 * Connectors as the `mcp` flow step sees them: the editor's tool list, and the lookups and
 * non-interactive connect a run makes. Nothing here opens a browser — a server that needs a sign-in
 * is reported as such and left to Settings, where the user starts one.
 */
import type { McpServerView } from '../../shared/types';
import {
  interpolateMcpArguments,
  schemaFields,
  type McpFlowToolsRequest,
  type McpFlowToolsResult,
  type McpStepAccess,
} from '../../shared/mcpFlowStep';
import { resolveToolContract } from '../flow/agent/contractRegistry';
import { connectServersForRun } from '../flow/agent/mcpConnectOnUse';
import type { McpRegistry } from './mcpRegistry';
import type { McpTool } from './mcpTypes';
import { localizeServerViews } from './mcpServerViews';

export type McpStepRegistry = Pick<McpRegistry, 'listServers' | 'getConnectedTools' | 'callTool' | 'connectForUse'>;

/**
 * What one call does, from the same contracts `/agent`'s action gate reads (known connectors, then
 * MCP annotations, then the verb in the tool's name; a tool nobody can classify is a write).
 */
export function mcpToolAccess(serverId: string, tool: McpTool, args: Record<string, unknown>): McpStepAccess {
  const risk = resolveToolContract(serverId, tool).risk(args);
  if (risk === 'read') return 'read';
  return risk === 'destructive' ? 'delete' : 'write';
}

function fold(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase();
}

/**
 * The server a step names: its id (what the editor stores), else its name or slash command
 * (what an AI-built step writes), folded and only when exactly one matches.
 */
export function findStepServer(servers: readonly McpServerView[], ref: string): McpServerView | undefined {
  const wanted = ref.trim();
  if (!wanted) return undefined;
  const byId = servers.find((server) => server.id === wanted);
  if (byId) return byId;
  const folded = fold(wanted.replace(/^\//, ''));
  const matches = servers.filter((server) => fold(server.name) === folded || fold(server.commandName ?? '') === folded);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Not connected, and using it will not connect it: a sign-in that is missing or expired, or a
 * connector switched off. Only Settings fixes that.
 */
export function needsSignIn(server: Pick<McpServerView, 'status' | 'connectOnUse'>): boolean {
  if (server.status === 'connected' || server.status === 'connecting') return false;
  return server.status === 'needs_auth' || (server.status === 'disconnected' && server.connectOnUse !== true);
}

/**
 * Connects the server the way `/agent` connects a connector the user named: without a sign-in and
 * waiting for the attempt to end. Returns the server as it is afterwards.
 */
export async function connectStepServer(
  registry: McpStepRegistry,
  server: McpServerView,
  signal?: AbortSignal,
): Promise<McpServerView> {
  if (server.status === 'connected' || !server.connectOnUse) return server;
  await connectServersForRun(registry, { declared: [server.id], signal });
  return registry.listServers().find((entry) => entry.id === server.id) ?? server;
}

export function liveTools(registry: Pick<McpStepRegistry, 'getConnectedTools'>, serverId: string): McpTool[] {
  return registry.getConnectedTools().find((entry) => entry.serverId === serverId)?.tools ?? [];
}

/** Placeholders stay as written: the editor checks the shape, not the values a run fills in. */
function editorArguments(text: string | undefined): Record<string, unknown> {
  const parsed = interpolateMcpArguments(text ?? '', (name) => `{{${name}}}`);
  return parsed.ok ? parsed.value : {};
}

/** The editor's view of one connector: its tools with their access and fields, connecting it first when asked. */
export async function listFlowTools(registry: McpStepRegistry, request: McpFlowToolsRequest): Promise<McpFlowToolsResult> {
  const serverId = typeof request?.serverId === 'string' ? request.serverId.trim() : '';
  let server = registry.listServers().find((entry) => entry.id === serverId);
  if (!server) return { status: 'missing', tools: [] };
  if (request.connect === true) server = await connectStepServer(registry, server);
  if (server.status !== 'connected') return { status: needsSignIn(server) ? 'needsSignIn' : 'unavailable', tools: [] };

  // Titles as Settings shows them: a built-in connector's tools in the app's own words.
  const titles = new Map(localizeServerViews([server])[0]?.tools.map((tool) => [tool.name, tool.title]) ?? []);
  const live = liveTools(registry, server.id);
  const tools = live.map((tool) => {
    const title = titles.get(tool.name);
    return {
      name: tool.name,
      ...(title ? { title } : {}),
      access: mcpToolAccess(server.id, tool, {}),
      fields: schemaFields(tool.inputSchema),
    };
  });
  const picked = typeof request.tool === 'string' ? live.find((tool) => tool.name === request.tool) : undefined;
  return {
    status: 'connected',
    tools,
    ...(picked ? { selectedAccess: mcpToolAccess(server.id, picked, editorArguments(request.args)) } : {}),
  };
}

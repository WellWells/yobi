import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config, saveConfig } from '../config';
import { assertPublicHttpUrl, guardedFetch } from '../net/ssrfGuard';
import type { McpConnectionStatus, McpServerActionResult, McpServerConfig, McpServerSaveRequest, McpServerView } from '../../shared/types';
import type { McpTool, McpToolResult } from './mcpTypes';
import { McpAuthProvider } from './mcpAuthProvider';
import { startCallbackServer } from './mcpCallbackServer';
import { clearAuthRecord, getAuthRecord, setAuthRecord } from './mcpTokenStore';
import { buildManualAuthHeaders } from './mcpAuthHeaders';
import { filterAgentServers } from '../flow/agent/mcpTools';

const CLIENT_NAME = 'Yobi';
const AUTH_TIMEOUT_MS = 5 * 60_000;
const CALL_TIMEOUT_MS = 120_000;

export interface McpRegistryDeps {
  clientVersion: string;
  broadcast: (servers: McpServerView[]) => void;
  openExternal: (url: string) => Promise<void>;
  log: (message: string) => void;
  authSuccessMessage?: string;
  fetchImpl?: FetchLike;
}

interface ServerRuntime {
  config: McpServerConfig;
  status: McpConnectionStatus;
  tools: McpTool[];
  client: Client | null;
  transport: StreamableHTTPClientTransport | null;
  error?: string;
  interactive: boolean;
  needsAuth: boolean;
}

export interface ConnectedServerTools {
  serverId: string;
  serverName: string;
  tools: McpTool[];
}

function flattenResult(result: CallToolResult): McpToolResult {
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    if (item.type === 'text') parts.push(item.text);
    else if (item.type === 'image') parts.push('[image content omitted]');
    else if (item.type === 'audio') parts.push('[audio content omitted]');
    else if (item.type === 'resource') {
      const resource = item.resource;
      const embedded = 'text' in resource && typeof resource.text === 'string' ? resource.text : '';
      parts.push(embedded || `[resource ${resource.uri ?? ''}]`);
    }
  }
  let text = parts.join('\n').trim();
  if (!text && result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent);
  return { text, isError: result.isError === true };
}

export class McpRegistry {
  private readonly runtimes = new Map<string, ServerRuntime>();

  constructor(private readonly deps: McpRegistryDeps) {
    for (const server of config.mcpServers) {
      this.runtimes.set(server.id, newRuntime(server));
    }
  }

  private fetchImpl(): FetchLike {
    return this.deps.fetchImpl ?? guardedFetch;
  }

  private viewFor(rt: ServerRuntime): McpServerView {
    const record = getAuthRecord(rt.config.id);
    return {
      ...rt.config,
      status: rt.status,
      toolCount: rt.tools.length,
      authorized: Boolean(record?.tokens),
      hasToken: Boolean(record?.manualToken),
      error: rt.error,
      tools: rt.tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })),
    };
  }

  listServers(): McpServerView[] {
    return [...this.runtimes.values()].map((rt) => this.viewFor(rt));
  }

  private broadcastAll(): void {
    this.deps.broadcast(this.listServers());
  }

  private setStatus(rt: ServerRuntime, status: McpConnectionStatus): void {
    rt.status = status;
    this.broadcastAll();
  }

  private async listAllTools(client: Client): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  private async connect(id: string, interactive: boolean): Promise<McpServerView> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('Unknown MCP server');
    if (rt.status === 'connecting') return this.viewFor(rt);
    try {
      await assertPublicHttpUrl(rt.config.url);
    } catch (err) {
      rt.error = `Invalid MCP server URL: ${errText(err)}`;
      this.setStatus(rt, 'error');
      return this.viewFor(rt);
    }

    this.setStatus(rt, 'connecting');

    const manualToken = getAuthRecord(rt.config.id)?.manualToken;
    if (manualToken) {
      const client = new Client({ name: CLIENT_NAME, version: this.deps.clientVersion });
      const transport = new StreamableHTTPClientTransport(new URL(rt.config.url), {
        requestInit: { headers: buildManualAuthHeaders(manualToken, rt.config.headerName) },
        fetch: this.fetchImpl(),
      });
      try {
        await client.connect(transport);
        const tools = await this.listAllTools(client);
        rt.client = client;
        rt.transport = transport;
        rt.tools = tools;
        rt.error = undefined;
        this.setStatus(rt, 'connected');
        this.deps.log(`[mcp] connected ${rt.config.name} (${tools.length} tools, token auth)`);
      } catch (err) {
        await client.close().catch(() => {});
        rt.client = null;
        rt.transport = null;
        rt.tools = [];
        rt.error = errText(err);
        this.setStatus(rt, 'error');
        this.deps.log(`[mcp] connect failed ${rt.config.name}: ${rt.error}`);
      }
      return this.viewFor(rt);
    }

    rt.interactive = interactive;
    rt.needsAuth = false;

    const callback = await startCallbackServer(this.deps.authSuccessMessage);
    const provider = new McpAuthProvider(rt.config.id, callback.redirectUri, {
      isInteractive: () => rt.interactive,
      openBrowser: this.deps.openExternal,
      onNeedsAuth: () => { rt.needsAuth = true; },
    });
    const makeTransport = (): StreamableHTTPClientTransport =>
      new StreamableHTTPClientTransport(new URL(rt.config.url), { authProvider: provider, fetch: this.fetchImpl() });
    const makeClient = (): Client => new Client({ name: CLIENT_NAME, version: this.deps.clientVersion });

    let client = makeClient();
    let transport = makeTransport();
    try {
      try {
        await client.connect(transport);
      } catch (err) {
        if (err instanceof UnauthorizedError && rt.interactive) {
          const code = await callback.waitForCode(provider.expectedState, AUTH_TIMEOUT_MS);
          await transport.finishAuth(code);
          transport = makeTransport();
          client = makeClient();
          await client.connect(transport);
        } else {
          throw err;
        }
      }
      const tools = await this.listAllTools(client);
      rt.client = client;
      rt.transport = transport;
      rt.tools = tools;
      rt.error = undefined;
      this.setStatus(rt, 'connected');
      this.deps.log(`[mcp] connected ${rt.config.name} (${tools.length} tools)`);
    } catch (err) {
      await client.close().catch(() => {});
      rt.client = null;
      rt.transport = null;
      rt.tools = [];
      rt.error = errText(err);
      this.setStatus(rt, rt.needsAuth ? 'needs_auth' : 'error');
      this.deps.log(`[mcp] connect failed ${rt.config.name}: ${rt.error}`);
    } finally {
      callback.close();
      rt.interactive = false;
    }
    return this.viewFor(rt);
  }

  async connectServer(id: string): Promise<McpServerActionResult> {
    const view = await this.connect(id, true);
    return { ok: view.status === 'connected', servers: this.listServers(), error: view.error };
  }

  disconnectServer(id: string): McpServerActionResult {
    const rt = this.runtimes.get(id);
    if (rt) {
      void rt.client?.close();
      rt.client = null;
      rt.transport = null;
      rt.tools = [];
      rt.error = undefined;
      this.setStatus(rt, 'disconnected');
    }
    return { ok: true, servers: this.listServers() };
  }

  async saveServer(req: McpServerSaveRequest): Promise<McpServerActionResult> {
    const url = (req.url ?? '').trim();
    try {
      const parsed = await assertPublicHttpUrl(url);
      if (parsed.protocol !== 'https:') throw new Error('MCP server URL must use https');
    } catch (err) {
      return { ok: false, servers: this.listServers(), error: `Invalid MCP server URL: ${errText(err)}` };
    }
    const name = (req.name ?? '').trim() || hostnameOf(url);
    const headerName = (req.headerName ?? '').trim() || undefined;
    const id = (req.id ?? '').trim();
    const existing = id ? config.mcpServers.find((s) => s.id === id) : undefined;

    let targetId: string;
    if (existing) {
      const urlChanged = existing.url !== url;
      existing.name = name;
      existing.url = url;
      existing.headerName = headerName;
      if (req.agentEnabled !== undefined) existing.agentEnabled = req.agentEnabled;
      if (req.autoApproveWrites !== undefined) existing.autoApproveWrites = req.autoApproveWrites;
      const rt = this.runtimes.get(existing.id);
      if (rt) rt.config = existing;
      if (urlChanged && rt) {
        void rt.client?.close();
        rt.client = null;
        rt.transport = null;
        rt.tools = [];
        rt.status = 'disconnected';
        clearAuthRecord(existing.id);
      }
      targetId = existing.id;
    } else {
      const server: McpServerConfig = {
        id: randomUUID(),
        name,
        url,
        enabled: true,
        agentEnabled: req.agentEnabled !== false,
        autoApproveWrites: req.autoApproveWrites === true,
        createdAt: new Date().toISOString(),
        headerName,
      };
      config.mcpServers.push(server);
      this.runtimes.set(server.id, newRuntime(server));
      targetId = server.id;
    }
    const token = (req.token ?? '').trim();
    if (token) setAuthRecord(targetId, { ...(getAuthRecord(targetId) ?? {}), manualToken: token });

    saveConfig({ mcpServers: config.mcpServers });
    this.broadcastAll();
    return { ok: true, servers: this.listServers() };
  }

  removeServer(id: string): McpServerActionResult {
    const index = config.mcpServers.findIndex((s) => s.id === id);
    if (index === -1) return { ok: false, servers: this.listServers(), error: 'Server not found' };
    const rt = this.runtimes.get(id);
    void rt?.client?.close();
    this.runtimes.delete(id);
    clearAuthRecord(id);
    config.mcpServers.splice(index, 1);
    saveConfig({ mcpServers: config.mcpServers });
    this.broadcastAll();
    return { ok: true, servers: this.listServers() };
  }

  getConnectedTools(): ConnectedServerTools[] {
    const out: ConnectedServerTools[] = [];
    for (const rt of this.runtimes.values()) {
      if (rt.status === 'connected' && rt.tools.length > 0) {
        out.push({ serverId: rt.config.id, serverName: rt.config.name, tools: rt.tools });
      }
    }
    return out;
  }

  getAgentTools(): ConnectedServerTools[] {
    return filterAgentServers(this.getConnectedTools(), config.mcpServers);
  }

  setAutoApproveWrites(serverId: string, value: boolean): boolean {
    const server = config.mcpServers.find((s) => s.id === serverId);
    if (!server) return false;
    server.autoApproveWrites = value;
    const rt = this.runtimes.get(serverId);
    if (rt) rt.config = server;
    saveConfig({ mcpServers: config.mcpServers });
    this.broadcastAll();
    return true;
  }

  findTool(serverId: string, name: string): McpTool | undefined {
    return this.runtimes.get(serverId)?.tools.find((tool) => tool.name === name);
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    const rt = this.runtimes.get(serverId);
    if (!rt?.client || rt.status !== 'connected') throw new Error(`MCP server "${serverId}" is not connected`);
    const result = await rt.client.callTool({ name, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
    return flattenResult(result as CallToolResult);
  }

  async syncOnBoot(): Promise<void> {
    const reconnectable = [...this.runtimes.values()].filter((rt) => {
      if (!rt.config.enabled) return false;
      const record = getAuthRecord(rt.config.id);
      return Boolean(record?.tokens || record?.manualToken);
    });
    await Promise.all(reconnectable.map((rt) => this.connect(rt.config.id, false)));
  }
}

function newRuntime(server: McpServerConfig): ServerRuntime {
  return { config: server, status: 'disconnected', tools: [], client: null, transport: null, interactive: false, needsAuth: false };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let registry: McpRegistry | null = null;

export function initMcpRegistry(deps: McpRegistryDeps): McpRegistry {
  registry = new McpRegistry(deps);
  return registry;
}

export function getMcpRegistry(): McpRegistry | null {
  return registry;
}

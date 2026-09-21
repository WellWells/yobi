import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config, saveConfig } from '../config';
import type { Config } from '../configTypes';
import { assertPublicHttpUrl, guardedFetch } from '../net/ssrfGuard';
import { slugifyCommandName } from '../../shared/mcpCommand';
import { BUILTIN_CONNECTORS, findBuiltinConnector } from '../../shared/builtinConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../shared/types';
import type { McpConnectionStatus, McpServerActionResult, McpServerConfig, McpServerSaveRequest, McpServerView } from '../../shared/types';
import type { McpTool, McpToolResult } from './mcpTypes';
import { McpAuthProvider } from './mcpAuthProvider';
import { startCallbackServer } from './mcpCallbackServer';
import { clearAuthRecord, getAuthRecord, setAuthRecord } from './mcpTokenStore';
import { buildManualAuthHeaders } from './mcpAuthHeaders';
import { filterAgentServers } from '../flow/agent/mcpTools';
import { BUILTIN_RUNTIMES, type BuiltinConnection, type BuiltinRuntime } from './builtinRuntimes';

export type { BuiltinConnection, BuiltinRuntime } from './builtinRuntimes';

const CLIENT_NAME = 'Yobi';
const AUTH_TIMEOUT_MS = 5 * 60_000;
const CALL_TIMEOUT_MS = 120_000;
/** Each poll reads one small file, so waiting for an app that is not running yet costs nothing. */
const BUILTIN_RETRY_MS = 10_000;

export interface McpRegistryDeps {
  clientVersion: string;
  broadcast: (servers: McpServerView[]) => void;
  openExternal: (url: string) => Promise<void>;
  log: (message: string) => void;
  authSuccessMessage?: string;
  fetchImpl?: FetchLike;
  // Overridable for tests; production uses BUILTIN_RUNTIMES, which loads each connection lazily.
  builtins?: Readonly<Record<string, BuiltinRuntime>>;
  builtinRetryMs?: number;
}

interface ServerRuntime {
  config: McpServerConfig;
  status: McpConnectionStatus;
  tools: McpTool[];
  client: Client | null;
  transport: Transport | null;
  error?: string;
  interactive: boolean;
  needsAuth: boolean;
  // 'builtin' servers are hosted in-process (LINE, Thunderbird) over an in-memory transport;
  // they skip URL validation and OAuth and are never persisted in config.mcpServers.
  kind: 'http' | 'builtin';
  close?: () => Promise<void>;
}

// Stable id for the in-process LINE connector. `builtin://` is never network-dialed.
export const BUILTIN_LINE_ID = BUILTIN_LINE_SERVER_ID;

export interface ConnectedServerTools {
  serverId: string;
  serverName: string;
  /** Carried so the agent catalog can tell a server holding the user's own data from a public one. */
  url: string;
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
  /** Poll timers for built-ins waiting on the app they relay to. */
  private readonly watchers = new Map<string, ReturnType<typeof setInterval>>();
  /** The availability value the last failed attempt saw; the next attempt waits for a different one. */
  private readonly failedAvailability = new Map<string, string | null>();

  constructor(private readonly deps: McpRegistryDeps) {
    for (const server of config.mcpServers) {
      this.runtimes.set(server.id, newRuntime(server));
    }
    for (const builtin of BUILTIN_CONNECTORS) {
      if (config[builtin.flag]) this.runtimes.set(builtin.id, newBuiltinRuntime(builtin.descriptor()));
    }
  }

  private fetchImpl(): FetchLike {
    return this.deps.fetchImpl ?? guardedFetch;
  }

  private builtinRuntime(id: string): BuiltinRuntime | undefined {
    return (this.deps.builtins ?? BUILTIN_RUNTIMES)[id];
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
    if (rt.kind === 'builtin') return this.connectBuiltin(rt);
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

  // In-process connectors: no URL, no OAuth, no port of their own.
  private async connectBuiltin(rt: ServerRuntime): Promise<McpServerView> {
    const id = rt.config.id;
    const runtime = this.builtinRuntime(id);
    if (!runtime) {
      rt.error = 'Unknown built-in connector';
      this.setStatus(rt, 'error');
      return this.viewFor(rt);
    }
    const availability = runtime.availability?.() ?? null;
    if (runtime.availability && availability === null) {
      // The app it relays to is not running. That is a state to wait out, not an attempt to log.
      rt.error = runtime.unavailableError;
      this.failedAvailability.set(id, null);
      this.setStatus(rt, 'error');
      this.watchBuiltin(id, runtime);
      return this.viewFor(rt);
    }

    this.setStatus(rt, 'connecting');
    let conn: BuiltinConnection | undefined;
    try {
      conn = await runtime.connect(CLIENT_NAME, this.deps.clientVersion);
      const tools = await this.listAllTools(conn.client);
      rt.client = conn.client;
      rt.transport = null;
      rt.close = conn.close;
      rt.tools = tools;
      rt.error = undefined;
      this.stopWatching(id);
      this.setStatus(rt, 'connected');
      this.deps.log(`[mcp] connected ${rt.config.name} (${tools.length} tools, in-process)`);
    } catch (err) {
      await conn?.close().catch(() => {});
      await rt.close?.().catch(() => {});
      rt.client = null;
      rt.close = undefined;
      rt.tools = [];
      rt.error = errText(err);
      this.setStatus(rt, 'error');
      this.deps.log(`[mcp] connect failed ${rt.config.name}: ${rt.error}`);
      if (runtime.availability) {
        this.failedAvailability.set(id, availability);
        this.watchBuiltin(id, runtime);
      }
    }
    return this.viewFor(rt);
  }

  /**
   * Retries a built-in that relays to another app once that app's availability value changes — it
   * started, restarted, or went away. Waiting for a change instead of retrying on a clock keeps a
   * connection file left behind by a crash from becoming a failed attempt every few seconds.
   */
  private watchBuiltin(id: string, runtime: BuiltinRuntime): void {
    if (!runtime.availability || this.watchers.has(id)) return;
    const timer = setInterval(() => {
      const rt = this.runtimes.get(id);
      if (!rt || rt.status === 'connected') {
        this.stopWatching(id);
        return;
      }
      if (rt.status === 'connecting') return;
      const availability = runtime.availability?.() ?? null;
      if (availability === this.failedAvailability.get(id)) return;
      void this.connect(id, false);
    }, this.deps.builtinRetryMs ?? BUILTIN_RETRY_MS);
    timer.unref?.();
    this.watchers.set(id, timer);
  }

  private stopWatching(id: string): void {
    const timer = this.watchers.get(id);
    if (timer) clearInterval(timer);
    this.watchers.delete(id);
    this.failedAvailability.delete(id);
  }

  async connectServer(id: string): Promise<McpServerActionResult> {
    const view = await this.connect(id, true);
    return { ok: view.status === 'connected', servers: this.listServers(), error: view.error };
  }

  /** Switches a built-in connector on or off. Its opt-in is a config flag, not a `config.mcpServers` entry. */
  async setBuiltinEnabled(id: string, enabled: boolean): Promise<McpServerActionResult> {
    const builtin = findBuiltinConnector(id);
    if (!builtin) return { ok: false, servers: this.listServers(), error: 'Unknown built-in connector' };
    config[builtin.flag] = enabled;
    const patch: Partial<Config> = {};
    patch[builtin.flag] = enabled;
    saveConfig(patch);

    const existing = this.runtimes.get(id);
    if (enabled) {
      // Reconnecting a live built-in would orphan its connection, and for LINE throw away the
      // extracted database key with it.
      if (existing?.status === 'connected') return { ok: true, servers: this.listServers() };
      if (!existing) this.runtimes.set(id, newBuiltinRuntime(builtin.descriptor()));
      const view = await this.connect(id, false);
      return { ok: view.status === 'connected', servers: this.listServers(), error: view.error };
    }
    this.stopWatching(id);
    if (existing) {
      await existing.close?.().catch(() => {});
      void existing.client?.close();
      this.runtimes.delete(id);
    }
    this.builtinRuntime(id)?.onDisabled?.();
    this.broadcastAll();
    return { ok: true, servers: this.listServers() };
  }

  disconnectServer(id: string): McpServerActionResult {
    const rt = this.runtimes.get(id);
    if (rt) {
      this.stopWatching(id);
      void rt.close?.();
      void rt.client?.close();
      rt.client = null;
      rt.transport = null;
      rt.close = undefined;
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
    const commandName = slugifyCommandName(req.commandName ?? '') || undefined;
    const id = (req.id ?? '').trim();
    const existing = id ? config.mcpServers.find((s) => s.id === id) : undefined;

    let targetId: string;
    if (existing) {
      const urlChanged = existing.url !== url;
      existing.name = name;
      existing.url = url;
      existing.headerName = headerName;
      if (req.commandName !== undefined) existing.commandName = commandName;
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
        ...(commandName ? { commandName } : {}),
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

  /**
   * Rebuilds the runtime table from `config.mcpServers`.
   *
   * The table is built once, in the constructor, which is fine while every change goes through
   * this class. A config replaced wholesale does not: after a backup import the Connectors view
   * still listed the servers from before it, and `connectServer` could not find any of the
   * imported ids until the app was restarted.
   *
   * A server whose id and URL both survived keeps its runtime, connection included — only its
   * config object is refreshed, so renaming one in a backup does not drop a live connection.
   */
  syncWithConfig(): void {
    const wanted = new Set(config.mcpServers.map((server) => server.id));
    for (const [id, rt] of [...this.runtimes]) {
      if (rt.kind === 'builtin') continue; // not config-backed; managed via setBuiltinEnabled
      if (wanted.has(id)) continue;
      void rt.client?.close();
      this.runtimes.delete(id);
    }
    for (const server of config.mcpServers) {
      const existing = this.runtimes.get(server.id);
      if (existing && existing.config.url === server.url) {
        existing.config = server;
        continue;
      }
      if (existing) void existing.client?.close();
      this.runtimes.set(server.id, newRuntime(server));
    }
    this.broadcastAll();
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
        out.push({ serverId: rt.config.id, serverName: rt.config.name, url: rt.config.url, tools: rt.tools });
      }
    }
    return out;
  }

  getAgentTools(): ConnectedServerTools[] {
    const connected = this.getConnectedTools();
    const httpTools = filterAgentServers(connected, config.mcpServers);
    // Built-in connectors are not in config.mcpServers, so include them explicitly.
    const builtinTools = connected.filter((entry) => findBuiltinConnector(entry.serverId));
    return [...httpTools, ...builtinTools];
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
    const prepare = rt.kind === 'builtin' ? this.builtinRuntime(serverId)?.prepareCall : undefined;
    const verdict = prepare ? await prepare(name, args) : { args };
    if ('denied' in verdict) return { text: verdict.denied, isError: true };
    const result = await rt.client.callTool({ name, arguments: verdict.args }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
    return flattenResult(result as CallToolResult);
  }

  async syncOnBoot(): Promise<void> {
    const reconnectable = [...this.runtimes.values()].filter((rt) => {
      if (!rt.config.enabled) return false;
      if (rt.kind === 'builtin') return true; // in-process, no auth needed
      const record = getAuthRecord(rt.config.id);
      return Boolean(record?.tokens || record?.manualToken);
    });
    await Promise.all(reconnectable.map((rt) => this.connect(rt.config.id, false)));
  }
}

function newRuntime(server: McpServerConfig): ServerRuntime {
  return { config: server, status: 'disconnected', tools: [], client: null, transport: null, interactive: false, needsAuth: false, kind: 'http' };
}

function newBuiltinRuntime(server: McpServerConfig): ServerRuntime {
  return { config: server, status: 'disconnected', tools: [], client: null, transport: null, interactive: false, needsAuth: false, kind: 'builtin' };
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

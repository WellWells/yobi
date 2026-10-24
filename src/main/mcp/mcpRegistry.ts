import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config, saveConfig } from '../config';
import type { Config } from '../configTypes';
import { assertPublicHttpUrl, guardedFetch } from '../net/ssrfGuard';
import { errorText } from '../../shared/errorText';
import { slugifyCommandName } from '../../shared/mcpCommand';
import { connectsOnUse } from '../../shared/mcpConnectOnUse';
import { BUILTIN_CONNECTORS, findBuiltinConnector } from '../../shared/builtinConnectors';
import type { McpConnectionStatus, McpServerActionResult, McpServerConfig, McpServerSaveRequest, McpServerView, McpToolInfo } from '../../shared/types';
import { PICTURES_META_KEY } from './mcpTypes';
import type { McpTool, McpToolResult } from './mcpTypes';
import { McpAuthProvider } from './mcpAuthProvider';
import { startCallbackServer } from './mcpCallbackServer';
import {
  MCP_INVALID_URL_PREFIX,
  MCP_SERVER_NOT_FOUND,
  MCP_UNKNOWN_BUILTIN,
  MCP_UNKNOWN_SERVER,
  MCP_URL_NEEDS_HTTPS,
} from './mcpErrors';
import type { McpAuthPageText } from './mcpErrors';
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
  /** Text of the page the browser shows after the provider's sign-in, in the app's language. */
  authPageText?: McpAuthPageText;
  fetchImpl?: FetchLike;
  // Defaults to BUILTIN_RUNTIMES, which loads each connection lazily.
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
  /** Times the user ended this connection (disconnected it, gave it a new URL); a renewal that sees it move stands down. */
  cuts: number;
}

export interface ConnectedServerTools {
  serverId: string;
  serverName: string;
  /** Carried so the agent catalog can tell a server holding the user's own data from a public one. */
  url: string;
  tools: McpTool[];
}

/**
 * A 404 to a request that carried a session id: the server no longer knows that session (it was
 * redeployed or swept idle sessions) and never ran the request. A 404 without one — a stateless
 * server, a URL that moved — is an ordinary failure, and so is everything else: a timeout or a
 * reset leaves open whether the call ran.
 */
function isSessionLost(rt: ServerRuntime, transport: Transport | null, err: unknown): boolean {
  return rt.kind === 'http'
    && err instanceof StreamableHTTPError && err.code === 404
    && transport instanceof StreamableHTTPClientTransport && Boolean(transport.sessionId);
}

/**
 * A call refused because its server is not connected: nothing reached the server. Read by shape
 * (`notConnected`), like `McpCallNotSentError`, so callers need no runtime import of the registry.
 */
export class McpNotConnectedError extends Error {
  readonly notConnected = true;
}

function notConnectedError(serverId: string): Error {
  return new McpNotConnectedError(`MCP server "${serverId}" is not connected`);
}

/**
 * A call held back after its server's lost session was renewed: nothing reached the server. Callers
 * read `notSent` rather than the class, so they need no runtime import of the registry.
 */
export class McpCallNotSentError extends Error {
  readonly notSent = true;
}

/**
 * The pictures a built-in connector saved for the answer. Only a built-in's `_meta` is read: a
 * remote server could name any file on the computer, and a bot sends these as photos.
 */
function builtinPictures(result: CallToolResult): string[] {
  const files = result._meta?.[PICTURES_META_KEY];
  return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string' && file.length > 0) : [];
}

/**
 * A tool's answer as one text: its text parts joined, a placeholder for media, and the structured
 * result as JSON when there is no text at all. `builtin` lets a built-in connector's pictures through.
 */
export function flattenResult(result: CallToolResult, builtin = false): McpToolResult {
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
  const pictures = builtin && result.isError !== true ? builtinPictures(result) : [];
  return { text, isError: result.isError === true, ...(pictures.length > 0 ? { pictures } : {}) };
}

/**
 * A tool as Settings lists it. MCP's display name is `title`, with `annotations.title` from older
 * servers; `description` is a hint for the model and stays here.
 */
export function toolInfo(tool: McpTool): McpToolInfo {
  const title = (tool.title ?? tool.annotations?.title)?.trim();
  return title ? { name: tool.name, title } : { name: tool.name };
}

export class McpRegistry {
  private readonly runtimes = new Map<string, ServerRuntime>();
  /** Poll timers for built-ins waiting on the app they relay to. */
  private readonly watchers = new Map<string, ReturnType<typeof setInterval>>();
  /** The availability value the last failed attempt saw; the next attempt waits for a different one. */
  private readonly failedAvailability = new Map<string, string | null>();
  /** One session renewal per server at a time; calls that fail or arrive meanwhile share it. */
  private readonly renewing = new Map<string, Promise<void>>();
  /** The connection attempt in flight for each server. */
  private readonly attempts = new Map<string, Promise<McpServerView>>();

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
      tools: rt.tools.map(toolInfo),
      ...(this.wouldConnectOnUse(rt, record) ? { connectOnUse: true } : {}),
    };
  }

  private wouldConnectOnUse(rt: ServerRuntime, record = getAuthRecord(rt.config.id)): boolean {
    return connectsOnUse({
      status: rt.status,
      enabled: rt.config.enabled !== false,
      builtin: rt.kind === 'builtin',
      url: rt.config.url,
      hasTokens: Boolean(record?.tokens),
      hasManualToken: Boolean(record?.manualToken),
      hasClient: Boolean(record?.client),
    });
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

  /** One attempt per server at a time: a second caller (a use, a click, a renewal) shares the first. */
  private connect(id: string, interactive: boolean): Promise<McpServerView> {
    const pending = this.attempts.get(id);
    if (pending) return pending;
    const attempt = this.attemptConnect(id, interactive).finally(() => this.attempts.delete(id));
    this.attempts.set(id, attempt);
    return attempt;
  }

  private async attemptConnect(id: string, interactive: boolean): Promise<McpServerView> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error(MCP_UNKNOWN_SERVER);
    if (rt.status === 'connecting') return this.viewFor(rt);
    if (rt.kind === 'builtin') return this.connectBuiltin(rt);
    try {
      await assertPublicHttpUrl(rt.config.url);
    } catch (err) {
      rt.error = `${MCP_INVALID_URL_PREFIX}${errorText(err)}`;
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
        rt.error = errorText(err);
        this.setStatus(rt, 'error');
        this.deps.log(`[mcp] connect failed ${rt.config.name}: ${rt.error}`);
      }
      return this.viewFor(rt);
    }

    rt.interactive = interactive;
    rt.needsAuth = false;

    const callback = await startCallbackServer(this.deps.authPageText);
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
      rt.error = errorText(err);
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
      rt.error = MCP_UNKNOWN_BUILTIN;
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
      rt.error = errorText(err);
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

  /**
   * Connects, never interactively, the servers a use is about to reach that are not connected yet:
   * among `ids` (every server when undefined), those an agent run could be offered. `named` says
   * the user named them; servers nobody named leave out one the user disconnected this session and
   * one whose last attempt failed (every run would wait on it again). A use arriving while an
   * attempt runs joins it. `names` is empty when there is nothing to wait for; `settled` never
   * rejects, and what came of each attempt is read off the server's status afterwards.
   */
  connectForUse(ids: readonly string[] | undefined, named: boolean): { names: string[]; settled: Promise<void> } {
    const wanted = ids ? new Set(ids) : null;
    const targets = [...this.runtimes.values()].filter((rt) => {
      if (wanted && !wanted.has(rt.config.id)) return false;
      if (!named && (rt.status === 'error' || (rt.cuts > 0 && rt.status === 'disconnected'))) return false;
      // A sign-in the user is going through in the browser is theirs to finish, not a use's to wait on.
      if (rt.interactive) return false;
      return (rt.kind === 'builtin' || rt.config.agentEnabled !== false) && this.wouldConnectOnUse(rt);
    });
    const settled = Promise.all(targets.map(async (rt) => {
      if (rt.status !== 'connecting') this.deps.log(`[mcp] connecting ${rt.config.name} on use`);
      try {
        await this.connect(rt.config.id, false);
      } catch (err) {
        this.deps.log(`[mcp] connect on use failed ${rt.config.name}: ${errorText(err)}`);
      }
    })).then(() => undefined);
    return { names: targets.map((rt) => rt.config.name), settled };
  }

  /** Switches a built-in connector on or off. Its opt-in is a config flag, not a `config.mcpServers` entry. */
  async setBuiltinEnabled(id: string, enabled: boolean): Promise<McpServerActionResult> {
    const builtin = findBuiltinConnector(id);
    if (!builtin) return { ok: false, servers: this.listServers(), error: MCP_UNKNOWN_BUILTIN };
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
      rt.cuts += 1;
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
      if (parsed.protocol !== 'https:') throw new Error(MCP_URL_NEEDS_HTTPS);
    } catch (err) {
      return { ok: false, servers: this.listServers(), error: `${MCP_INVALID_URL_PREFIX}${errorText(err)}` };
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
        rt.cuts += 1;
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
   * Rebuilds the runtime table from `config.mcpServers` after the config was replaced wholesale
   * (a backup import). A server whose id and URL both survived keeps its runtime and connection;
   * only its config object is refreshed.
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
    if (index === -1) return { ok: false, servers: this.listServers(), error: MCP_SERVER_NOT_FOUND };
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

  /**
   * Opens a new session for a server that dropped the one `failed` holds. Never interactive, so a
   * run never opens a browser. Does nothing when `failed` is no longer the server's client: another
   * call already renewed it, or the user disconnected, removed or re-pointed the server.
   */
  private renewSession(id: string, failed: Client): Promise<void> {
    const pending = this.renewing.get(id);
    if (pending) return pending;
    const task = (async () => {
      const rt = this.runtimes.get(id);
      if (!rt || rt.client !== failed) return;
      const cuts = rt.cuts;
      this.deps.log(`[mcp] ${rt.config.name} dropped its session; reconnecting`);
      try {
        await this.connect(id, false);
      } catch (err) {
        this.deps.log(`[mcp] session renewal failed ${rt.config.name}: ${errorText(err)}`);
      } finally {
        // connect() swaps its new client in without closing the one it replaces.
        void failed.close().catch(() => {});
      }
      this.standDownIfOverruled(id, rt, cuts);
    })().finally(() => this.renewing.delete(id));
    this.renewing.set(id, task);
    return task;
  }

  /**
   * connect() installs what it opened whatever happened while it waited on the server. A renewal
   * runs with no one asking for it, so if the user removed, re-pointed or disconnected the server
   * meanwhile, the session it opened is closed and the user's choice stands.
   */
  private standDownIfOverruled(id: string, rt: ServerRuntime, cuts: number): void {
    if (this.runtimes.get(id) !== rt) {
      // Removed or replaced: nothing can reach this runtime any more, so its session would never close.
      void rt.client?.close().catch(() => {});
      rt.client = null;
      rt.transport = null;
      rt.tools = [];
      return;
    }
    if (rt.cuts === cuts) return;
    this.deps.log(`[mcp] ${rt.config.name} was disconnected while its session was renewed; leaving it disconnected`);
    this.disconnectServer(id);
  }

  /**
   * `replayable` marks a call that is safe to send twice (a read). When the server has dropped
   * its session, such a call is sent once more on a new one; any other call is not resent, since
   * whether a change should go out again is for the user to decide.
   */
  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    replayable = false,
  ): Promise<McpToolResult> {
    // A renewal in flight shows the server as 'connecting'; wait for it instead of failing on that.
    await this.renewing.get(serverId);
    const rt = this.runtimes.get(serverId);
    if (!rt?.client || rt.status !== 'connected') throw notConnectedError(serverId);
    const client = rt.client;
    const transport = rt.transport;
    const prepare = rt.kind === 'builtin' ? this.builtinRuntime(serverId)?.prepareCall : undefined;
    const verdict = prepare ? await prepare(name, args) : { args };
    if ('denied' in verdict) return { text: verdict.denied, isError: true };
    try {
      const result = await client.callTool({ name, arguments: verdict.args }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
      return flattenResult(result as CallToolResult, rt.kind === 'builtin');
    } catch (err) {
      if (signal?.aborted || !isSessionLost(rt, transport, err)) throw err;
    }

    await this.renewSession(serverId, client);
    const fresh = this.runtimes.get(serverId);
    if (!fresh?.client || fresh.status !== 'connected') throw notConnectedError(serverId);
    if (!replayable) {
      // Worded so the action gate does not read it as a final failure of this exact call.
      throw new McpCallNotSentError(`MCP server "${serverId}" had dropped its session and has been reconnected; this call was not sent. Send it again if it is still wanted.`);
    }
    const result = await fresh.client.callTool({ name, arguments: verdict.args }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
    return flattenResult(result as CallToolResult, fresh.kind === 'builtin');
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
  return { config: server, status: 'disconnected', tools: [], client: null, transport: null, interactive: false, needsAuth: false, kind: 'http', cuts: 0 };
}

function newBuiltinRuntime(server: McpServerConfig): ServerRuntime {
  return { config: server, status: 'disconnected', tools: [], client: null, transport: null, interactive: false, needsAuth: false, kind: 'builtin', cuts: 0 };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

let registry: McpRegistry | null = null;

export function initMcpRegistry(deps: McpRegistryDeps): McpRegistry {
  registry = new McpRegistry(deps);
  return registry;
}

export function getMcpRegistry(): McpRegistry | null {
  return registry;
}

/**
 * The plumbing every in-process connector shares: an MCP server that lists a fixed tool set and
 * answers each call with one JSON text block (a thrown error becomes an `isError` result the agent
 * can read), and a Client linked to it over InMemoryTransport (no network, no port).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { PICTURES_META_KEY } from './mcpTypes';

const SERVER_VERSION = '1.0.0';

/**
 * An in-process connector's server. It is the SDK's low-level `Server`, whose doc comment is marked
 * deprecated in favour of `McpServer` "for the high-level API", keeping `Server` for "advanced use
 * cases" — this is one: a fixed tool list with hand-written JSON Schemas and one lenient dispatch.
 * `McpServer` (SDK 1.32) installs its own tool handlers as soon as the tools capability is declared,
 * takes zod schemas, and parses every call's arguments with them before the handler runs: the
 * old names the connectors still accept (`x-also-named`, the rail aliases) would be stripped or
 * refused, and each lenient read (a limit sent as "5") would become an InvalidParams error. The
 * deprecated name is spelt only here; connectors use this alias.
 */
export type ToolServer = Server;

/** A dispatch result that also carries pictures for the answer; its `value` is what the model reads. */
export class ToolResultWithPictures {
  constructor(readonly value: unknown, readonly files: readonly string[]) {}
}

/**
 * A dispatch result with notes for the model, like a CLI's stderr next to its JSON stdout: paging
 * hints, how a name was resolved, what could not be read. The notes go in their own text block
 * BEFORE the JSON, so a long result cut short at the end still shows them; the JSON block itself
 * stays exactly what `value` serialises to.
 */
export class ToolResultWithNotes {
  constructor(readonly value: unknown, readonly notes: readonly string[]) {}
}

/** A thrown error whose JSON body carries more than `error` and `message` (e.g. `candidates`). */
export class ToolError extends Error {
  constructor(name: string, message: string, readonly extra: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = name;
  }
}

function notesBlock(notes: readonly string[]): CallToolResult['content'] {
  return notes.length > 0 ? [{ type: 'text', text: notes.join('\n') }] : [];
}

export interface ToolServerSpec {
  name: string;
  tools: Tool[];
  /**
   * Runs one tool call; what it returns is sent as JSON, what it throws as the call's error.
   * `signal` aborts when the caller cancels the call (the agent's Stop, the registry's timeout).
   */
  dispatch: (toolName: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export function createToolServer(spec: ToolServerSpec): ToolServer {
  const server = new Server({ name: spec.name, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: spec.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await spec.dispatch(req.params.name, args, extra.signal);
      if (result instanceof ToolResultWithPictures) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result.value) }],
          ...(result.files.length > 0 ? { _meta: { [PICTURES_META_KEY]: [...result.files] } } : {}),
        };
      }
      if (result instanceof ToolResultWithNotes) {
        return { content: [...notesBlock(result.notes), { type: 'text', text: JSON.stringify(result.value) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const body = {
        error: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
        ...(err instanceof ToolError ? err.extra : {}),
      };
      return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
    }
  });
  return server;
}

export interface InProcessConnection {
  client: Client;
  close: () => Promise<void>;
}

export async function connectInProcess(server: ToolServer, clientName: string, clientVersion: string): Promise<InProcessConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: clientVersion });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

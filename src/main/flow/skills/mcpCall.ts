/**
 * `mcp` — calls one tool of a connector with the arguments the user wrote in the editor. No model
 * picks the tool or its arguments, so the step can run on a schedule and give the same call every
 * time (the deterministic half of `/notion`-style commands).
 *
 * Who may make it change things: see `mcpStepRefusal`. A run never asks a question here — a
 * scheduled run has nobody at the desk — so the editor is where the user decides, and saving the
 * flow is the consent.
 */
import { clipLine } from '../../../shared/textBudget';
import {
  MCP_OUTPUT_MAX_CHARS,
  effectiveMcpAccess,
  interpolateMcpArguments,
  mcpStepRefusal,
  parseMcpArguments,
  storedMcpAccess,
  type McpArgumentsResult,
} from '../../../shared/mcpFlowStep';
import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { getMcpRegistry } from '../../mcp';
import {
  connectStepServer,
  findStepServer,
  liveTools,
  mcpToolAccess,
  needsSignIn,
  type McpStepRegistry,
} from '../../mcp/flowTools';
import { FlowUserError } from '../userError';
import { envelope } from './dataSources';

/** How much of a tool's error the step's message quotes. */
const ERROR_DETAIL_MAX = 300;

function argumentsError(result: Exclude<McpArgumentsResult, { ok: true }>): FlowUserError {
  return result.reason === 'notObject'
    ? new FlowUserError('flow.error.mcpArgsNotObject', {}, 'The arguments must be a JSON object, like {"query": "…"}')
    : new FlowUserError('flow.error.mcpArgsInvalid', {}, 'The arguments are not valid JSON');
}

/**
 * The step's arguments with the run's variables filled in, as JSON text. Called while the step's
 * config is resolved, so it sees the template rather than text that was already spliced into it.
 */
export function resolveMcpArguments(template: string, context: ReadonlyMap<string, string>): string {
  const result = interpolateMcpArguments(template, (name) => context.get(name) ?? '');
  if (!result.ok) throw argumentsError(result);
  return JSON.stringify(result.value);
}

function readsAsNotConnected(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && ('notConnected' in err || 'notSent' in err));
}

function clipOutput(text: string): { output: string; truncated: boolean } {
  if (text.length <= MCP_OUTPUT_MAX_CHARS) return { output: text, truncated: false };
  const note = t(getLangCache(), 'flow.skill.mcp.truncated', {
    shown: String(MCP_OUTPUT_MAX_CHARS),
    total: String(text.length),
  });
  return { output: `${text.slice(0, MCP_OUTPUT_MAX_CHARS)}\n\n${note}`, truncated: true };
}

export async function execMcp(
  config: Record<string, string>,
  signal?: AbortSignal,
  registry: McpStepRegistry | null = getMcpRegistry(),
): Promise<string> {
  const serverRef = (config.server ?? '').trim();
  const toolName = (config.tool ?? '').trim();
  if (!serverRef || !toolName) {
    throw new FlowUserError('flow.error.mcpNotPicked', {}, 'No connector or tool is picked on this step');
  }
  const found = registry ? findStepServer(registry.listServers(), serverRef) : undefined;
  if (!registry || !found) {
    throw new FlowUserError('flow.error.mcpServerMissing', { server: serverRef }, `Connector "${serverRef}" is not set up in Settings`);
  }
  const server = await connectStepServer(registry, found, signal);
  const name = server.name;
  if (server.status !== 'connected') {
    if (needsSignIn(server)) {
      throw new FlowUserError('flow.error.mcpSignIn', { server: name }, `${name} needs to be signed in again in Settings`);
    }
    throw new FlowUserError('flow.error.mcpNotConnected', { server: name }, `${name} could not be connected`);
  }

  const tool = liveTools(registry, server.id).find((entry) => entry.name === toolName);
  if (!tool) {
    throw new FlowUserError('flow.error.mcpToolMissing', { tool: toolName, server: name }, `${name} has no tool "${toolName}"`);
  }
  const parsed = parseMcpArguments(config.arguments ?? '');
  if (!parsed.ok) throw argumentsError(parsed);
  const args = parsed.value;

  const stored = storedMcpAccess(config.access);
  const live = mcpToolAccess(server.id, tool, args);
  const refusal = mcpStepRefusal(stored, live, config.__botRun === '1');
  if (refusal === 'botWrite') {
    sendLog(`🔒 [Flow] mcp: ${name} → ${toolName} (${live}) refused for a bot-started run`);
    throw new FlowUserError('flow.error.mcpBotWrite', { tool: toolName, server: name }, `A bot message cannot run ${toolName} on ${name}: it changes data`);
  }
  if (refusal === 'unconfirmedDelete') {
    sendLog(`🔒 [Flow] mcp: ${name} → ${toolName} deletes, but the step was saved as ${stored ?? 'unclassified'}`);
    throw new FlowUserError('flow.error.mcpDeleteUnconfirmed', { tool: toolName }, `${toolName} deletes data, which this step was not saved for`);
  }
  const access = effectiveMcpAccess(stored, live);
  sendLog(`🔌 [Flow] mcp: ${name} → ${toolName} (${access})`);

  let result: { text: string; isError: boolean };
  try {
    // Only a read is sent again after a renewed session; a change is the user's to resend.
    result = await registry.callTool(server.id, toolName, args, signal, access === 'read');
  } catch (err) {
    if (signal?.aborted || !readsAsNotConnected(err)) throw err;
    throw new FlowUserError('flow.error.mcpNotConnected', { server: name }, `${name} could not be connected`);
  }
  if (result.isError) {
    const detail = clipLine(result.text.replace(/\s+/g, ' ').trim(), ERROR_DETAIL_MAX);
    throw new FlowUserError('flow.error.mcpToolError', { tool: toolName, detail }, `${toolName} reported an error: ${detail}`);
  }
  const { output, truncated } = clipOutput(result.text);
  return envelope(output, { truncated: truncated ? '1' : '0' });
}

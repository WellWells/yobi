import type { McpRegistry } from '../../mcp';
import type { McpTool } from '../../mcp/mcpTypes';
import { FlowAbortError } from '../runtime';
import { maskSecrets } from './secretMask';
import { formatMcpObservation, isArgumentError, resolveMcpTool, schemaHint, validateMcpArguments } from './mcpTools';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import { resolveToolContract } from './contractRegistry';
import { decideAction, formatBlocked } from './actionGate';
import type { GoalIntent } from './actionGate';
import { actionId } from './evidenceLedger';
import type { ActionRecord, EvidenceLedger } from './evidenceLedger';
import { resultCheckLine, verificationLine } from './actionOutcome';
import { failedResult } from './toolContracts';
import type { Args, DescribedRow, InterpretedResult, ReadCaller, ToolContract, ToolRisk, VerificationResult } from './toolContracts';

export interface McpConfirmRequest {
  kind: 'mcp';
  serverId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  risk?: ToolRisk;
  rows?: DescribedRow[];
  /** Sending and deleting are asked every time, whatever "always allow" says. */
  forceAsk?: boolean;
}

export type McpStage = 'verifying';

export interface McpStepContext {
  index: McpRuntimeIndex;
  registry: McpRegistry;
  ledger: EvidenceLedger;
  runId: string;
  intent: GoalIntent | null;
  gate: { blocked: number; autoContext: number };
  /** No one can review a window this run opens, so nothing that changes things skips confirmation. */
  unattended?: boolean;
  confirm: (request: McpConfirmRequest) => Promise<boolean>;
  onStage?: (stage: McpStage) => void;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export interface McpStepResult {
  observation: string;
  status: 'ok' | 'error';
  write: boolean;
  /** A change that happened and was not contradicted by its own check. */
  landed: boolean;
  /** Held back only until something is looked at — the identical call may pass afterwards. */
  transientBlock: boolean;
  record?: ActionRecord;
}

const MAX_AUTO_CONTEXT = 2;
const ARG_CLIP = 2_000;

function clipArgs(args: Args): Args {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    typeof value === 'string' && value.length > ARG_CLIP ? `${value.slice(0, ARG_CLIP)}…` : value,
  ]));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function contractOf(ctx: McpStepContext, serverId: string, name: string): { tool: McpTool; contract: ToolContract } | null {
  const tool = ctx.index.handles.find((handle) => handle.serverId === serverId)?.tools.find((entry) => entry.name === name);
  return tool ? { tool, contract: resolveToolContract(serverId, tool) } : null;
}

/** Lookups a contract makes on its own. Anything that is not a read is refused, not attempted. */
function readerFor(ctx: McpStepContext, serverId: string): ReadCaller {
  return async (name, args) => {
    const found = contractOf(ctx, serverId, name);
    if (!found) return { text: `unknown tool ${name}`, isError: true };
    if (found.contract.risk(args) !== 'read') return { text: `refused: ${name} is not a read`, isError: true };
    try {
      const result = await ctx.registry.callTool(serverId, name, args, ctx.signal);
      if (!result.isError) {
        ctx.ledger.add(found.contract.extractFacts?.(args, result.text) ?? []);
        ctx.ledger.addObservation(result.text);
      }
      return { text: result.text, isError: result.isError };
    } catch (err) {
      if (err instanceof FlowAbortError) throw err;
      return { text: errorText(err), isError: true };
    }
  };
}

function observationOf(text: string, isError: boolean, interpreted: InterpretedResult, tool: McpTool): string {
  const failed = interpreted.outcome === 'failed';
  // Not a local source: a connector answers with opaque handles the model must pass straight back,
  // and the entropy pass read a Gmail Message-ID as a secret, so every Thunderbird message operation
  // was sent `[REDACTED SECRET]@mx.google.com`. Known prefixes and named credentials are still masked.
  const base = maskSecrets(formatMcpObservation({ text, isError }), false);
  // A server that rejects the arguments reports it rather than throwing, so the schema rides along
  // here — otherwise the model spends a whole turn on `tool_help` to learn names it was just told.
  const shown = failed && !isError ? `ERROR: ${base}` : base;
  return failed && isArgumentError(shown) ? `${shown}${schemaHint(tool)}` : shown;
}

async function runRead(ctx: McpStepContext, serverId: string, tool: McpTool, contract: ToolContract, args: Args): Promise<McpStepResult> {
  try {
    const result = await ctx.registry.callTool(serverId, tool.name, args, ctx.signal);
    const interpreted = contract.interpret(result.text, result.isError, args, ctx.ledger);
    const failed = interpreted.outcome === 'failed';
    if (!failed) {
      ctx.ledger.add(contract.extractFacts?.(args, result.text) ?? []);
      // The arguments go in too: an id a read accepted is an id the server itself vouched for.
      ctx.ledger.addObservation(`${JSON.stringify(args)}\n${result.text}`);
    }
    return { observation: observationOf(result.text, result.isError, interpreted, tool), status: failed ? 'error' : 'ok', write: false, landed: false, transientBlock: false };
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    return { observation: `ERROR: ${errorText(err)}${schemaHint(tool)}`, status: 'error', write: false, landed: false, transientBlock: false };
  }
}

async function recheckPrior(ctx: McpStepContext, prior: ActionRecord): Promise<string[]> {
  ctx.ledger.checked.add(actionId(prior));
  const found = contractOf(ctx, prior.serverId, prior.tool);
  if (prior.outcome !== 'claimed' || !found?.contract.verify) return [];
  ctx.onStage?.('verifying');
  let result: VerificationResult;
  try {
    result = await found.contract.verify(prior.args, prior.at, ctx.ledger, readerFor(ctx, prior.serverId));
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    result = { status: 'unavailable', evidence: errorText(err) };
  }
  prior.verification = result;
  return [`PRIOR ACTION CHECK: ${verificationLine(result)}`];
}

export async function executeMcpProposal(
  ctx: McpStepContext,
  action: McpAction,
  step: number,
  signature: string,
): Promise<McpStepResult> {
  const resolved = resolveMcpTool(ctx.index, action.server, action.name);
  if (!resolved) {
    return { observation: `ERROR: Unknown MCP tool ${action.server}/${action.name}`, status: 'error', write: false, landed: false, transientBlock: false };
  }
  const { serverId, tool } = resolved;
  const args = action.arguments;
  const contract = resolveToolContract(serverId, tool);
  const risk = contract.risk(args);
  const write = risk !== 'read';

  const argCheck = validateMcpArguments(tool, args);
  if (!argCheck.ok) {
    return { observation: `ERROR: ${argCheck.error}${schemaHint(tool)}`, status: 'error', write, landed: false, transientBlock: false };
  }
  if (!write) return runRead(ctx, serverId, tool, contract, args);

  const read = readerFor(ctx, serverId);
  const decide = () => decideAction({
    serverId, tool, args, contract, ledger: ctx.ledger, intent: ctx.intent, blockedSoFar: ctx.gate.blocked, signature,
  });
  let decision = decide();
  while (decision.verdict === 'needs' && ctx.gate.autoContext < MAX_AUTO_CONTEXT) {
    ctx.gate.autoContext += 1;
    for (const need of decision.needs) await read(need.tool, need.args);
    decision = decide();
  }

  const base: ActionRecord = {
    runId: ctx.runId,
    step,
    serverId,
    server: action.server,
    tool: tool.name,
    args: clipArgs(args),
    risk,
    targetKey: contract.targetKey?.(args) ?? null,
    signature,
    label: contract.label?.(args, ctx.ledger) ?? tool.name,
    at: new Date().toISOString(),
    verdict: 'ready',
  };

  if (decision.verdict !== 'ready') {
    const reasons = decision.verdict === 'blocked'
      ? decision.reasons
      : [{ code: 'context_unavailable', message: 'What this call depends on could not be looked up. Look it up with a (read) tool first.' }];
    const extra = decision.verdict === 'blocked' && decision.recheck ? await recheckPrior(ctx, decision.recheck) : [];
    ctx.gate.blocked += 1;
    const record: ActionRecord = { ...base, verdict: 'blocked', reasons: reasons.map(({ code, message }) => ({ code, message })) };
    ctx.ledger.actions.push(record);
    ctx.log(`🚧 [Agent] held back mcp:${tool.name} — ${reasons.map((reason) => reason.code).join(', ')}`);
    return {
      observation: formatBlocked(reasons, extra),
      status: 'error',
      write: true,
      landed: false,
      transientBlock: decision.verdict === 'blocked' && decision.transient,
      record,
    };
  }

  const declared = contract.confirm(args);
  const policy = declared === 'never' && ctx.unattended ? 'ask' : declared;
  let confirmed: ActionRecord['confirmed'] = 'auto';
  if (policy !== 'never') {
    const serverName = ctx.index.byHandle.get(action.server)?.serverName ?? action.server;
    const approved = await ctx.confirm({
      kind: 'mcp', serverId, serverName, toolName: tool.name, args, risk,
      rows: contract.describe?.(args, ctx.ledger) ?? [],
      forceAsk: policy === 'always',
    });
    confirmed = approved ? 'approved' : 'denied';
  }
  if (confirmed === 'denied') {
    const record: ActionRecord = { ...base, confirmed };
    ctx.ledger.actions.push(record);
    return {
      observation: 'ERROR: The user declined this write operation. Do not retry it — take a different approach or finish.',
      status: 'error', write: true, landed: false, transientBlock: false, record,
    };
  }

  let text: string;
  let isError: boolean;
  try {
    const result = await ctx.registry.callTool(serverId, tool.name, args, ctx.signal);
    text = result.text;
    isError = result.isError;
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    text = errorText(err);
    isError = true;
  }
  const interpreted = isError && !text ? failedResult('the call failed', tool.name) : contract.interpret(text, isError, args, ctx.ledger);
  const record: ActionRecord = {
    ...base,
    confirmed,
    outcome: interpreted.outcome,
    ...(interpreted.failure ? { failure: interpreted.failure } : {}),
    summary: interpreted.summary,
    ...(interpreted.notice ? { notice: interpreted.notice } : {}),
  };
  const lines = [observationOf(text, isError, interpreted, tool), resultCheckLine(interpreted)];
  if (interpreted.outcome === 'claimed' && contract.verify) {
    ctx.onStage?.('verifying');
    try {
      record.verification = await contract.verify(args, base.at, ctx.ledger, read);
    } catch (err) {
      if (err instanceof FlowAbortError) throw err;
      record.verification = { status: 'unavailable', evidence: errorText(err) };
    }
    lines.push(verificationLine(record.verification));
  }
  ctx.ledger.actions.push(record);
  const failed = interpreted.outcome === 'failed';
  return {
    observation: lines.filter(Boolean).join('\n'),
    status: failed ? 'error' : 'ok',
    write: true,
    landed: !failed && record.verification?.status !== 'not_found',
    transientBlock: false,
    record,
  };
}

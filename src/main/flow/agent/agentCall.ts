import type { AgentTraceEvent, SkillType } from '../../../shared/types';
import type { FlowExecutorDeps } from '../types';
import { executeSkill } from '../skills';
import { unwrapStepOutput } from '../executor';
import { FlowAbortError, resolveStepTimeoutMs, withStepTimeout } from '../runtime';
import { sendLog } from '../../helpers';
import type { McpRegistry } from '../../mcp';
import { denyReasonForFileTool } from './agentSandbox';
import { sensitiveCommandReason } from './sensitivePaths';
import { isElevated } from './elevation';
import { maskSecrets } from './secretMask';
import { isBuiltinTool, runBuiltinTool } from './agentBuiltins';
import type { AgentBuiltinTool, BuiltinDeps, FlowWriteConfirmRequest } from './agentBuiltins';
import { executeMcpProposal } from './mcpAction';
import type { McpConfirmRequest } from './mcpAction';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import type { AgentAction } from './agentTools';
import type { EvidenceLedger } from './evidenceLedger';
import type { GoalIntent } from './actionGate';

export interface ShellConfirmRequest {
  kind: 'shell';
  command: string;
  /** The interpreter the command will be handed to, resolved the way `execShell` resolves it. */
  interpreter: string;
  cwd: string;
}

export type AgentConfirmRequest = McpConfirmRequest | FlowWriteConfirmRequest | ShellConfirmRequest;

/**
 * Tools whose every call is put to the user first. Only `shell` is here: it is the one agent tool
 * whose blast radius is not bounded by the workspace sandbox, so a confirmation is the boundary.
 * `file_write` is not — `denyReasonForFileTool` confines it to the same four folders `file_read`
 * may read, which is a bound the user does not have to re-affirm on every call.
 */
const CONFIRM_REQUIRED_TOOLS = new Set<SkillType>(['shell']);

/**
 * Tools that change something outside this run, so `writesAllFailed` can tell the model to stop
 * claiming success. Counted the same fail-closed way `classifyMcpTool` counts an MCP write: a
 * shell command is assumed to have changed something, because nobody can tell from the outside.
 */
const WRITE_TOOLS = new Set<SkillType>(['shell', 'file_write']);

// Which observations get the HIGH-ENTROPY redactor on top of the eight prefix patterns. `shell`
// belongs here for the obvious reason: `set`, `printenv`, `git config --list` and `type .env` are
// exactly how a model answers a configuration question, and the answer is posted to a
// third-party web UI. Pinned by test/secretMask.test.ts — the omission fails silently otherwise.
const LOCAL_SOURCE_TOOLS = new Set<SkillType>(['file_read', 'clipboard', 'sysinfo', 'shell']);

const AGENT_STEP_ID = 'agent';

/**
 * Why this shell call is refused outright, before the user is ever asked, or null.
 *
 * Refusing BEFORE the dialog rather than inside it is deliberate. A dialog the user is trained to
 * click through is worse than no dialog, and a command reaching for a credential store must not be
 * presented as a routine choice alongside `git status`.
 *
 * Both checks are honest about their reach. The elevation check is EXACT — a child inherits the
 * parent token, so if this process is elevated every command would be too. The command scan is
 * best-effort: `%USERPROFILE%\.claude` contains no path until cmd.exe expands it, and a name can
 * be assembled at run time, so a rename or a variable defeats it. It stops the accidental and the
 * naive, which is the case that actually occurred; `secretMask` is what has to stop the rest.
 */
async function shellDenyReason(config: Record<string, string>): Promise<string | null> {
  if (await isElevated()) {
    return 'refused: this app is running with administrator rights, and a command started from here would inherit them. The agent will not run shell commands as administrator. Do not retry it — tell the user to restart the app normally if they want you to run commands.';
  }
  return sensitiveCommandReason(config.command ?? '');
}

function shellInterpreter(config: Record<string, string>): string {
  if (process.platform === 'win32') {
    return (config.shell ?? 'cmd').toLowerCase() === 'powershell' ? 'powershell.exe' : 'cmd.exe';
  }
  const selected = (config.shell ?? '').trim();
  if (selected && selected !== 'auto') return selected;
  return process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

async function runTool(
  tool: SkillType,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  budgetRemainingMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const timeoutMs = Math.max(10_000, Math.min(resolveStepTimeoutMs(tool, deps, config), budgetRemainingMs));
  // `withStepTimeout` deliberately does NOT cancel the work it gives up on, so a skill that can
  // honour an AbortSignal has to be handed it directly. `shell` joins `llm` here because Stop
  // has to reach a running command — it still only kills the direct child, so a command that
  // detaches (`start /b`, `Start-Process`, `schtasks`) outlives it either way.
  if (tool === 'llm' || tool === 'shell') {
    return executeSkill(tool, AGENT_STEP_ID, config, deps, timeoutMs, signal);
  }
  return withStepTimeout(
    executeSkill(tool, AGENT_STEP_ID, config, deps, timeoutMs),
    timeoutMs,
    tool,
    undefined,
    signal,
  );
}

function buildObservation(output: string, subVars: Record<string, string>): string {
  const extras = Object.entries(subVars)
    .filter(([key, value]) => value && value !== output && key !== 'isFailed' && key !== 'transcript')
    .map(([key, value]) => `${key}=${value.length > 200 ? `${value.slice(0, 200)}…` : value}`);
  return extras.length > 0 ? `${output}\n[fields] ${extras.join('; ')}` : output;
}

/** Everything one tool call needs from the run around it, and nothing it may change. */
export interface CallContext {
  deps: FlowExecutorDeps;
  mcpIndex: McpRuntimeIndex;
  mcpRegistry: McpRegistry | null;
  ledger: EvidenceLedger;
  runId: string;
  /** Read when the call starts: a resumed run may restate the intent on its first action. */
  intent: () => GoalIntent | null;
  gate: { blocked: number; autoContext: number };
  unattended: boolean;
  askUser: (request: AgentConfirmRequest) => Promise<boolean>;
  /** Shared by every call of the run: `build_flow` reads the assessment `assess_flow` left there. */
  builtins: BuiltinDeps;
  fileRoots: string[];
  /** Resolved once per run: where a shell command runs and what its confirmation shows. */
  workspaceDir: string;
  remainingMs: () => number;
  onTrace?: (event: AgentTraceEvent) => void;
  signal?: AbortSignal;
}

export interface CallOutcome {
  observation: string;
  status: 'ok' | 'error';
  /** The call was a change (attempted, whether or not it ran). */
  write: boolean;
  /** A change that happened. */
  landed: boolean;
  /** Held back only until something is looked at — the identical call may pass afterwards. */
  transientBlock: boolean;
}

function outcome(observation: string, status: 'ok' | 'error', write = false, landed = false): CallOutcome {
  return { observation, status, write, landed, transientBlock: false };
}

/**
 * Runs one validated call: a connector tool through the action gate, a flow builder or `delegate`,
 * or a built-in skill inside its sandbox. `step` is the scratch step the result will be filed under,
 * which is also the trace row its stages land on.
 */
export async function runCall(
  ctx: CallContext,
  action: AgentAction | McpAction,
  recordConfig: Record<string, string>,
  step: number,
  signature: string,
): Promise<CallOutcome> {
  const stage = (label: Parameters<NonNullable<BuiltinDeps['onStage']>>[0], detail?: string): void =>
    ctx.onTrace?.({ kind: 'stage', turn: step, label, ...(detail ? { detail } : {}) });

  if (action.action === 'call_mcp') {
    const result = await executeMcpProposal({
      index: ctx.mcpIndex,
      registry: ctx.mcpRegistry!,
      ledger: ctx.ledger,
      runId: ctx.runId,
      intent: ctx.intent(),
      gate: ctx.gate,
      unattended: ctx.unattended,
      confirm: (request: McpConfirmRequest) => ctx.askUser(request),
      onStage: (label) => stage(label),
      log: sendLog,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    }, action, step, signature);
    if (result.status === 'error') sendLog(`⚠️ [Agent] mcp:${action.name}: ${result.observation.slice(0, 160)}`);
    return {
      observation: result.observation,
      status: result.status,
      write: result.write,
      landed: result.write && result.landed,
      transientBlock: result.transientBlock,
    };
  }

  const toolName = action.tool ?? '';
  if (isBuiltinTool(toolName)) {
    const result = await runBuiltinTool(toolName as AgentBuiltinTool, recordConfig, ctx.builtins, step);
    if (result.status === 'error') sendLog(`⚠️ [Agent] ${toolName}: ${result.observation.slice(0, 160)}`);
    return outcome(result.observation, result.status);
  }

  const tool = toolName as SkillType;
  // Counted before the call, and counted even when it is refused. `writesAllFailed` is what
  // stops a run whose only side effect never happened from reporting it as done, and a
  // refusal is exactly the case where the user has only the agent's word for it.
  const isWrite = WRITE_TOOLS.has(tool);
  const denyReason = tool === 'shell'
    ? await shellDenyReason(recordConfig)
    : await denyReasonForFileTool(tool, recordConfig, ctx.fileRoots);
  if (denyReason) {
    sendLog(`🔒 [Agent] blocked ${tool}: ${denyReason}`);
    return outcome(`ERROR: ${denyReason}`, 'error', isWrite);
  }
  if (CONFIRM_REQUIRED_TOOLS.has(tool)) {
    const approved = await ctx.askUser({
      kind: 'shell',
      command: recordConfig.command ?? '',
      interpreter: shellInterpreter(recordConfig),
      cwd: ctx.workspaceDir,
    });
    if (!approved) {
      sendLog(`🔒 [Agent] the user declined a ${tool} call`);
      return outcome('ERROR: The user declined to run this command. Do not retry it or a variation of it — take a different approach, or finish and tell them what you needed to run.', 'error', isWrite);
    }
  }
  // `cwd` is injected HERE, after validation dropped any the model tried to set, so a bare `dir`
  // or a `> out.txt` lands in the workspace instead of wherever Electron was started — and neither
  // key can be chosen by the model, only inherited. `noClobber` makes the "no confirmation needed"
  // decision honest: without it, one action could replace the user's existing
  // `Documents/taxes-2025.xlsx` with the agent's notes and nothing would ask.
  const execConfig = tool === 'shell'
    ? { ...recordConfig, cwd: ctx.workspaceDir }
    : tool === 'file_write'
      ? { ...recordConfig, noClobber: 'true' }
      : recordConfig;
  const stageDeps: FlowExecutorDeps = ctx.onTrace
    ? { ...ctx.deps, onStage: (label, detail) => stage(label, detail) }
    : ctx.deps;
  try {
    const raw = await runTool(tool, execConfig, stageDeps, ctx.remainingMs(), ctx.signal);
    const unwrapped = unwrapStepOutput(tool, raw);
    const observation = maskSecrets(buildObservation(unwrapped.output, unwrapped.subVars), LOCAL_SOURCE_TOOLS.has(tool));
    ctx.ledger.addObservation(observation);
    return outcome(observation, 'ok', isWrite, isWrite);
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Masked like the success branch. `promisify(exec)` rejects on ANY non-zero exit with
    // `Command failed: <the whole command>` plus stderr — so the one path that carried the
    // command line AND its stderr verbatim into the next prompt, the run file and the log
    // was the path that had no redaction at all. A grep that matches nothing reaches it.
    sendLog(`⚠️ [Agent] ${tool} failed: ${maskSecrets(message, true)}`);
    return outcome(`ERROR: ${maskSecrets(message, LOCAL_SOURCE_TOOLS.has(tool))}`, 'error', isWrite);
  }
}

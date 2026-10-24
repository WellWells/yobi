import type { AgentTraceEvent, SkillType } from '../../../shared/types';
import type { ResearchProgress } from '../../../shared/researchProgress';
import type { FlowExecutorDeps } from '../types';
import { executeSkill } from '../skills';
import { unwrapStepOutput } from '../executor';
import { FlowAbortError, resolveStepTimeoutMs, withStepTimeout } from '../runtime';
import { sendLog } from '../../helpers';
import { SearchBlockedError } from '../../search/blocked';
import type { McpRegistry } from '../../mcp';
import { denyReasonForFileTool } from './agentSandbox';
import { sensitiveCommandReason } from './sensitivePaths';
import { isElevated } from './elevation';
import { maskSecrets } from './secretMask';
import { isBuiltinTool, runBuiltinTool } from './agentBuiltins';
import type { AgentBuiltinTool, BuiltinDeps, FlowSaveRequest, FlowWriteConfirmRequest } from './agentBuiltins';
import { executeMcpProposal } from './mcpAction';
import type { McpConfirmRequest } from './mcpAction';
import type { McpAction, McpRuntimeIndex } from './mcpTools';
import type { AgentAction } from './agentTools';
import type { EvidenceLedger } from './evidenceLedger';
import type { GoalIntent } from './actionGate';
import { chatQuestionRefusal, shellTextDenyReason } from './shellApproval';
import type { ShellApprovalText } from './shellApproval';

export interface ShellConfirmRequest {
  kind: 'shell';
  command: string;
  /** The interpreter the command will be handed to, resolved the way `execShell` resolves it. */
  interpreter: string;
  cwd: string;
}

export type AgentConfirmRequest = McpConfirmRequest | FlowWriteConfirmRequest | ShellConfirmRequest;

/**
 * Tools confirmed on every call. Only `shell`: the workspace sandbox does not bound it, whereas
 * `file_write` is confined by `denyReasonForFileTool`.
 */
const CONFIRM_REQUIRED_TOOLS = new Set<SkillType>(['shell']);

/**
 * Tools that change something outside this run, so `writesAllFailed` can tell the model to stop
 * claiming success. Counted the same fail-closed way `genericRisk` counts an MCP write: a
 * shell command is assumed to have changed something, because nobody can tell from the outside.
 */
const WRITE_TOOLS = new Set<SkillType>(['shell', 'file_write']);

// Tools whose observations also get the high-entropy redactor. `shell` is here because `set`,
// `printenv` and `type .env` are how a model answers config questions, and the output goes to a
// third-party web UI.
const LOCAL_SOURCE_TOOLS = new Set<SkillType>(['file_read', 'clipboard', 'sysinfo', 'shell']);

const AGENT_STEP_ID = 'agent';

/**
 * Why this shell call is refused before the user is asked, or null. The elevation check is exact
 * (a child inherits the parent token); the command scan is best-effort (env vars or renames defeat
 * it), so `secretMask` remains the backstop.
 */
async function shellDenyReason(config: Record<string, string>): Promise<string | null> {
  const textReason = shellTextDenyReason(config, process.platform);
  if (textReason) return textReason;
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
  // `withStepTimeout` does not cancel abandoned work, so skills that honour an AbortSignal get it
  // directly. For `shell` this kills only the direct child; detached processes (`start /b`,
  // `Start-Process`) survive.
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
  /** The user's answers to this run's questions, which may allow what the intent did not. */
  askAnswers: readonly string[];
  gate: { blocked: number; autoContext: number };
  unattended: boolean;
  askUser: (request: AgentConfirmRequest) => Promise<boolean>;
  /**
   * A shell call is not confirmed here but handed back as `deferred`: the run pauses with this
   * question in the chat and runs the stored command when the answer approves it (a bot run).
   */
  deferShell?: (request: ShellConfirmRequest) => ShellApprovalText;
  /** Likewise for a connector change that needs confirming (the owner's own bot chat). */
  deferChanges?: boolean;
  /** Shared by every call of the run: `build_flow` reads the assessment `assess_flow` left there. */
  builtins: BuiltinDeps;
  fileRoots: string[];
  /** Resolved once per run: where a shell command runs and what its confirmation shows. */
  workspaceDir: string;
  remainingMs: () => number;
  /** Keeps pictures a built-in connector saved (the metro map) for the answer. */
  keepPictures?: (files: readonly string[]) => Promise<void>;
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
  /** A research call's checklist as it ended, kept on the record so a reopened run shows it. */
  research?: ResearchProgress;
  /** Nothing ran: this shell command, change or held flow waits for the user's answer to a question. */
  deferred?: ShellConfirmRequest | McpConfirmRequest | FlowSaveRequest;
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
      answers: ctx.askAnswers,
      gate: ctx.gate,
      unattended: ctx.unattended,
      confirm: (request: McpConfirmRequest) => ctx.askUser(request),
      ...(ctx.deferChanges ? { deferChanges: true } : {}),
      onStage: (label) => stage(label),
      ...(ctx.keepPictures ? { keepPictures: ctx.keepPictures } : {}),
      log: sendLog,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    }, action, step, signature);
    if (result.deferred) return { ...outcome('', 'ok'), deferred: result.deferred };
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
    if (result.deferred) return { ...outcome('', 'ok'), deferred: result.deferred };
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
    const request: ShellConfirmRequest = {
      kind: 'shell',
      command: recordConfig.command ?? '',
      interpreter: shellInterpreter(recordConfig),
      cwd: ctx.workspaceDir,
    };
    if (ctx.deferShell) {
      // Refused here, not after the user said yes: a command that is never going to run must not
      // be put to them, and a question the chat cannot show whole must not be asked.
      const tooLong = chatQuestionRefusal(request.command, ctx.deferShell(request));
      if (tooLong) {
        sendLog(`🔒 [Agent] shell: refused a ${request.command.length}-character command — the chat question could not show it whole`);
        return outcome(`ERROR: ${tooLong}`, 'error', isWrite);
      }
      return { ...outcome('', 'ok'), deferred: request };
    }
    const approved = await ctx.askUser(request);
    if (!approved) {
      sendLog(`🔒 [Agent] the user declined a ${tool} call`);
      return outcome('ERROR: The user declined to run this command. Do not retry it or a variation of it — take a different approach, or finish and tell them what you needed to run.', 'error', isWrite);
    }
  }
  // Injected after validation so the model cannot set them: shell runs in the workspace, and
  // `noClobber` keeps an unconfirmed file_write from replacing an existing user file.
  // On macOS/Linux the shell is the interpreter the confirmation showed, resolved once, not re-read.
  const execConfig = tool === 'shell'
    ? { ...recordConfig, ...(process.platform === 'win32' ? {} : { shell: shellInterpreter(recordConfig) }), cwd: ctx.workspaceDir }
    : tool === 'file_write'
      ? { ...recordConfig, noClobber: 'true' }
      : recordConfig;
  let research: ResearchProgress | undefined;
  const progressDeps: FlowExecutorDeps = {
    ...ctx.deps,
    onResearchProgress: (progress) => {
      research = progress;
      ctx.onTrace?.({ kind: 'research', turn: step, progress });
    },
  };
  const withResearch = (result: CallOutcome): CallOutcome => (research ? { ...result, research } : result);
  try {
    const raw = await runTool(tool, execConfig, progressDeps, ctx.remainingMs(), ctx.signal);
    const unwrapped = unwrapStepOutput(tool, raw);
    const observation = maskSecrets(buildObservation(unwrapped.output, unwrapped.subVars), LOCAL_SOURCE_TOOLS.has(tool));
    ctx.ledger.addObservation(observation);
    return withResearch(outcome(observation, 'ok', isWrite, isWrite));
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    // The user-facing "try again in a few minutes" reads to a model as "retry now", so it gets
    // its own observation.
    if (err instanceof SearchBlockedError) {
      sendLog(`⚠️ [Agent] ${tool} failed: web search is blocked (${err.message})`);
      return withResearch(outcome(`ERROR: ${err.agentObservation}`, 'error', isWrite));
    }
    const message = err instanceof Error ? err.message : String(err);
    // Masked like the success branch: on any non-zero exit `promisify(exec)` rejects with the
    // whole command line plus stderr.
    sendLog(`⚠️ [Agent] ${tool} failed: ${maskSecrets(message, true)}`);
    return withResearch(outcome(`ERROR: ${maskSecrets(message, LOCAL_SOURCE_TOOLS.has(tool))}`, 'error', isWrite));
  }
}

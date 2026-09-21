import type {
  AgentStageLabel, FlowAssessment, FlowBuildEvent, FlowBuildIssue, FlowBuildPhase,
  FlowDefinition, SkillType, TriggerType,
} from '../../../shared/types';
import { assessFlowSupport } from '../flowGenerator';
import { BUILD_DECLINED, runFlowBuild } from '../flowBuild';
import { FlowAbortError } from '../runtime';
import { sendLog } from '../../helpers';
import type { FlowExecutorDeps } from '../types';

export const AGENT_BUILTIN_TOOLS = ['assess_flow', 'build_flow', 'delegate'] as const;

export type AgentBuiltinTool = typeof AGENT_BUILTIN_TOOLS[number];

const BUILTIN_SET = new Set<string>(AGENT_BUILTIN_TOOLS);

export function isBuiltinTool(name: string): name is AgentBuiltinTool {
  return BUILTIN_SET.has(name);
}

const SENSITIVE_STEP_TYPES = new Set<string>([
  'shell', 'run', 'js', 'browser_js', 'power', 'restart_app', 'file_delete',
]);

export interface FlowWriteConfirmRequest {
  kind: 'flow';
  flowName: string;
  stepTypes: string[];
  sensitiveTypes: string[];
}

export interface BuiltinDeps {
  deps: FlowExecutorDeps;
  providerUrl: string;
  saveFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  confirm?: (request: FlowWriteConfirmRequest) => Promise<boolean>;
  /**
   * The whole assessment, not a digest of it: `build_flow` reuses the skills and trigger to skip
   * a second assessment, and the gate below needs the questions it raised.
   */
  assessed: FlowAssessment | null;
  remainingMs?: () => number;
  signal?: AbortSignal;
  /** Puts the build's phase on the trace row the way `research` puts its own sub-stages there. */
  onStage?: (label: AgentStageLabel, detail?: string) => void;
  /** The same event stream the Flow Builder panel renders, keyed by the run id. */
  onBuild?: (event: FlowBuildEvent) => void;
  /**
   * Runs a read-only helper agent on a self-contained task. Injected by the engine rather than
   * imported, because the helper IS the engine and importing it here would be a cycle. `step` is
   * the call's own trace row: helpers in one batch run side by side and each reports on its own.
   */
  runSubtask?: (task: string, step: number) => Promise<BuiltinOutcome>;
}

const MIN_BUILTIN_TIMEOUT_MS = 30_000;

function budgetedDeps(ctx: BuiltinDeps): FlowExecutorDeps {
  if (!ctx.remainingMs) return ctx.deps;
  const base = ctx.deps.getResponseTimeoutMs?.();
  const remaining = ctx.remainingMs();
  const ceiling = base === undefined ? remaining : Math.min(base, remaining);
  return { ...ctx.deps, getResponseTimeoutMs: () => Math.max(MIN_BUILTIN_TIMEOUT_MS, ceiling) };
}

/**
 * Framed as the rung above `research`, not as an overflow valve: framed as the valve it was never
 * called once in ten days of logs, while comparisons crawled one page per turn. It still costs a
 * whole helper loop, so a sub-question one `research` call answers must not come here.
 */
const DELEGATE_LINE = '- "delegate": Hand a READ-ONLY sub-question that needs SEVERAL steps of its own (find, then read pages or messages) to a helper with a fresh context. Use it when one "research" call cannot answer it; send several at once in "call_tools". It never changes anything or asks the user. config keys: "task" (self-contained: what to find and what to report back, since it cannot see this conversation; REQUIRED) → returns: the helper\'s written findings.';

export function buildBuiltinCatalog(includeDelegate = false): string {
  return [
    '- "assess_flow": Check whether Yobi could AUTOMATE something as a saved flow, and how. Read-only — nothing is created. config keys: "goal" (what the user wants automated, in their own words; REQUIRED) → returns: a coverage verdict, a step outline, the gaps, and anything it would have to invent a value for.',
    '- "build_flow": Build and SAVE the flow. Call "assess_flow" first and say what it found — it writes to their app and asks them to approve it, so never the opening move. Anything the assessment reported missing, ask the user for first; never invent it. Saved DISABLED for them to review and switch on. config keys: "goal" (the same request, refined by anything the user said since; REQUIRED) → returns: the flow\'s name, its steps, and what still needs checking.',
    ...(includeDelegate ? [DELEGATE_LINE] : []),
  ].join('\n');
}

export function builtinRequiredFields(tool: AgentBuiltinTool): string[] {
  if (tool === 'delegate') return ['task'];
  return tool === 'assess_flow' || tool === 'build_flow' ? ['goal'] : [];
}

const ASSESS_OBSERVATION_LIMIT = 1_500;

const VERDICT_TEXT: Record<FlowAssessment['verdict'], string> = {
  full: 'Yobi can automate all of this.',
  partial: 'Yobi can automate part of this.',
  none: 'Yobi has no skill that can do this.',
};

const TRIGGER_TEXT: Record<TriggerType, string> = {
  cron: 'It runs on a schedule, by itself, in the background.',
  hotkey: 'It runs when the user presses a global keyboard shortcut.',
  bot: 'It runs when the user sends the bot a /command.',
  chat: 'It runs when the user types a /command in this chat.',
  manual: 'It runs when the user presses Run.',
};

export function renderAssessment(assessment: FlowAssessment): string {
  const lines = [VERDICT_TEXT[assessment.verdict], TRIGGER_TEXT[assessment.trigger]];
  if (assessment.outline.length > 0) {
    lines.push('', 'The flow would:');
    assessment.outline.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }
  if (assessment.gaps.length > 0) {
    lines.push('', 'Not covered:');
    assessment.gaps.forEach((gap) => lines.push(`- ${gap}`));
  }
  if (assessment.questions.length > 0) {
    // Stated as an instruction, not a list, because the observation is read by the model and the
    // next thing it does decides whether the user is asked or a value is invented for them.
    lines.push('', 'MISSING — ask the user these before building, in one message:');
    assessment.questions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
  }
  const text = lines.join('\n');
  return text.length > ASSESS_OBSERVATION_LIMIT ? `${text.slice(0, ASSESS_OBSERVATION_LIMIT)}…` : text;
}

const ISSUE_TEXT: Record<FlowBuildIssue['kind'], (issue: FlowBuildIssue) => string> = {
  blank: (issue) => `step ${issue.step} (${issue.skill}) has no "${issue.detail}" — the user has to fill it in`,
  failsoft: (issue) => `step ${issue.step} (${issue.skill}) runs in a loop without fail-soft`,
  setup: (issue) => `step ${issue.step} (${issue.skill}) needs ${issue.detail} to be set up first`,
};

/**
 * What the model is allowed to say about the flow it just saved. The issues are here because the
 * alternative — a cheerful "done!" over a flow with an empty feed URL — is the same class of
 * false claim `withActionFooter` exists to stop one layer down.
 */
function describeFlow(flow: FlowDefinition, issues: readonly FlowBuildIssue[]): string {
  const steps = flow.steps.map((step) => step.type as SkillType);
  const shown = steps.slice(0, 12).join(' → ');
  const more = steps.length > 12 ? ` (+${steps.length - 12} more)` : '';
  const lines = [
    `Saved the flow "${flow.name}" with ${steps.length} step(s), DISABLED for the user to review: ${shown}${more}.`,
  ];
  if (issues.length > 0) {
    lines.push(
      'Needs the user to check, and you must say so rather than report plain success:',
      ...issues.slice(0, 6).map((issue) => `- ${ISSUE_TEXT[issue.kind](issue)}`),
    );
  }
  lines.push('Tell the user it is waiting in the flow list and what it will do — do not build it again.');
  return lines.join('\n');
}

const PHASE_STAGE: Record<FlowBuildPhase, AgentStageLabel> = {
  understand: 'analyzing',
  discover: 'discovering',
  plan: 'planning',
  build: 'building',
  verify: 'verifying',
};

/** Mirrors each build event onto the agent's trace row and the shared build channel. */
function buildReporter(ctx: BuiltinDeps): ((event: FlowBuildEvent) => void) | undefined {
  if (!ctx.onStage && !ctx.onBuild) return undefined;
  return (event: FlowBuildEvent) => {
    ctx.onBuild?.(event);
    if (event.kind === 'phase' && event.status === 'active') ctx.onStage?.(PHASE_STAGE[event.phase]);
  };
}

export interface BuiltinOutcome {
  observation: string;
  status: 'ok' | 'error';
}

async function runAssess(goal: string, ctx: BuiltinDeps): Promise<BuiltinOutcome> {
  ctx.onStage?.('analyzing');
  const result = await assessFlowSupport(goal, budgetedDeps(ctx), { providerUrl: ctx.providerUrl });
  if (!result.ok) return { observation: `ERROR: ${result.error}`, status: 'error' };
  ctx.assessed = result.assessment;
  return { observation: renderAssessment(result.assessment), status: 'ok' };
}

/**
 * Why a build must not start yet, or null.
 *
 * The assessment has already said which values it would have to invent. Letting the model decide
 * whether that matters is the decision that produces a daily flow mailing a report to nobody, so
 * the program makes it: no build until the questions have been put to the user. A resumed run
 * arrives with no assessment in hand, which is correct — it resumed because they answered.
 */
export function askFirstReason(assessed: FlowAssessment | null): string | null {
  if (!assessed || assessed.questions.length === 0) return null;
  const list = assessed.questions.map((question, index) => `${index + 1}. ${question}`).join(' ');
  return `The assessment could not work out: ${list} Ask the user with "${'ask_user'}" and wait for their answer. Do not build with a value you chose for them.`;
}

async function runBuild(goal: string, ctx: BuiltinDeps): Promise<BuiltinOutcome> {
  if (!ctx.saveFlow) {
    return { observation: 'ERROR: This run cannot save flows. Tell the user what the flow would do instead.', status: 'error' };
  }
  // No assessment yet means `build_flow` was the opening move. Pay for one now rather than build
  // blind: it is also what puts the ask gate below in reach.
  if (!ctx.assessed) {
    const assessed = await runAssess(goal, ctx);
    if (assessed.status === 'error') return assessed;
  }
  if (ctx.assessed?.verdict === 'none') {
    return {
      observation: 'ERROR: The assessment found no skill that can do this. Do not build it — tell the user what is missing.',
      status: 'error',
    };
  }
  const askFirst = askFirstReason(ctx.assessed);
  if (askFirst) return { observation: `ERROR: ${askFirst}`, status: 'error' };

  const saveFlow = ctx.saveFlow;
  const report = buildReporter(ctx);
  const outcome = await runFlowBuild({
    goal,
    deps: budgetedDeps(ctx),
    save: saveFlow,
    ...(ctx.providerUrl ? { providerUrl: ctx.providerUrl } : {}),
    ...(ctx.assessed ? { assessed: ctx.assessed } : {}),
    // The agent asks with `ask_user`; the gate above is what makes sure it did.
    askUser: false,
    ...(report ? { emit: report } : {}),
    confirm: async (flow) => {
      if (!ctx.confirm) return false;
      const stepTypes = flow.steps.map((step) => String(step.type));
      const sensitiveTypes = [...new Set(stepTypes.filter((type) => SENSITIVE_STEP_TYPES.has(type)))];
      ctx.onStage?.('confirming');
      return ctx.confirm({ kind: 'flow', flowName: flow.name, stepTypes, sensitiveTypes });
    },
  });

  if (outcome.status === 'failed') {
    if (outcome.error === BUILD_DECLINED) {
      return {
        observation: 'ERROR: The user declined to save this flow. Do not retry it — ask what they want changed, or finish.',
        status: 'error',
      };
    }
    return { observation: `ERROR: ${outcome.error}`, status: 'error' };
  }
  if (outcome.status === 'questions') {
    // Unreachable with `askUser: false`, and handled rather than cast away so that flipping that
    // flag later cannot silently turn a question into a success.
    return { observation: `ERROR: ${outcome.questions.join(' ')}`, status: 'error' };
  }

  sendLog(`🧩 [Agent] built flow "${outcome.flow.name}" (${outcome.flow.steps.length} steps, disabled)`);
  return { observation: describeFlow(outcome.flow, outcome.report.issues), status: 'ok' };
}

export async function runBuiltinTool(
  tool: AgentBuiltinTool,
  config: Record<string, string>,
  ctx: BuiltinDeps,
  step = 0,
): Promise<BuiltinOutcome> {
  if (ctx.signal?.aborted) throw new FlowAbortError();
  if (tool === 'delegate') {
    const task = (config.task ?? '').trim();
    if (!task) return { observation: 'ERROR: "task" is required.', status: 'error' };
    if (!ctx.runSubtask) return { observation: 'ERROR: This run cannot hand off sub-tasks. Do the reading yourself.', status: 'error' };
    return ctx.runSubtask(task, step);
  }
  const goal = (config.goal ?? '').trim();
  if (!goal) return { observation: 'ERROR: "goal" is required.', status: 'error' };
  return tool === 'assess_flow' ? runAssess(goal, ctx) : runBuild(goal, ctx);
}

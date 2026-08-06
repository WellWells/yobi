import type { FlowAssessment, FlowDefinition, SkillType, TriggerType } from '../../../shared/types';
import { assessFlowSupport, generateFlowDefinition } from '../flowGenerator';
import { FlowAbortError } from '../runtime';
import { sendLog } from '../../helpers';
import type { FlowExecutorDeps } from '../types';

/**
 * Tools the agent can call that are NOT flow skills. They are deliberately not `SkillType`s:
 * a skill would show up in the flow editor and let a flow build flows, which is a recursion
 * nobody asked for. They ride the existing "call_tool" grammar so the model has no new shape
 * to learn — only two more names in the catalog.
 */
export const AGENT_BUILTIN_TOOLS = ['assess_flow', 'build_flow'] as const;

export type AgentBuiltinTool = typeof AGENT_BUILTIN_TOOLS[number];

const BUILTIN_SET = new Set<string>(AGENT_BUILTIN_TOOLS);

export function isBuiltinTool(name: string): name is AgentBuiltinTool {
  return BUILTIN_SET.has(name);
}

/**
 * Step types that turn a saved flow into arbitrary local execution. A generated flow is always
 * disabled, so none of them run until the user enables it — but they are what the confirmation
 * dialog must say out loud, because "a flow that fetches a feed" and "a flow that runs a shell
 * command every morning" are the same sentence until someone lists the steps.
 */
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
  /** Persists the generated flow, disabled for review. Absent = the tool refuses rather than pretends. */
  saveFlow?: (flow: FlowDefinition) => Promise<FlowDefinition>;
  confirm?: (request: FlowWriteConfirmRequest) => Promise<boolean>;
  /** Stage-A result carried across turns so `build_flow` never pays for the assessment twice. */
  assessed: { skills: string[]; trigger: TriggerType; verdict: FlowAssessment['verdict'] } | null;
  /** Milliseconds left in the whole run. Without it a two-call build could outlive the run budget. */
  remainingMs?: () => number;
  signal?: AbortSignal;
}

const MIN_BUILTIN_TIMEOUT_MS = 30_000;

/**
 * A builtin is one or two provider calls, so unlike a flow skill it has no timeout of its own.
 * Clamping it to what is left of the run is what stops `build_flow` from running on past the
 * point where the agent still has budget to say anything about the result.
 */
function budgetedDeps(ctx: BuiltinDeps): FlowExecutorDeps {
  if (!ctx.remainingMs) return ctx.deps;
  const base = ctx.deps.getResponseTimeoutMs?.();
  const remaining = ctx.remainingMs();
  const ceiling = base === undefined ? remaining : Math.min(base, remaining);
  return { ...ctx.deps, getResponseTimeoutMs: () => Math.max(MIN_BUILTIN_TIMEOUT_MS, ceiling) };
}

/**
 * Catalog lines. `build_flow`'s text carries the "assess first, tell the user, then build"
 * sequence rather than the shared instruction block: the rule is about this one tool, and the
 * instruction block is budgeted by `INSTRUCTION_EST`, which every other prompt subtracts.
 */
export function buildBuiltinCatalog(): string {
  return [
    '- "assess_flow": Check whether Yobi could AUTOMATE something as a saved flow, and how. Reads the whole skill list and reports which parts of the request are covered, an outline of the steps, and anything no skill can do. Read-only — nothing is created. config keys: "goal" (what the user wants automated, in their own words; REQUIRED) → returns: a coverage verdict, a step outline, and the gaps.',
    '- "build_flow": Build and SAVE the flow. Call "assess_flow" first and tell the user what it found — this step writes to their app and asks them to approve it, so never call it as the opening move or without saying what you are about to build. The flow is saved DISABLED for the user to review and switch on. config keys: "goal" (the same request, refined by anything the user said since; REQUIRED) → returns: the saved flow\'s name and its steps.',
  ].join('\n');
}

export function builtinRequiredFields(tool: AgentBuiltinTool): string[] {
  return tool === 'assess_flow' || tool === 'build_flow' ? ['goal'] : [];
}

/** Cap chosen so the observation survives `BROWSER_OBSERVATION_LIMIT` (3,500) intact on re-send. */
const ASSESS_OBSERVATION_LIMIT = 1_500;

const VERDICT_TEXT: Record<FlowAssessment['verdict'], string> = {
  full: 'Yobi can automate all of this.',
  partial: 'Yobi can automate part of this.',
  none: 'Yobi has no skill that can do this.',
};

/**
 * Stated plainly because it is the half users most often assume is missing — "can it just run
 * on its own?" — and the answer has to reach the final message, not stop at the compiler.
 */
const TRIGGER_TEXT: Record<TriggerType, string> = {
  cron: 'It runs on a schedule, by itself, in the background.',
  hotkey: 'It runs when the user presses a global keyboard shortcut.',
  bot: 'It runs when the user sends the bot a /command.',
  chat: 'It runs when the user types a /command in this chat.',
  manual: 'It runs when the user presses Run.',
};

/**
 * Exported for the test suite. The skill names are deliberately absent: they are internal
 * identifiers the user never sees, and the agent's job with this observation is to describe
 * the flow in their words, not to read the compiler's selection back to them.
 */
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
  const text = lines.join('\n');
  return text.length > ASSESS_OBSERVATION_LIMIT ? `${text.slice(0, ASSESS_OBSERVATION_LIMIT)}…` : text;
}

function describeFlow(flow: FlowDefinition): string {
  const steps = flow.steps.map((step) => step.type as SkillType);
  const shown = steps.slice(0, 12).join(' → ');
  const more = steps.length > 12 ? ` (+${steps.length - 12} more)` : '';
  return `Saved the flow "${flow.name}" with ${steps.length} step(s), DISABLED for the user to review: ${shown}${more}. Tell the user it is waiting in the flow list and what it will do — do not build it again.`;
}

export interface BuiltinOutcome {
  observation: string;
  status: 'ok' | 'error';
}

async function runAssess(goal: string, ctx: BuiltinDeps): Promise<BuiltinOutcome> {
  const result = await assessFlowSupport(goal, budgetedDeps(ctx), ctx.providerUrl);
  if (!result.ok) return { observation: `ERROR: ${result.error}`, status: 'error' };
  // Cached even for a "none" verdict — that verdict is a decision `build_flow` has to honour,
  // and re-running the assessment is not the agent's way out of having been told no.
  ctx.assessed = {
    skills: result.assessment.skills,
    trigger: result.assessment.trigger,
    verdict: result.assessment.verdict,
  };
  return { observation: renderAssessment(result.assessment), status: 'ok' };
}

async function runBuild(goal: string, ctx: BuiltinDeps): Promise<BuiltinOutcome> {
  if (!ctx.saveFlow) {
    return { observation: 'ERROR: This run cannot save flows. Tell the user what the flow would do instead.', status: 'error' };
  }
  // Without this, a "none" verdict is advisory: `preselected` skips the inline stage-A check,
  // so the tool would happily compile a flow out of whatever the assessment scraped together
  // right after reporting that nothing can do the job.
  if (ctx.assessed?.verdict === 'none') {
    return {
      observation: 'ERROR: The assessment found no skill that can do this. Do not build it — tell the user what is missing.',
      status: 'error',
    };
  }

  const generated = await generateFlowDefinition(goal, budgetedDeps(ctx), {
    providerUrl: ctx.providerUrl,
    ...(ctx.assessed ? { preselected: ctx.assessed.skills, triggerHint: ctx.assessed.trigger } : {}),
  });
  if (!generated.ok) return { observation: `ERROR: ${generated.error}`, status: 'error' };

  const stepTypes = generated.flow.steps.map((step) => String(step.type));
  const sensitiveTypes = [...new Set(stepTypes.filter((type) => SENSITIVE_STEP_TYPES.has(type)))];
  // Asked AFTER generating, so the dialog can name the actual steps. Generating costs a model
  // call and no disk write, which is the cheaper half to spend on an informed question.
  const allowed = ctx.confirm
    ? await ctx.confirm({ kind: 'flow', flowName: generated.flow.name, stepTypes, sensitiveTypes })
    : false;
  if (!allowed) {
    return {
      observation: 'ERROR: The user declined to save this flow. Do not retry it — ask what they want changed, or finish.',
      status: 'error',
    };
  }

  try {
    const saved = await ctx.saveFlow(generated.flow);
    sendLog(`🧩 [Agent] built flow "${saved.name}" (${saved.steps.length} steps, disabled)`);
    return { observation: describeFlow(saved), status: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { observation: `ERROR: ${message}`, status: 'error' };
  }
}

export async function runBuiltinTool(
  tool: AgentBuiltinTool,
  config: Record<string, string>,
  ctx: BuiltinDeps,
): Promise<BuiltinOutcome> {
  // Checked here rather than inside the provider call: a run the user already stopped must not
  // reach the point where it asks them to approve saving something.
  if (ctx.signal?.aborted) throw new FlowAbortError();
  const goal = (config.goal ?? '').trim();
  if (!goal) return { observation: 'ERROR: "goal" is required.', status: 'error' };
  return tool === 'assess_flow' ? runAssess(goal, ctx) : runBuild(goal, ctx);
}

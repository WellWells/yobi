import type {
  AgentFlowRecipient, FlowAssessment, FlowBuildEvent, FlowBuildFailureReason, FlowBuildOutcome, FlowBuildPhase,
  FlowBuildReport, FlowDefinition, SkillType,
} from '../../shared/types';
import { SKILL_TYPES, withClarifications } from '../../shared/flowSkillSchema';
import type { FlowClarification } from '../../shared/flowSkillSchema';
import { flowRecipients, resolveFlowRecipients } from '../../shared/botRecipients';
import type { RecipientDirectory } from '../../shared/botRecipients';
import { withRecipientQuestion } from '../../shared/botRecipientQuestion';
import type { RecipientWording } from '../../shared/botRecipientQuestion';
import { lazyRecipients, recipientWording } from './botRecipientDirectory';
import { assessFlowSupport, generateFlowDefinition } from './flowGenerator';
import { lintGeneratedFlow, recipientBuildIssues } from './flowLint';
import { probeReadiness, snapshotIntegrations } from './flowReadiness';
import type { IntegrationSnapshot } from './flowReadiness';
import { sendLog } from '../helpers';
import { getProviderLabel } from '../providers';
import type { FlowExecutorDeps } from './types';

/**
 * One pass of understand → discover → plan → build → verify, shared by the Flow Builder and by
 * `/agent`'s `build_flow`. Only understand and build call the model; every other phase is local.
 */

const KNOWN_SKILLS = new Set<string>(SKILL_TYPES);

function asSkillTypes(names: readonly string[]): SkillType[] {
  return names.filter((name): name is SkillType => KNOWN_SKILLS.has(name));
}

/** The error a declined save reports, so the caller can tell it apart from a real fault. */
export const BUILD_DECLINED = 'declined';

export interface FlowBuildRequest {
  goal: string;
  deps: FlowExecutorDeps;
  save: (flow: FlowDefinition) => Promise<FlowDefinition>;
  /** Answers to a previous round's questions. Folded into the text both prompts see. */
  answers?: readonly FlowClarification[];
  /** Skip the understand phase — `/agent` has usually already paid for it via `assess_flow`. */
  assessed?: FlowAssessment;
  /**
   * Whether an unanswered question stops the build. False where the caller has its own way to
   * ask — `/agent` asks with `ask_user` before it ever calls `build_flow`.
   */
  askUser?: boolean;
  providerUrl?: string;
  emit?: (event: FlowBuildEvent) => void;
  /**
   * Returns false when the user declines to save. Absent means the caller already has consent.
   * `recipients` is who the bot steps send to, by name — empty when the flow has none.
   */
  confirm?: (flow: FlowDefinition, recipients: AgentFlowRecipient[]) => Promise<boolean>;
  /** Read from the live config when omitted. */
  snapshot?: IntegrationSnapshot;
  /** The chats a bot step can reach. Passed by `/agent`; read live otherwise. */
  recipients?: RecipientDirectory;
  /**
   * The user's own words, read for "send it to me" and for whether a recipient was named. Defaults
   * to the goal, which in the Flow Builder is what the user typed. `/agent` passes its user's words
   * instead: its goal is the model's rewording, and a name the model wrote there must not count as
   * the user having chosen who receives the flow.
   */
  words?: string;
  /** Defaults to wording the recipient question in the app's language. */
  wording?: RecipientWording;
}

/**
 * `reason` travels with the raw `error` so the broadcast can word it for the user; the outcome
 * keeps `error` raw for the log, the `/agent` observation and the `BUILD_DECLINED` comparison.
 * With a reason the raw text is a validator line written for the model, so the phase event does
 * not carry it as its detail either.
 */
function failure(
  emit: ((event: FlowBuildEvent) => void) | undefined,
  phase: FlowBuildPhase,
  error: string,
  reason?: FlowBuildFailureReason,
): FlowBuildOutcome {
  const why = reason ? { reason } : {};
  emit?.({ kind: 'phase', phase, status: 'failed', ...(reason ? {} : { detail: error }) });
  emit?.({ kind: 'failed', phase, error, ...why });
  return { status: 'failed', phase, error, ...why };
}

export async function runFlowBuild(request: FlowBuildRequest): Promise<FlowBuildOutcome> {
  const { deps, emit, save } = request;
  const goal = withClarifications(request.goal, request.answers ?? []);
  if (!goal.trim()) return failure(emit, 'understand', 'Empty description');
  const words = request.words ?? goal;
  const recipients = lazyRecipients(request.recipients);

  let assessment = request.assessed;
  if (!assessment) {
    emit?.({ kind: 'phase', phase: 'understand', status: 'active' });
    const assessed = await assessFlowSupport(goal, deps, {
      ...(request.providerUrl ? { providerUrl: request.providerUrl } : {}),
      onProvider: (resolved) => emit?.({ kind: 'provider', label: getProviderLabel(resolved) }),
      // Retries are the slowest thing that can happen here, so they are the one thing that must
      // not look like a hang.
      onAttempt: (attempt) => {
        if (attempt > 1) emit?.({ kind: 'phase', phase: 'understand', status: 'active', detail: 'repair' });
      },
    });
    if (!assessed.ok) return failure(emit, 'understand', assessed.error, assessed.reason);
    assessment = assessed.assessment;
    // An assessment handed in by `/agent` already carries this question; it asked it there.
    if (assessment.skills.includes('bot')) {
      assessment = withRecipientQuestion(assessment, words, await recipients(), request.wording ?? recipientWording());
    }
  }
  emit?.({ kind: 'phase', phase: 'understand', status: 'done' });

  if (assessment.verdict === 'none') {
    return failure(emit, 'understand', assessment.gaps[0] ?? 'No Yobi skill can carry out this request');
  }

  // Ask before discovery: an answer changes which skills get picked, so asking later would discard the plan.
  if (request.askUser && assessment.questions.length > 0) {
    sendLog(`❓ [Flow] Needs ${assessment.questions.length} answer(s) before building`);
    emit?.({ kind: 'questions', questions: assessment.questions });
    return { status: 'questions', questions: assessment.questions };
  }

  emit?.({ kind: 'phase', phase: 'discover', status: 'active' });
  const skills = asSkillTypes(assessment.skills);
  const { blocked } = probeReadiness(skills, request.snapshot ?? snapshotIntegrations());
  emit?.({ kind: 'tools', skills, blocked });
  emit?.({ kind: 'phase', phase: 'discover', status: 'done' });

  // The outline comes from the assessment; this phase makes no model call.
  emit?.({ kind: 'phase', phase: 'plan', status: 'active' });
  emit?.({ kind: 'outline', outline: assessment.outline });
  emit?.({ kind: 'phase', phase: 'plan', status: 'done' });

  emit?.({ kind: 'phase', phase: 'build', status: 'active' });
  const generated = await generateFlowDefinition(goal, deps, {
    ...(request.providerUrl ? { providerUrl: request.providerUrl } : {}),
    preselected: assessment.skills,
    triggerHint: assessment.trigger,
    onAttempt: (attempt) => {
      if (attempt > 1) emit?.({ kind: 'phase', phase: 'build', status: 'active', detail: 'repair' });
    },
  });
  if (!generated.ok) return failure(emit, 'build', generated.error, generated.reason);
  emit?.({ kind: 'phase', phase: 'build', status: 'done' });

  emit?.({ kind: 'phase', phase: 'verify', status: 'active' });
  let flow = generated.flow;
  const issues = lintGeneratedFlow(flow, blocked);
  let sendsTo: AgentFlowRecipient[] = [];
  // The model wrote who the user said ("me", a name); the paired chats turn that into ids here.
  if (flow.steps.some((step) => step.type === 'bot')) {
    const directory = await recipients();
    const resolved = resolveFlowRecipients(flow, directory, { words });
    flow = resolved.flow;
    issues.push(...recipientBuildIssues(resolved.issues));
    sendsTo = flowRecipients(flow, directory);
  }
  const report: FlowBuildReport = {
    skills,
    steps: flow.steps.length,
    trigger: flow.trigger.type,
    issues,
    gaps: assessment.gaps,
  };
  emit?.({ kind: 'phase', phase: 'verify', status: 'done' });

  if (request.confirm && !(await request.confirm(flow, sendsTo))) {
    return failure(emit, 'verify', BUILD_DECLINED);
  }

  try {
    const saved = await save(flow);
    sendLog(`🧩 [Flow] built "${saved.name}" — ${report.steps} steps, ${issues.length} issue(s) to check`);
    emit?.({ kind: 'done', report, flowName: saved.name });
    return { status: 'created', flow: saved, report };
  } catch (err) {
    return failure(emit, 'verify', err instanceof Error ? err.message : String(err));
  }
}

import type {
  FlowAssessment, FlowBuildEvent, FlowBuildOutcome, FlowBuildPhase, FlowBuildReport,
  FlowDefinition, SkillType,
} from '../../shared/types';
import { SKILL_TYPES, withClarifications } from '../../shared/flowSkillSchema';
import type { FlowClarification } from '../../shared/flowSkillSchema';
import { assessFlowSupport, generateFlowDefinition } from './flowGenerator';
import { lintGeneratedFlow } from './flowLint';
import { probeReadiness, snapshotIntegrations } from './flowReadiness';
import type { IntegrationSnapshot } from './flowReadiness';
import { sendLog } from '../helpers';
import { getProviderLabel } from '../providers';
import type { FlowExecutorDeps } from './types';

/**
 * One pass of understand → discover → plan → build → verify, shared by the Flow Builder and by
 * `/agent`'s `build_flow`. There is no model-driven tool loop in here: the two LLM calls this
 * makes are the two the generator always made, and every other phase is local. Showing the work
 * is a broadcasting problem, not a reason to think harder.
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
  /** Returns false when the user declines to save. Absent means the caller already has consent. */
  confirm?: (flow: FlowDefinition) => Promise<boolean>;
  /** Injected by tests; production reads the live config. */
  snapshot?: IntegrationSnapshot;
}

function failure(
  emit: ((event: FlowBuildEvent) => void) | undefined,
  phase: FlowBuildPhase,
  error: string,
): FlowBuildOutcome {
  emit?.({ kind: 'phase', phase, status: 'failed', detail: error });
  emit?.({ kind: 'failed', phase, error });
  return { status: 'failed', phase, error };
}

export async function runFlowBuild(request: FlowBuildRequest): Promise<FlowBuildOutcome> {
  const { deps, emit, save } = request;
  const goal = withClarifications(request.goal, request.answers ?? []);
  if (!goal.trim()) return failure(emit, 'understand', 'Empty description');

  // ── understand ────────────────────────────────────────────────────────────────────────────
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
    if (!assessed.ok) return failure(emit, 'understand', assessed.error);
    assessment = assessed.assessment;
  }
  emit?.({ kind: 'phase', phase: 'understand', status: 'done' });

  if (assessment.verdict === 'none') {
    return failure(emit, 'understand', assessment.gaps[0] ?? 'No Yobi skill can carry out this request');
  }

  // ── ask, rather than invent ───────────────────────────────────────────────────────────────
  // Before any discovery or generation: a question answered now changes which skills get picked,
  // so asking after the plan exists would throw the plan away.
  if (request.askUser && assessment.questions.length > 0) {
    sendLog(`❓ [Flow] Needs ${assessment.questions.length} answer(s) before building`);
    emit?.({ kind: 'questions', questions: assessment.questions });
    return { status: 'questions', questions: assessment.questions };
  }

  // ── discover ──────────────────────────────────────────────────────────────────────────────
  emit?.({ kind: 'phase', phase: 'discover', status: 'active' });
  const skills = asSkillTypes(assessment.skills);
  const { blocked } = probeReadiness(skills, request.snapshot ?? snapshotIntegrations());
  emit?.({ kind: 'tools', skills, blocked });
  emit?.({ kind: 'phase', phase: 'discover', status: 'done' });

  // ── plan ──────────────────────────────────────────────────────────────────────────────────
  // The outline was already paid for by the assessment and, until now, thrown away.
  emit?.({ kind: 'phase', phase: 'plan', status: 'active' });
  emit?.({ kind: 'outline', outline: assessment.outline });
  emit?.({ kind: 'phase', phase: 'plan', status: 'done' });

  // ── build ─────────────────────────────────────────────────────────────────────────────────
  emit?.({ kind: 'phase', phase: 'build', status: 'active' });
  const generated = await generateFlowDefinition(goal, deps, {
    ...(request.providerUrl ? { providerUrl: request.providerUrl } : {}),
    preselected: assessment.skills,
    triggerHint: assessment.trigger,
    onAttempt: (attempt) => {
      if (attempt > 1) emit?.({ kind: 'phase', phase: 'build', status: 'active', detail: 'repair' });
    },
  });
  if (!generated.ok) return failure(emit, 'build', generated.error);
  emit?.({ kind: 'phase', phase: 'build', status: 'done' });

  // ── verify ────────────────────────────────────────────────────────────────────────────────
  emit?.({ kind: 'phase', phase: 'verify', status: 'active' });
  const issues = lintGeneratedFlow(generated.flow, blocked);
  const report: FlowBuildReport = {
    skills,
    steps: generated.flow.steps.length,
    trigger: generated.flow.trigger.type,
    issues,
    gaps: assessment.gaps,
  };
  emit?.({ kind: 'phase', phase: 'verify', status: 'done' });

  if (request.confirm && !(await request.confirm(generated.flow))) {
    return failure(emit, 'verify', BUILD_DECLINED);
  }

  try {
    const saved = await save(generated.flow);
    sendLog(`🧩 [Flow] built "${saved.name}" — ${report.steps} steps, ${issues.length} issue(s) to check`);
    emit?.({ kind: 'done', report, flowName: saved.name });
    return { status: 'created', flow: saved, report };
  } catch (err) {
    return failure(emit, 'verify', err instanceof Error ? err.message : String(err));
  }
}

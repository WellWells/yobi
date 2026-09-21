import type {
  FlowBuildBlocker, FlowBuildIssue, FlowDefinition, SkillInstance, SkillType,
} from '../../shared/types';
import { SKILL_SPECS } from '../../shared/flowSkillSpecs';

/**
 * What the verify phase adds on top of `validateFlowCandidate`. That one already rejects unknown
 * variables, unbalanced loop/if blocks and duplicate output keys, and a flow that fails it never
 * reaches here. These three are the faults it lets through — each one produces a flow that saves
 * cleanly and then does nothing useful at run time, which is the failure the user cannot see.
 */

const REQUIRED_FIELDS = new Map<SkillType, string[]>(
  SKILL_SPECS.map((spec) => [spec.type, spec.fields.filter((f) => f.required).map((f) => f.key)]),
);

/**
 * A value the generator wrote to fill a blank rather than because the request asked for it.
 *
 * Deliberately narrow. A false positive here tells the user to check a field that is already
 * right, and a build report that cries wolf is one the user stops reading — which costs more
 * than the placeholder it was meant to catch.
 */
const PLACEHOLDER_RE = /example\.(?:com|org|net)|\byour[_-]?(?:feed|url|email|token|key|channel)\b|^<[^>]+>$|^(?:xxx+|todo|tbd|\.\.\.)$/i;

function isBlank(value: string | undefined): boolean {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return true;
  // A variable reference is the generator wiring steps together, never a blank it gave up on.
  if (trimmed.includes('{{')) return false;
  return PLACEHOLDER_RE.test(trimmed);
}

function blankIssues(steps: readonly SkillInstance[]): FlowBuildIssue[] {
  const issues: FlowBuildIssue[] = [];
  steps.forEach((step, index) => {
    for (const key of REQUIRED_FIELDS.get(step.type) ?? []) {
      if (!isBlank(step.config[key])) continue;
      issues.push({ kind: 'blank', step: index + 1, skill: step.type, detail: key });
    }
  });
  return issues;
}

/**
 * Steps that talk to something outside the app, so one dead link or one refused request ends the
 * whole batch unless they are told to fail soft. Documented in `src/main/flow/CLAUDE.md` as loop
 * convention 5, and until now enforced by nothing: the seen-cache has already marked the batch
 * read by the time the loop dies, so those items are never retried.
 */
const FAIL_SOFT_SKILLS = new Set<SkillType>(['browser', 'llm', 'bot']);

function failSoftIssues(steps: readonly SkillInstance[]): FlowBuildIssue[] {
  const issues: FlowBuildIssue[] = [];
  let depth = 0;
  steps.forEach((step, index) => {
    if (step.type === 'loop') {
      depth++;
      return;
    }
    if (step.type === 'end_loop') {
      depth = Math.max(0, depth - 1);
      return;
    }
    if (depth === 0 || !FAIL_SOFT_SKILLS.has(step.type)) return;
    if ((step.config.emitFailFlag ?? '').trim() === 'true') return;
    issues.push({ kind: 'failsoft', step: index + 1, skill: step.type, detail: 'emitFailFlag' });
  });
  return issues;
}

function setupIssues(
  steps: readonly SkillInstance[],
  blocked: readonly FlowBuildBlocker[],
): FlowBuildIssue[] {
  if (blocked.length === 0) return [];
  const needBySkill = new Map(blocked.map((entry) => [entry.skill, entry.need]));
  const issues: FlowBuildIssue[] = [];
  steps.forEach((step, index) => {
    const need = needBySkill.get(step.type);
    if (need) issues.push({ kind: 'setup', step: index + 1, skill: step.type, detail: need });
  });
  return issues;
}

/** Every issue worth telling the user about, in step order within each kind. */
export function lintGeneratedFlow(
  flow: FlowDefinition,
  blocked: readonly FlowBuildBlocker[] = [],
): FlowBuildIssue[] {
  return [
    ...blankIssues(flow.steps),
    ...failSoftIssues(flow.steps),
    ...setupIssues(flow.steps, blocked),
  ];
}

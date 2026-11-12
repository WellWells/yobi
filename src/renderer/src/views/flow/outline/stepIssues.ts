import { checkBlockStructureAll } from '../../../../../shared/flowBlockStructure';
import { findReferenceIssues } from '../../../../../shared/flowReferenceCheck';
import type { FlowDefinition, SkillInstance, SkillType } from '../../../../../shared/types';
import { stepSummary } from '../stepSummary';
import { describeReferenceIssue, describeStructureIssue } from '../flowIssues';
import { stepHasOutput } from '../StepCard';
import { validateOutputKey } from '../skills/validation';
import { ON_CHANGE_DIFF_FIELDS } from '../variableInsert';
import { fillTemplate } from '../../../../../shared/fillTemplate';

export interface StepIssue {
  text: string;
  tone: 'error' | 'warning';
}

/**
 * What is wrong with each step, one sentence per step (the first that applies: its output name,
 * then the flow's structure, then a reference that will not resolve), by the same checks a run and
 * an AI build use. Shown on the outline's row and on the folded card; a warning never stops a run.
 */
export function collectStepIssues(flow: FlowDefinition, t: (key: string) => string): Map<string, StepIssue> {
  const issues = new Map<string, StepIssue>();
  const before: string[] = [];
  flow.steps.forEach((step) => {
    if (!stepHasOutput(step)) return;
    const error = validateOutputKey(step.outputKey, before);
    before.push(step.outputKey);
    if (error) issues.set(step.id, { text: t(`flow.step.outputKey.error.${error}`), tone: 'error' });
  });
  for (const issue of checkBlockStructureAll(flow.steps)) {
    const step = flow.steps[issue.index];
    if (!step || issues.get(step.id)?.tone === 'error') continue;
    if (issues.has(step.id) && issue.severity === 'warning') continue;
    issues.set(step.id, { text: describeStructureIssue(issue, t), tone: issue.severity });
  }
  const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
  for (const issue of findReferenceIssues(flow.steps, triggers, flow.variables ?? [])) {
    const step = flow.steps[issue.stepIndex];
    if (!step || issues.get(step.id)?.tone === 'error') continue;
    issues.set(step.id, { text: describeReferenceIssue(issue, t), tone: 'error' });
  }
  for (const [stepId, token] of diffFieldsWithoutDiff(flow)) {
    if (issues.has(stepId)) continue;
    issues.set(stepId, { text: fillTemplate(t('flow.issue.ref.onChangeDiffOff'), { token }), tone: 'warning' });
  }
  return issues;
}

const DIFF_FIELDS: ReadonlySet<string> = new Set(ON_CHANGE_DIFF_FIELDS);
const REF_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Steps reading `{{changed_1.diff}}` (or another of the fields "Include what changed" adds) of
 * an on_change step that has it off: the run gives them "" there. A warning, not a reference
 * error: the runner and the AI build take such a reference as it is.
 */
function diffFieldsWithoutDiff(flow: FlowDefinition): Map<string, string> {
  const off = new Set(flow.steps.filter((step) => step.type === 'on_change' && step.config.withDiff !== 'true' && step.outputKey?.trim())
    .map((step) => step.outputKey.trim()));
  const found = new Map<string, string>();
  if (off.size === 0) return found;
  for (const step of flow.steps) {
    if (step.type === 'comment') continue;
    for (const value of Object.values(step.config)) {
      if (typeof value !== 'string' || found.has(step.id)) continue;
      for (const match of value.matchAll(REF_RE)) {
        const [root, field] = match[1].split('.');
        if (field && off.has(root) && DIFF_FIELDS.has(field)) {
          found.set(step.id, `{{${match[1]}}}`);
          break;
        }
      }
    }
  }
  return found;
}

/** Steps that end the run where they stand (power off the computer, restart Yobi). */
const ENDS_THE_RUN: ReadonlySet<SkillType> = new Set<SkillType>(['power', 'restart_app']);

/**
 * The cards' issues: the checks', plus the outline's "N steps after this will not run" on a step
 * that ends the run with steps after it. Worded by the same `stepSummary` the outline row reads,
 * so the card and the row never disagree; a check's issue on the same step comes first.
 */
export function withEndOfRunWarnings(
  steps: readonly SkillInstance[],
  issues: Map<string, StepIssue>,
  t: (key: string) => string,
): Map<string, StepIssue> {
  steps.forEach((step, index) => {
    if (!ENDS_THE_RUN.has(step.type) || issues.has(step.id)) return;
    const summary = stepSummary(step, { t, index, steps });
    if (summary.state === 'warning' && summary.issue) issues.set(step.id, { text: summary.issue, tone: 'warning' });
  });
  return issues;
}

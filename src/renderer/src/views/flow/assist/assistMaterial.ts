import type { StepNameMaterial } from '../../../../../shared/flowAssist';
import { ASSIST_NAME_MAX_STEPS, ASSIST_PROBLEMS_MAX } from '../../../../../shared/flowAssist';
import type { FlowDefinition, SkillInstance } from '../../../../../shared/types';
import { stepDisplayName, stepSummary } from '../stepSummary';
import { isNamed } from '../stepSummary/core';
import type { StepSummaryContext } from '../stepSummary';
import { hasLabelField } from '../stepLabelRules';
import type { StepIssue } from '../outline/stepIssues';

/*
 * What the assistant's requests carry, built from what the editor already shows: each step's
 * summary line (never its code, headers or chat ids — `stepSummary` leaves those out) and the
 * editor's own problem list.
 */

export function nameableSteps(flow: FlowDefinition): SkillInstance[] {
  return flow.steps.filter((step) => hasLabelField(step.type));
}

/**
 * The steps the Name steps button names: the ones still called by their kind; when every step has a name
 * already, all of them (the user asked for better names). At most `ASSIST_NAME_MAX_STEPS`.
 */
export function namingTargets(flow: FlowDefinition, t: (key: string) => string): string[] {
  const nameable = nameableSteps(flow);
  const unnamed = nameable.filter((step) => !isNamed(step, t));
  return (unnamed.length > 0 ? unnamed : nameable).slice(0, ASSIST_NAME_MAX_STEPS).map((step) => step.id);
}

export function stepNameMaterial(
  flow: FlowDefinition,
  t: (key: string) => string,
  context: Omit<StepSummaryContext, 'index'>,
): StepNameMaterial[] {
  return flow.steps.map((step, index) => {
    const summary = stepSummary(step, { ...context, index });
    const named = isNamed(step, t);
    // A named step's summary leads with its name; what it does is the other line.
    const what = [summary.primary, summary.secondary].filter((line): line is string => Boolean(line && line !== step.label.trim()));
    return {
      id: step.id,
      index: index + 1,
      type: step.type,
      typeName: t(`flow.skill.${step.type}`),
      label: named ? step.label.trim() : '',
      summary: what.join(' · '),
    };
  });
}

/** The editor's problem list as lines for the explanation: "#3 摘要：…". */
export function problemLines(flow: FlowDefinition, issues: ReadonlyMap<string, StepIssue>, t: (key: string) => string): string[] {
  const lines: string[] = [];
  flow.steps.forEach((step, index) => {
    const issue = issues.get(step.id);
    if (issue) lines.push(`#${index + 1} ${stepDisplayName(step, t)}: ${issue.text}`);
  });
  return lines.slice(0, ASSIST_PROBLEMS_MAX);
}

import type { FlowDefinition, SkillInstance } from '../../../../../shared/types';
import { llmProviderLabel, type NamedModel } from '../flowCapabilities';
import { stepSummary, type StepSummaryContext } from '../stepSummary';
import type { OutlineRow, RowText } from './outlineModel';

/** The first line of a comment, which the outline shows as a section heading. */
export function commentHeading(step: SkillInstance): { heading: string; rest: string } {
  const lines = (step.config.note ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  return { heading: lines[0] ?? '', rest: lines.slice(1).join(' ') };
}

/** What every row's summary reads the flow through. */
export function summaryContext(
  flow: FlowDefinition,
  t: (key: string) => string,
  models: readonly NamedModel[],
  locale: string,
): Omit<StepSummaryContext, 'index'> {
  return {
    t,
    steps: flow.steps,
    variables: flow.variables ?? [],
    triggers: [flow.trigger, ...(flow.extraTriggers ?? [])],
    locale,
    modelLabel: (step) => (step.config.provider ? llmProviderLabel(step.config.provider, models, t('flow.step.byokProvider')) : undefined),
  };
}

/**
 * What an outline row says: a name the user gave on top with what the step does under it,
 * otherwise what it does (`stepSummary`) with where its input comes from under it. A comment is
 * its first line, the heading of the steps after it.
 */
export function rowText(row: OutlineRow, ctx: Omit<StepSummaryContext, 'index'>): RowText {
  const { step } = row;
  if (step.type === 'comment') {
    const { heading, rest } = commentHeading(step);
    return heading ? { primary: heading, secondary: rest || undefined } : { primary: ctx.t('flow.skill.comment'), state: 'unset' };
  }
  const summary = stepSummary(step, { ...ctx, index: row.index });
  const label = step.label.trim();
  const named = label !== '' && label !== ctx.t(`flow.skill.${step.type}`);
  // Most summarizers already put a given name on top (`named`); the line under it is then theirs.
  const under = summary.primary === label ? summary.secondary : summary.primary;
  return {
    primary: named ? label : summary.primary,
    secondary: named ? under : summary.secondary,
    state: summary.state,
    issue: summary.issue,
  };
}

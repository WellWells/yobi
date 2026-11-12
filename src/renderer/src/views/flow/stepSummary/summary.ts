import { SKILLS_WITHOUT_OUTPUT_KEY } from '../../../../../shared/flowSkillSpecs';
import type { SkillInstance, SkillType } from '../../../../../shared/types';
import { validateOutputKey } from '../skills/validation';
import { AI_SUMMARIES } from './ai';
import { CONTROL_SUMMARIES } from './control';
import { stepDisplayName, t } from './core';
import { FEED_SUMMARIES } from './feeds';
import { FILE_SUMMARIES } from './files';
import { LOOKUP_SUMMARIES } from './lookups';
import { MEDIA_SUMMARIES } from './media';
import { firstBadRef } from './refs';
import { SEND_SUMMARIES } from './send';
import { SYSTEM_SUMMARIES } from './system';
import { WEB_SUMMARIES } from './web';
import type { StepSummary, StepSummaryContext, Summarizer } from './types';

/** Every skill type has its own summary; a new type without one does not compile. */
const SUMMARIES: Record<SkillType, Summarizer> = {
  ...AI_SUMMARIES,
  ...CONTROL_SUMMARIES,
  ...FEED_SUMMARIES,
  ...FILE_SUMMARIES,
  ...LOOKUP_SUMMARIES,
  ...MEDIA_SUMMARIES,
  ...SEND_SUMMARIES,
  ...SYSTEM_SUMMARIES,
  ...WEB_SUMMARIES,
};

function outputIssue(step: SkillInstance, ctx: StepSummaryContext): string | undefined {
  if (!step.outputKey || SKILLS_WITHOUT_OUTPUT_KEY.includes(step.type)) return undefined;
  const earlier = ctx.steps.slice(0, ctx.index).map((other) => other.outputKey).filter(Boolean);
  const error = validateOutputKey(step.outputKey, earlier);
  if (error === 'duplicate') return t(ctx, 'flow.summary.issue.outputDuplicate');
  if (error === 'format') return t(ctx, 'flow.summary.issue.outputFormat');
  return undefined;
}

/**
 * What a step does, in one line and an optional second: enumerations translated, units
 * converted, `{{rss_2}}` written as "#2 讀取訂閱", and never a secret — no code, no HTTP headers
 * or body, no chat ID. A clashing output name comes first (the card cannot fold with it), then
 * the type's own error, then a reference that resolves to nothing here.
 */
export function stepSummary(step: SkillInstance, ctx: StepSummaryContext): StepSummary {
  const summary = SUMMARIES[step.type]?.(step, ctx) ?? { primary: stepDisplayName(step, ctx.t), state: 'ok' };
  const output = outputIssue(step, ctx);
  if (output) return { ...summary, state: 'error', issue: output };
  if (summary.state === 'error' || step.type === 'comment') return summary;
  const ref = firstBadRef(ctx, Object.values(step.config));
  return ref ? { ...summary, state: 'error', issue: ref } : summary;
}

import { SKILLS_WITHOUT_OUTPUT_KEY } from '../../../../shared/flowSkillSchema';
import type { SkillInstance, SkillType } from '../../../../shared/types';

const UI_HIDDEN_OUTPUT: SkillType[] = ['bot', 'loop'];

/**
 * Whether a step hands on an output by name, so its card shows (and checks) an output name. A
 * clipboard step only does when it reads (the default): writing outputs "". Kept apart from
 * `StepCard` so a step form (which the card imports) can read the flow's data without importing
 * the card back.
 */
export function stepHasOutput(step: SkillInstance): boolean {
  if (step.type === 'clipboard') return step.config.action !== 'write';
  return !SKILLS_WITHOUT_OUTPUT_KEY.includes(step.type) && !UI_HIDDEN_OUTPUT.includes(step.type);
}

import type { SkillType } from '../../../../shared/types';

/** Steps with nothing to set: the card is its header alone, so it has nothing to fold. */
export const ATOMIC_STEPS: SkillType[] = ['restart_app', 'break', 'continue', 'end_loop', 'end_if'];

/** Steps whose card has no name field (a comment is its own text). */
export const LABELLESS_STEPS: SkillType[] = ['comment'];

/** Whether the step's card has a name field: what the AI assistant may name. */
export function hasLabelField(type: SkillType): boolean {
  return !ATOMIC_STEPS.includes(type) && !LABELLESS_STEPS.includes(type);
}

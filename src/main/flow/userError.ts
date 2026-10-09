import type { SkillInstance } from '../../shared/types';
import { localizeUserFacingError, t } from '../i18n';

type Strings = Record<string, string>;

/**
 * A step failure Yobi words itself. `message` stays the English diagnostic — the log, the step
 * statistics (`flowErrorReason`), the run export and `/agent` observations all read it — while
 * `key` and `vars` say the same thing in the user's language wherever a person reads it.
 */
export class FlowUserError extends Error {
  constructor(readonly key: string, readonly vars: Record<string, string>, english: string) {
    super(english);
    this.name = 'FlowUserError';
  }
}

/** What went wrong in one step, in the user's language, without naming the step. */
export function localizeStepError(err: unknown, strings: Strings): string {
  if (err instanceof FlowUserError) return t(strings, err.key, err.vars);
  return localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);
}

/** The step's own label, or the name the editor gives its skill — never the skill id. */
export function stepDisplayName(step: Pick<SkillInstance, 'label' | 'type'>, strings: Strings): string {
  return (step.label ?? '').trim() || t(strings, `flow.skill.${step.type}`);
}

/**
 * The one line a notification, a bot reply or a chat toast shows for a failed run. Those have no
 * step list beside them, so the step is named; the run panel already shows the failure under its
 * own step and uses `localizeStepError` instead.
 */
export function describeStepError(
  err: unknown,
  step: Pick<SkillInstance, 'label' | 'type'>,
  strings: Strings,
): string {
  return t(strings, 'flow.error.stepFailed', {
    step: stepDisplayName(step, strings),
    error: localizeStepError(err, strings),
  });
}

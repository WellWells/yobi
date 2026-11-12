import { fillTemplate } from '../../../../shared/fillTemplate';
import type { FlowExecutionLog, SkillInstance } from '../../../../shared/types';

/**
 * The quiet line a step card shows about the last run besides its mark: why a step was skipped on
 * purpose (a stop, a break, a continue; the same `note` the run panel prints), whether a condition
 * held, whether an on_change let its value through, a video transcript step that finished with no
 * words (its `.isFailed` is 1, so a following condition takes the other branch). Read from the log
 * the renderer already has; nothing for a failure (the card prints the error) or a plain skip.
 */
export function stepRunNote(
  step: Pick<SkillInstance, 'type'>,
  log: Pick<FlowExecutionLog, 'status' | 'output' | 'error' | 'note'> | undefined,
  guarded: number | undefined,
  t: (key: string) => string,
): string | undefined {
  if (!log || log.error) return undefined;
  if (log.status === 'skipped') return log.note ? t(`flow.execution.note.${log.note}`) : undefined;
  if (log.status !== 'completed') return undefined;
  if (step.type === 'if') {
    if (log.output === 'true') return t('flow.step.run.ifMet');
    if (log.output === 'false') return fillTemplate(t('flow.step.run.ifNotMet'), { count: String(guarded ?? 0) });
    return undefined;
  }
  if (step.type === 'on_change') {
    return t((log.output ?? '') === '' ? 'flow.step.run.onChangeSame' : 'flow.step.run.onChangePassed');
  }
  if (step.type === 'youtube' && !(log.output ?? '').trim()) return t('flow.skill.youtube.run.noTranscript');
  return undefined;
}

import cron from 'node-cron';
import type { SchedulePreview, TriggerConfig } from '../../shared/types';
import {
  hasStructuredSchedule,
  isOnceExpired,
  normalizeCronTrigger,
  resolveScheduleMode,
  shouldExecuteCronTriggerNow,
} from '../../shared/flowSchedule';

/** The guard trims window edges, so ask for more candidates than we intend to show. */
const CANDIDATE_MULTIPLIER = 6;

/**
 * The preview asks the scheduler itself for its next fire times rather than recomputing them, so
 * what the editor promises and what actually runs cannot drift apart.
 */
export function previewSchedule(trigger: TriggerConfig, count = 3): SchedulePreview {
  if (trigger.type !== 'cron') return { runs: [], expression: '' };

  const normalized = hasStructuredSchedule(trigger) ? normalizeCronTrigger(trigger) : trigger;
  const expression = normalized.cronExpression ?? '';
  const mode = resolveScheduleMode(normalized);

  if (mode === 'once' && isOnceExpired(normalized)) {
    return { runs: [], expression, expired: true };
  }

  if (!expression || !cron.validate(expression)) {
    return { runs: [], expression, error: 'invalid-expression' };
  }

  const wanted = mode === 'once' ? 1 : count;
  let task: ReturnType<typeof cron.createTask> | null = null;
  try {
    task = cron.createTask(expression, () => {});
    const candidates = task.getNextRuns(wanted * CANDIDATE_MULTIPLIER) ?? [];
    const runs = candidates
      .filter((date) => shouldExecuteCronTriggerNow(normalized, date))
      .slice(0, wanted)
      .map((date) => date.toISOString());
    return { runs, expression };
  } catch {
    return { runs: [], expression, error: 'invalid-expression' };
  } finally {
    task?.destroy();
  }
}

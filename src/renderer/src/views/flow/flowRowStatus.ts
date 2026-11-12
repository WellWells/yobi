import type { FlowLastRun } from '../../../../shared/flowMetrics';
import { formatRunTime } from '../../../../shared/flowSchedule';
import { fillTemplate } from '../../../../shared/fillTemplate';

export interface FlowRowStatus {
  tone: 'error' | 'warning' | 'dimmed';
  text: string;
  /** Lines for the hover: the reason, then when. Empty when the line says it all. */
  detail: string[];
}

export interface FlowRowFacts {
  /** The latest run in the statistics; none when it has not run for a while or statistics are off. */
  last?: FlowLastRun;
  /** The next scheduled run of the saved, enabled flow. */
  next?: Date;
}

/**
 * The second line of a flow row: whether the flow is working. One fact, the first that holds —
 * the last run failed, it lost steps, when it runs next, when it last ran.
 */
export function flowRowStatus({ last, next }: FlowRowFacts, t: (key: string) => string): FlowRowStatus | null {
  const lastAt = last ? formatRunTime(t, new Date(last.at)) : '';
  if (last && last.outcome !== 'success') {
    return { tone: 'error', text: t('flow.row.lastFailed'), detail: [...(last.message ? [last.message] : []), lastAt] };
  }
  if (last?.degraded) {
    return { tone: 'warning', text: t('flow.row.lastDegraded'), detail: [...(last.message ? [last.message] : []), lastAt] };
  }
  if (next) return { tone: 'dimmed', text: fillTemplate(t('flow.row.nextRun'), { when: formatRunTime(t, next) }), detail: [] };
  if (last) return { tone: 'dimmed', text: fillTemplate(t('flow.row.lastRan'), { when: lastAt }), detail: [] };
  return null;
}

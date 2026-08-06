import type { QueueTaskItem } from '../../../shared/types';

export function queueProgressForRun(items: QueueTaskItem[], runId: string | undefined): string | undefined {
  if (!runId) return undefined;
  const item = items.find((i) => i.agentRunId === runId || i.clientToken === runId);
  return item?.progress;
}

/**
 * How many tasks sit ahead of this run while it is still queued, or -1 once it is running.
 * The queue is serial and a handful of enabled cron flows will happily fill it, so a run can
 * sit untouched for minutes — which looked exactly like a hung agent, because the bubble said
 * "thinking" either way.
 */
export function queueWaitAhead(items: QueueTaskItem[], runId: string | undefined): number {
  if (!runId) return -1;
  const index = items.findIndex((i) => i.agentRunId === runId || i.clientToken === runId);
  if (index < 0) return -1;
  return items[index].status === 'queued' ? index : -1;
}

import type { QueueTaskItem } from '../../../shared/types';

export function queueProgressForRun(items: QueueTaskItem[], runId: string | undefined): string | undefined {
  if (!runId) return undefined;
  const item = items.find((i) => i.agentRunId === runId || i.clientToken === runId);
  return item?.progress;
}

export function queueWaitAhead(items: QueueTaskItem[], runId: string | undefined): number {
  if (!runId) return -1;
  const index = items.findIndex((i) => i.agentRunId === runId || i.clientToken === runId);
  if (index < 0) return -1;
  return items[index].status === 'queued' ? index : -1;
}

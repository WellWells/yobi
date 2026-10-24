import type { QueueState, QueueTaskItem, Task } from '../shared/types';
import { compactPreview } from '../shared/textBudget';
import { markConversationBusy } from './conversationBusy';

type QueueListener = (state: QueueState) => void;

export class TaskHardTimeoutError extends Error {
  constructor(taskId: string, readonly timeoutMinutes: number) {
    super(`Task ${taskId} exceeded hard timeout of ${timeoutMinutes} min`);
    this.name = 'TaskHardTimeoutError';
  }
}

/**
 * The user stopped waiting for the running task. It rejects so the renderer gets exactly one
 * outcome; provider automation itself is not cancelled.
 */
export class TaskSkippedError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} was skipped by the user`);
    this.name = 'TaskSkippedError';
  }
}

export class QueueManager {
  private queue: Task[] = [];
  private running = false;
  private activeTask: Task | null = null;
  private listener: QueueListener | null = null;
  private discardListener: ((task: Task) => void) | null = null;
  private skipCurrentTask: (() => void) | null = null;
  private readonly busyReleases = new Map<Task, () => void>();
  private readonly TASK_HARD_TIMEOUT_MS = 10 * 60_000;

  private worker: (task: Task) => Promise<void>;
  private onTaskError: ((task: Task, err: unknown) => void) | null;

  constructor(worker: (task: Task) => Promise<void>, onTaskError?: (task: Task, err: unknown) => void) {
    this.worker = worker;
    this.onTaskError = onTaskError ?? null;
  }

  onUpdate(listener: QueueListener): void {
    this.listener = listener;
  }

  onDiscard(listener: (task: Task) => void): void {
    this.discardListener = listener;
  }

  enqueue(task: Task): void {
    // The conversation is busy from queued until its answer is written, which can be after the
    // queue has given up on the task (hard timeout, skip): it is released by the worker itself.
    if (task.conversationPath) this.busyReleases.set(task, markConversationBusy(task.conversationPath, 'sending'));
    this.queue.push(task);
    this.notify();
    this.drain();
  }

  private releaseBusy(task: Task): void {
    this.busyReleases.get(task)?.();
    this.busyReleases.delete(task);
  }

  cancel(taskId: string): boolean {
    const index = this.queue.findIndex((task) => task.id === taskId);
    if (index < 0) return false;
    const [discarded] = this.queue.splice(index, 1);
    if (discarded) this.releaseBusy(discarded);
    this.notify();
    if (discarded) this.discardListener?.(discarded);
    return true;
  }

  forceSkipActive(): boolean {
    if (!this.running || !this.skipCurrentTask) return false;
    this.skipCurrentTask();
    return true;
  }

  get size(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  getState(): QueueState {
    const items: QueueTaskItem[] = [];
    if (this.activeTask) {
      items.push({
        id: this.activeTask.id,
        promptSummary: summarizePrompt(this.activeTask.prompt),
        status: 'running',
      });
    }
    for (const task of this.queue) {
      items.push({
        id: task.id,
        promptSummary: summarizePrompt(task.prompt),
        status: 'queued',
      });
    }
    return {
      total: items.length,
      current: this.running ? 1 : 0,
      status: this.running ? 'processing' : 'idle',
      items,
    };
  }

  private notify(): void {
    if (!this.listener) return;
    this.listener(this.getState());
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running = true;
      this.activeTask = task;
      this.notify();
      try {
        let hardTimeoutId!: ReturnType<typeof setTimeout>;
        const hardTimeout = new Promise<void>((_, reject) => {
          hardTimeoutId = setTimeout(
            () => reject(new TaskHardTimeoutError(task.id, this.TASK_HARD_TIMEOUT_MS / 60_000)),
            this.TASK_HARD_TIMEOUT_MS,
          );
        });
        const skipSignal = new Promise<void>((_resolve, reject) => {
          this.skipCurrentTask = () => reject(new TaskSkippedError(task.id));
        });
        let work: Promise<void>;
        try {
          work = this.worker(task);
        } catch (err) {
          work = Promise.reject(err);
        }
        const release = () => this.releaseBusy(task);
        const settled = work.then(release, release);
        await Promise.race([work, hardTimeout, skipSignal]).finally(() => {
          clearTimeout(hardTimeoutId);
          this.skipCurrentTask = null;
          // A worker given up on that never settles must not hold its conversation for good.
          const fallback = setTimeout(release, this.TASK_HARD_TIMEOUT_MS);
          fallback.unref?.();
          void settled.then(() => clearTimeout(fallback));
        });
      } catch (err) {
        this.onTaskError?.(task, err);
      }
      this.running = false;
      this.activeTask = null;
      this.notify();
    }
  }
}

function summarizePrompt(prompt: string): string {
  return compactPreview(prompt, 96) || '(empty prompt)';
}

interface FlowQueueSource {
  getPendingQueueItems(): QueueTaskItem[];
}

/**
 * What the app is doing as a whole: the prompt queue plus the flow queue, where flows, /agent
 * and /search run. The title bar and the bot's /status both read this, so they cannot disagree.
 */
export function appQueueState(queue: Pick<QueueManager, 'getState'>, flows: FlowQueueSource | null): QueueState {
  const promptState = queue.getState();
  const flowItems = flows?.getPendingQueueItems() ?? [];
  if (flowItems.length === 0) return promptState;
  const items = [...promptState.items, ...flowItems];
  const anyRunning = items.some((item) => item.status === 'running');
  return {
    total: items.length,
    current: anyRunning ? 1 : 0,
    status: anyRunning ? 'processing' : 'idle',
    items,
  };
}

import type { QueueState, QueueTaskItem, Task } from '../shared/types';

type QueueListener = (state: QueueState) => void;

export class QueueManager {
  private queue: Task[] = [];
  private running = false;
  private activeTask: Task | null = null;
  private listener: QueueListener | null = null;
  private skipCurrentTask: (() => void) | null = null;
  private readonly TASK_HARD_TIMEOUT_MS = 10 * 60_000;

  private worker: (task: Task) => Promise<void>;

  constructor(worker: (task: Task) => Promise<void>) {
    this.worker = worker;
  }

  onUpdate(listener: QueueListener): void {
    this.listener = listener;
  }

  enqueue(task: Task): void {
    this.queue.push(task);
    this.notify();
    this.drain();
  }

  cancel(taskId: string): boolean {
    const index = this.queue.findIndex((task) => task.id === taskId);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    this.notify();
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
            () => reject(new Error(`Task ${task.id} exceeded hard timeout of ${this.TASK_HARD_TIMEOUT_MS / 60_000} min`)),
            this.TASK_HARD_TIMEOUT_MS,
          );
        });
        const skipSignal = new Promise<void>((resolve) => {
          this.skipCurrentTask = resolve;
        });
        await Promise.race([this.worker(task), hardTimeout, skipSignal]).finally(() => {
          clearTimeout(hardTimeoutId);
          this.skipCurrentTask = null;
        });
      } catch {
      }
      this.running = false;
      this.activeTask = null;
      this.notify();
    }
  }
}

function summarizePrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (!compact) return '(empty prompt)';
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact;
}

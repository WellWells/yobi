import type { QueueTaskItem } from '../../shared/types';
import { Semaphore } from './lanes';

const MAX_CONCURRENT_FLOWS = 1;

interface PendingEntry {
  id: string;
  name: string;
  status: 'running' | 'queued';
  flowId?: string;
  agentRunId?: string;
  clientToken?: string;
  progress?: string;
  cancel: () => void;
}

export class FlowQueue {
  private readonly slots: Semaphore;
  private pending: PendingEntry[] = [];
  private cancelled = new Set<string>();
  private onChange: (() => void) | null = null;

  constructor(maxConcurrency: number = MAX_CONCURRENT_FLOWS) {
    this.slots = new Semaphore(maxConcurrency);
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  getPendingItems(): QueueTaskItem[] {
    return this.pending.map((item) => ({
      id: item.id,
      promptSummary: item.name,
      status: item.status,
      progress: item.progress,
      agentRunId: item.agentRunId,
      clientToken: item.clientToken,
    }));
  }

  setProgress(taskId: string, progress: string): void {
    const idx = this.pending.findIndex((e) => e.id === taskId);
    if (idx < 0) return;
    this.pending[idx] = { ...this.pending[idx], progress };
    this.onChange?.();
  }

  cancelQueued(taskId: string): boolean {
    const entry = this.pending.find((e) => e.id === taskId);
    if (!entry || entry.status !== 'queued' || this.cancelled.has(taskId)) return false;
    this.cancelled.add(taskId);
    this.removeEntry(taskId);
    entry.cancel();
    return true;
  }

  cancelQueuedForFlow(flowId: string): boolean {
    let cancelledAny = false;
    for (const entry of [...this.pending]) {
      if (entry.status === 'queued' && entry.flowId === flowId && !this.cancelled.has(entry.id)) {
        this.cancelled.add(entry.id);
        this.removeEntry(entry.id);
        entry.cancel();
        cancelledAny = true;
      }
    }
    if (cancelledAny) this.onChange?.();
    return cancelledAny;
  }

  enqueue<T>(
    taskId: string,
    name: string,
    run: () => Promise<T>,
    makeErrorResult: (err: unknown) => T,
    flowId?: string,
    agentRunId?: string,
    clientToken?: string,
  ): Promise<T> {
    let resolveResult!: (result: T) => void;
    const resultPromise = new Promise<T>((res) => { resolveResult = res; });

    this.pending.push({
      id: taskId,
      name,
      status: 'queued',
      flowId,
      agentRunId,
      clientToken,
      cancel: () => resolveResult(makeErrorResult(new Error('Cancelled by user'))),
    });
    this.onChange?.();

    void this.slots.acquire().then(async () => {
      if (this.cancelled.has(taskId)) {
        this.cancelled.delete(taskId);
        this.removeEntry(taskId);
        resolveResult(makeErrorResult(new Error('Cancelled by user')));
        this.slots.release();
        return;
      }
      this.markRunning(taskId);
      try {
        resolveResult(await run());
      } catch (err) {
        resolveResult(makeErrorResult(err));
      } finally {
        this.removeEntry(taskId);
        this.slots.release();
      }
    });

    return resultPromise;
  }

  private markRunning(taskId: string): void {
    const idx = this.pending.findIndex((e) => e.id === taskId);
    if (idx >= 0) {
      this.pending[idx] = { ...this.pending[idx], status: 'running' };
      this.onChange?.();
    }
  }

  private removeEntry(taskId: string): void {
    const idx = this.pending.findIndex((e) => e.id === taskId);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      this.onChange?.();
    }
  }
}

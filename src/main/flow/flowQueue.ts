import type { QueueTaskItem } from '../../shared/types';
import { Semaphore } from './lanes';

/**
 * Two, not more, on purpose. Everything that cannot overlap is behind a lane (`llmLane`,
 * `clipboardLane`, `pageFetchLane`, `youtubeLane`), so the limit is machine resources: each
 * concurrent flow can hold a hidden Chromium window open. Raise it only after watching memory on a
 * low-end machine.
 */
const MAX_CONCURRENT_FLOWS = 2;

/**
 * External tasks (`/agent`, `/search`) hold a shared slot AND this one, so at most one of them runs
 * at a time and a long agent run can never take every slot from cron, hotkey, UI and bot-command flows.
 */
const MAX_CONCURRENT_EXTERNAL = 1;

/**
 * Flows Yobi runs itself for a pasted YouTube or X link: someone in a chat is waiting on the
 * reply, and the work is a download, not a model. They take neither shared slot, so a slow
 * scheduled flow never holds a download back; anything they touch that cannot
 * overlap is still behind its lane. Their own cap keeps a burst of pasted links from starting a
 * download process each.
 */
const MAX_CONCURRENT_BUILTIN = 3;

/** Which slots a task takes: the shared pool, the external lane and then the shared pool, or the built-ins' own. */
export type QueuePool = 'shared' | 'external' | 'builtin';

/** The error a task removed from the queue before it started resolves with. */
export const QUEUE_CANCELLED = 'Cancelled by user';

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
  private readonly externalSlots = new Semaphore(MAX_CONCURRENT_EXTERNAL);
  private readonly builtinSlots = new Semaphore(MAX_CONCURRENT_BUILTIN);
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

  /** Whether a run of this flow is waiting or in progress. */
  hasFlow(flowId: string): boolean {
    return this.pending.some((e) => e.flowId === flowId && !this.cancelled.has(e.id));
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
    pool: QueuePool = 'shared',
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
      cancel: () => resolveResult(makeErrorResult(new Error(QUEUE_CANCELLED))),
    });
    this.onChange?.();

    void (async () => {
      // The external slot is taken FIRST and released LAST, so a queued external task waits
      // outside the shared pool instead of sitting on a slot while it waits for its own lane.
      if (pool === 'external') await this.externalSlots.acquire();
      const slots = pool === 'builtin' ? this.builtinSlots : this.slots;
      await slots.acquire();
      try {
        if (this.cancelled.has(taskId)) {
          this.cancelled.delete(taskId);
          this.removeEntry(taskId);
          resolveResult(makeErrorResult(new Error(QUEUE_CANCELLED)));
          return;
        }
        this.markRunning(taskId);
        try {
          resolveResult(await run());
        } catch (err) {
          resolveResult(makeErrorResult(err));
        } finally {
          this.removeEntry(taskId);
        }
      } finally {
        slots.release();
        if (pool === 'external') this.externalSlots.release();
      }
    })();

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

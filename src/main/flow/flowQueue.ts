import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueueTaskItem } from '../../shared/types';
import { Semaphore } from './lanes';

/**
 * Two, not more, on purpose. Everything that cannot overlap is behind a lane (`llmLane`,
 * `clipboardLane`, `pageFetchLane`, `youtubeLane`), so the limit is machine resources: each
 * concurrent flow can hold a hidden Chromium window open. Raise it only after watching memory on a
 * low-end machine. A run waiting for or talking to the model lends its slot (`yieldRunSlot`).
 */
const MAX_CONCURRENT_FLOWS = 2;

/**
 * External tasks (`/agent`, `/search`, `/image`) have their own slots and take no shared one, so a
 * long agent run never holds back cron, hotkey, UI and bot-command flows. The model is one at a
 * time behind `llmLane` anyway; the cap is for the pages and memory each run can hold, which is why
 * they do not lend it while they wait for the model. Within one conversation they run one after
 * another (`conversation`), so a second question is asked with the first answer already there.
 */
const MAX_CONCURRENT_EXTERNAL = 3;

/**
 * Flows Yobi runs itself for a pasted post or video link: someone in a chat is waiting on the
 * reply. They take neither shared slot, so a slow scheduled flow never holds a download back;
 * anything they touch that cannot overlap is still behind its lane. Their own cap keeps a burst of
 * pasted links from starting a download process each; an analysis waiting for the model lends its
 * slot, so it never keeps a download behind it.
 */
const MAX_CONCURRENT_BUILTIN = 3;

/**
 * The slot a run holds, which it can lend back to its pool while it waits for or talks to the
 * model: that work uses the one AI worker (or a BYOK request), not a window or download of the
 * run's own. Every change of hands runs one at a time on `turn`, so a lend, a take-back and the
 * end of the run never interleave and each slot is released exactly once.
 */
class RunSlot {
  private held = true;
  private lent = 0;
  private done = false;
  private turn: Promise<void> = Promise.resolve();

  constructor(private readonly slots: Semaphore) {}

  async lendDuring<T>(work: () => Promise<T>): Promise<T> {
    if (this.lent++ === 0) await this.inTurn(() => this.giveBack());
    try {
      return await work();
    } finally {
      if (--this.lent === 0) await this.inTurn(() => this.takeBack());
    }
  }

  /**
   * The run is over: its slot goes back, now or, if it is lent and being taken back, as soon as
   * that take-back is granted. Not awaited, so a stopped run never waits for a slot to end.
   */
  finish(): void {
    this.done = true;
    void this.inTurn(() => this.giveBack());
  }

  private inTurn(change: () => void | Promise<void>): Promise<void> {
    const next = this.turn.then(change);
    this.turn = next.catch(() => undefined);
    return next;
  }

  private giveBack(): void {
    if (!this.held) return;
    this.held = false;
    this.slots.release();
  }

  private async takeBack(): Promise<void> {
    if (this.held || this.lent > 0 || this.done) return;
    // Ahead of runs not yet started: finishing what is halfway keeps the number in flight down.
    await this.slots.acquire(undefined, true);
    // Stopped while waiting: the run already ended, so the slot it was given goes straight back.
    if (this.done) this.slots.release();
    else this.held = true;
  }
}

const currentRunSlot = new AsyncLocalStorage<RunSlot | undefined>();

/**
 * Runs `work` (a wait for the model and the request itself) without the shared or built-in queue
 * slot of the run it belongs to, and takes the slot back before the run goes on. An external task
 * lends nothing (see `MAX_CONCURRENT_EXTERNAL`). Outside a queued run it just runs.
 */
export function yieldRunSlot<T>(work: () => Promise<T>): Promise<T> {
  const slot = currentRunSlot.getStore();
  return slot ? slot.lendDuring(work) : work();
}

/** Which slots a task takes: the shared pool, the external tasks' own, or the built-ins' own. */
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
  /** One external task at a time per conversation; an entry lives while a task holds or waits for it. */
  private readonly conversations = new Map<string, { turn: Semaphore; users: number }>();
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
    conversation?: string,
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
      // The conversation's turn comes first, so a later question there waits without a slot.
      const leaveConversation = pool === 'external' && conversation ? await this.enterConversation(conversation) : null;
      const slots = pool === 'builtin' ? this.builtinSlots : pool === 'external' ? this.externalSlots : this.slots;
      await slots.acquire();
      const slot = new RunSlot(slots);
      try {
        if (this.cancelled.has(taskId)) {
          this.cancelled.delete(taskId);
          this.removeEntry(taskId);
          resolveResult(makeErrorResult(new Error(QUEUE_CANCELLED)));
          return;
        }
        this.markRunning(taskId);
        try {
          // Set for every run (none for an external task), so a run started from inside another
          // never lends its caller's slot.
          resolveResult(await currentRunSlot.run(pool === 'external' ? undefined : slot, run));
        } catch (err) {
          resolveResult(makeErrorResult(err));
        } finally {
          this.removeEntry(taskId);
        }
      } finally {
        slot.finish();
        leaveConversation?.();
      }
    })();

    return resultPromise;
  }

  /** Waits for the conversation's turn; the returned function ends it. */
  private async enterConversation(key: string): Promise<() => void> {
    let entry = this.conversations.get(key);
    if (!entry) {
      entry = { turn: new Semaphore(1), users: 0 };
      this.conversations.set(key, entry);
    }
    entry.users++;
    const held = entry;
    await held.turn.acquire();
    return () => {
      held.turn.release();
      if (--held.users === 0) this.conversations.delete(key);
    };
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

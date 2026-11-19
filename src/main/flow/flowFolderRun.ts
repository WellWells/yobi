import type { FlowDefinition, FlowExecutionResult } from '../../shared/types';
import { folderKey } from '../../shared/conversationFolders';
import { batchSkipReason, planFlowBatch } from '../../shared/flowFolderRun';
import type { FlowFolderRunStartResult, FlowFolderRunState } from '../../shared/flowFolderRun';

/*
 * 「全部執行」 on a flow category. One flow at a time, in the category's order: a batch never
 * holds both shared run slots, so a schedule that comes due meanwhile still runs, and the messages
 * the flows send arrive in the order the user sees them listed. A failure does not stop the rest
 * (iOS Shortcuts stops at the first error; here each flow is its own job). It runs the saved flows
 * — the editor's unsaved changes are never saved for it — and lives in main, so it keeps going
 * when the window changes view. Stop ends the one running and drops the rest.
 */

export interface FlowFolderRunDeps {
  /** The category's flows in its order; null = no such category. */
  folderFlows: (folder: string) => Promise<FlowDefinition[] | null>;
  /** The saved flow now; undefined = deleted. */
  flowById: (flowId: string) => FlowDefinition | undefined;
  /** Running or waiting in the queue. */
  isBusy: (flowId: string) => boolean;
  /** One run through the flow queue; `signal` stops it, queued or running. */
  run: (flowId: string, signal: AbortSignal) => Promise<FlowExecutionResult>;
  broadcast: (states: FlowFolderRunState[]) => void;
  /** The batch ended by itself (not stopped): one notice for all of it. */
  notifyDone: (state: FlowFolderRunState) => void;
  log: (line: string) => void;
}

interface ActiveBatch {
  state: FlowFolderRunState;
  stop: AbortController;
}

export class FlowFolderRunner {
  private readonly batches = new Map<string, ActiveBatch>();

  constructor(private readonly deps: FlowFolderRunDeps) {}

  /** The batches running now. */
  list(): FlowFolderRunState[] {
    return [...this.batches.values()].map((batch) => ({ ...batch.state }));
  }

  async start(folder: string): Promise<FlowFolderRunStartResult> {
    const key = folderKey(folder);
    if (this.batches.has(key)) return { ok: false, reason: 'running' };
    const flows = await this.deps.folderFlows(folder);
    if (!flows) return { ok: false, reason: 'unknownFolder' };
    // Checked again after the await: two clicks in a row must not start two batches.
    if (this.batches.has(key)) return { ok: false, reason: 'running' };
    const plan = planFlowBatch(flows, this.deps.isBusy);
    if (plan.run.length === 0) return { ok: false, reason: 'nothing' };
    const state: FlowFolderRunState = {
      folder, flowIds: plan.run, done: 0, succeeded: [], failed: [], skipped: [], finished: false, stopped: false,
    };
    const batch: ActiveBatch = { state, stop: new AbortController() };
    this.batches.set(key, batch);
    this.deps.log(`▶️ [Flow] Running category "${folder}": ${plan.run.length} flow(s), ${plan.skipped.length} left out`);
    this.publish();
    void this.drive(key, batch);
    return { ok: true, state: { ...state } };
  }

  /** Stops the category's batch: the flow running now ends, the rest do not start. */
  stop(folder: string): boolean {
    const batch = this.batches.get(folderKey(folder));
    if (!batch || batch.stop.signal.aborted) return false;
    batch.state.stopped = true;
    batch.stop.abort();
    this.deps.log(`⏹️ [Flow] Stopped running category "${folder}"`);
    this.publish();
    return true;
  }

  /** Every batch, at shutdown. */
  stopAll(): void {
    for (const batch of this.batches.values()) {
      batch.state.stopped = true;
      batch.stop.abort();
    }
  }

  private async drive(key: string, batch: ActiveBatch): Promise<void> {
    const { state, stop } = batch;
    try {
      for (const flowId of state.flowIds) {
        if (stop.signal.aborted) break;
        // Judged again when its turn comes: switched off, deleted, or started by its schedule
        // while the ones before it ran.
        const flow = this.deps.flowById(flowId);
        if (!flow || batchSkipReason(flow, this.deps.isBusy(flowId))) {
          state.skipped.push(flowId);
          state.done += 1;
          this.publish();
          continue;
        }
        state.currentFlowId = flowId;
        this.publish();
        let result: FlowExecutionResult | null = null;
        try {
          result = await this.deps.run(flowId, stop.signal);
        } catch (err: unknown) {
          this.deps.log(`⚠️ [Flow] Category run: "${flow.name}" threw: ${err instanceof Error ? err.message : String(err)}`);
        }
        delete state.currentFlowId;
        // A run a stop ended is neither a success nor a failure of the flow: the batch's stop ends
        // the batch; that one flow's own stop (its card, the run panel) only leaves it out.
        if (result?.aborted && stop.signal.aborted) break;
        if (result?.aborted) state.skipped.push(flowId);
        else if (result?.success) state.succeeded.push(flowId);
        else state.failed.push(flowId);
        state.done += 1;
        this.publish();
      }
    } finally {
      delete state.currentFlowId;
      state.finished = true;
      this.batches.delete(key);
      this.deps.log(`🏁 [Flow] Category "${state.folder}" ${state.stopped ? 'stopped' : 'done'}: ${state.succeeded.length} ok, ${state.failed.length} failed, ${state.skipped.length} skipped`);
      this.publish([state]);
      // Nothing ran (each was left out when its turn came): nothing to report.
      if (!state.stopped && state.succeeded.length + state.failed.length > 0) this.deps.notifyDone({ ...state });
    }
  }

  /** `ended`: batches that just finished, sent once more so the window sees how they ended. */
  private publish(ended: FlowFolderRunState[] = []): void {
    this.deps.broadcast([...this.list(), ...ended.map((state) => ({ ...state }))]);
  }
}

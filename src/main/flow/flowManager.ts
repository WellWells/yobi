import type {
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  FlowGenerationResult,
  QueueTaskItem,
} from '../../shared/types';
import { executeFlow } from './executor';
import { closeRunPages } from './skills/browserPages';
import { generateFlowDefinition } from './flowGenerator';
import type { FlowExecutorDeps } from './types';
import { getWorkerAttention, sendLog, sendToRenderer, sendWebNotification } from '../helpers';
import { config } from '../config';
import { getLangCache, t } from '../i18n';
import { classifyFailure, recordTaskOutcome } from '../metrics';
import { IPC, BOT_COMMAND_RE } from '../../shared/types';
import { normalizeCronTrigger, shouldNormalizeCronTrigger } from '../../shared/flowSchedule';
import { cloneFlowVariables, missingRequiredVariables, sanitizeFlowVariables } from '../../shared/flowVariables';
import { createEntityId, loadFlowsFromDisk, saveFlowsToDisk } from './flowPersistence';
import { pruneOrphanCheckpoints } from './checkpoint';
import { FlowTriggerRegistry } from './flowTriggers';
import { FlowQueue } from './flowQueue';
import { llmLane } from './lanes';

export interface FlowBotCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
}

type FlowExecutionSource = 'ui' | 'bot' | 'system' | 'chat';

export class FlowManager {
  private flows: FlowDefinition[] = [];
  private deps: FlowExecutorDeps;
  private _running = new Set<string>();
  private _abortControllers = new Map<string, AbortController>();
  private _onBotCommandsChanged: (() => void) | null = null;
  private triggers = new FlowTriggerRegistry((flowId) => {
    void this.queueExecution(flowId);
  });
  private queue = new FlowQueue();

  constructor(deps: FlowExecutorDeps) {
    this.deps = deps;
  }

  async init(): Promise<void> {
    const loadedFlows = await loadFlowsFromDisk();
    this.flows = loadedFlows.map((flow) => this.normalizeFlow(flow));
    if (JSON.stringify(this.flows) !== JSON.stringify(loadedFlows)) {
      await saveFlowsToDisk(this.flows);
    }
    this.triggers.registerAll(this.flows);
    if (this.flows.length > 0) this.pruneCheckpoints();
    sendLog(`📋 [Flow] Loaded ${this.flows.length} flow(s)`);
  }

  shutdown(): void {
    this.triggers.unregisterAll(this.flows);
    sendLog('🛑 [Flow] Shut down — all triggers unregistered');
  }

  private pruneCheckpoints(): void {
    const activeStepIds = new Set<string>();
    for (const flow of this.flows) {
      for (const step of flow.steps) activeStepIds.add(step.id);
    }
    void pruneOrphanCheckpoints(activeStepIds);
  }

  async reload(): Promise<void> {
    this.triggers.unregisterAll(this.flows);
    const loadedFlows = await loadFlowsFromDisk();
    this.flows = loadedFlows.map((flow) => this.normalizeFlow(flow));
    if (JSON.stringify(this.flows) !== JSON.stringify(loadedFlows)) {
      await saveFlowsToDisk(this.flows);
    }
    this.triggers.registerAll(this.flows);
    this._onBotCommandsChanged?.();
    sendLog(`📋 [Flow] Reloaded ${this.flows.length} flow(s) from disk`);
  }

  getAll(): FlowDefinition[] {
    return this.flows;
  }

  getExecutorDeps(): FlowExecutorDeps {
    return this.deps;
  }

  getBotCommands(): FlowBotCommandDef[] {
    const seen = new Set<string>();
    const commands: FlowBotCommandDef[] = [];
    for (const f of this.flows) {
      if (!f.enabled) continue;
      for (const trigger of [f.trigger, ...(f.extraTriggers ?? [])]) {
        if (trigger.type !== 'bot') continue;
        const command = (trigger.botCommand ?? '').toLowerCase().trim();
        if (!command) continue;
        if (!BOT_COMMAND_RE.test(command)) {
          sendLog(`⚠️ [Flow] Bot command "/${command}" is invalid (must start with a letter, ≤32 chars, a–z/0–9/_) — skipping "${f.name}"`);
          continue;
        }
        if (seen.has(command)) {
          sendLog(`⚠️ [Flow] Bot command "/${command}" is used more than once — keeping the first, skipping "${f.name}"`);
          continue;
        }
        seen.add(command);
        commands.push({
          flowId: f.id,
          command,
          description: trigger.botCommandDescription ?? '',
          inputVariable: trigger.botInputVariable?.trim() || 'input',
        });
      }
    }
    return commands;
  }

  private flowHasBotTrigger(flow: FlowDefinition): boolean {
    return [flow.trigger, ...(flow.extraTriggers ?? [])].some((t) => t.type === 'bot');
  }

  getChatCommandInfo(flowId: string, command?: string): { command: string; inputVariable: string } | null {
    const flow = this.flows.find((f) => f.id === flowId);
    if (!flow) return null;
    const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])].filter((t) => t.type === 'chat');
    if (triggers.length === 0) return null;
    const wanted = (command ?? '').toLowerCase().trim();
    const trigger = (wanted && triggers.find((t) => (t.chatCommand ?? '').toLowerCase().trim() === wanted)) || triggers[0];
    return {
      command: (trigger.chatCommand ?? '').toLowerCase().trim(),
      inputVariable: trigger.chatInputVariable?.trim() || 'input',
    };
  }

  private gateEnabled(flow: FlowDefinition): FlowDefinition {
    if (!flow.enabled) return flow;
    const missing = missingRequiredVariables(flow);
    if (missing.length === 0) return flow;
    const names = missing.map((v) => v.label || v.key).join(', ');
    sendLog(`🚫 [Flow] Flow "${flow.name}" cannot be enabled — missing required settings: ${names}`);
    return { ...flow, enabled: false };
  }

  async save(flow: FlowDefinition): Promise<FlowDefinition> {
    const normalizedFlow = this.gateEnabled(this.normalizeFlow(flow));
    const idx = this.flows.findIndex((f) => f.id === flow.id);
    normalizedFlow.updatedAt = new Date().toISOString();
    const hadBotTrigger = idx >= 0 ? this.flowHasBotTrigger(this.flows[idx]) : false;

    if (idx >= 0) {
      this.triggers.unregister(this.flows[idx]);
      this.flows[idx] = normalizedFlow;
    } else {
      normalizedFlow.createdAt = normalizedFlow.createdAt || new Date().toISOString();
      this.flows.push(normalizedFlow);
    }

    if (normalizedFlow.enabled) {
      this.triggers.register(normalizedFlow);
    }

    await saveFlowsToDisk(this.flows);

    if (this.flowHasBotTrigger(normalizedFlow) || hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }

    this.pruneCheckpoints();
    return normalizedFlow;
  }

  async delete(flowId: string): Promise<boolean> {
    const idx = this.flows.findIndex((f) => f.id === flowId);
    if (idx < 0) return false;
    const hadBotTrigger = this.flowHasBotTrigger(this.flows[idx]);
    this.triggers.unregister(this.flows[idx]);
    this.flows.splice(idx, 1);
    await saveFlowsToDisk(this.flows);
    if (hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }
    this.pruneCheckpoints();
    return true;
  }

  async deleteMany(flowIds: string[]): Promise<boolean> {
    const idSet = new Set(flowIds);
    const removed = this.flows.filter((f) => idSet.has(f.id));
    if (removed.length === 0) return false;
    let hadBotTrigger = false;
    for (const flow of removed) {
      if (this.flowHasBotTrigger(flow)) hadBotTrigger = true;
      this.triggers.unregister(flow);
    }
    this.flows = this.flows.filter((f) => !idSet.has(f.id));
    await saveFlowsToDisk(this.flows);
    if (hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }
    this.pruneCheckpoints();
    return true;
  }

  async setEnabledMany(flowIds: string[], enabled: boolean): Promise<FlowDefinition[]> {
    const idSet = new Set(flowIds);
    let hadBotTrigger = false;
    for (const flow of this.flows) {
      if (!idSet.has(flow.id) || flow.enabled === enabled) continue;
      const missing = enabled ? missingRequiredVariables(flow) : [];
      if (missing.length > 0) {
        const names = missing.map((v) => v.label || v.key).join(', ');
        sendLog(`🚫 [Flow] Flow "${flow.name}" cannot be enabled — missing required settings: ${names}`);
        continue;
      }
      this.triggers.unregister(flow);
      flow.enabled = enabled;
      flow.updatedAt = new Date().toISOString();
      if (enabled) this.triggers.register(flow);
      if (this.flowHasBotTrigger(flow)) hadBotTrigger = true;
    }
    await saveFlowsToDisk(this.flows);
    if (hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }
    return this.flows;
  }

  async duplicate(flowId: string): Promise<FlowDefinition | null> {
    const idx = this.flows.findIndex((f) => f.id === flowId);
    if (idx < 0) return null;
    const source = this.flows[idx];
    const duplicated: FlowDefinition = {
      ...source,
      id: createEntityId(),
      enabled: false,
      trigger: {
        ...source.trigger,
        weekdays: source.trigger.weekdays ? [...source.trigger.weekdays] : undefined,
      },
      extraTriggers: source.extraTriggers?.map((tr) => ({
        ...tr,
        weekdays: tr.weekdays ? [...tr.weekdays] : undefined,
      })),
      variables: cloneFlowVariables(source.variables),
      steps: source.steps.map((step) => ({
        ...step,
        id: createEntityId(),
        config: { ...step.config },
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.flows.splice(idx + 1, 0, duplicated);
    await saveFlowsToDisk(this.flows);
    return duplicated;
  }

  async move(flowId: string, direction: 'up' | 'down'): Promise<FlowDefinition[]> {
    const idx = this.flows.findIndex((f) => f.id === flowId);
    if (idx < 0) return this.flows;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= this.flows.length) return this.flows;
    [this.flows[idx], this.flows[targetIdx]] = [this.flows[targetIdx], this.flows[idx]];
    await saveFlowsToDisk(this.flows);
    return this.flows;
  }

  async reorder(orderedIds: string[]): Promise<FlowDefinition[]> {
    const byId = new Map(this.flows.map((f) => [f.id, f]));
    const next: FlowDefinition[] = [];
    for (const id of orderedIds) {
      const flow = byId.get(id);
      if (flow) { next.push(flow); byId.delete(id); }
    }
    for (const flow of this.flows) {
      if (byId.has(flow.id)) next.push(flow);
    }
    this.flows.splice(0, this.flows.length, ...next);
    await saveFlowsToDisk(this.flows);
    return this.flows;
  }

  setQueueChangeCallback(cb: () => void): void {
    this.queue.setOnChange(cb);
  }

  setOnBotCommandsChanged(cb: () => void): void {
    this._onBotCommandsChanged = cb;
  }

  getPendingQueueItems(): QueueTaskItem[] {
    return this.queue.getPendingItems();
  }

  enqueueExternalTask<T>(
    name: string,
    run: (taskId: string) => Promise<T>,
    makeErrorResult: (err: unknown) => T,
    agentRunId?: string,
    clientToken?: string,
  ): Promise<T> {
    const taskId = createEntityId();
    return this.queue.enqueue(taskId, name, () => run(taskId), makeErrorResult, undefined, agentRunId, clientToken);
  }

  setQueueTaskProgress(taskId: string, progress: string): void {
    this.queue.setProgress(taskId, progress);
  }

  cancelQueuedTask(taskId: string): boolean {
    return this.queue.cancelQueued(taskId);
  }

  private failureResult(flowId: string, error: string, totalSteps: number): FlowExecutionResult {
    return {
      flowId,
      success: false,
      outputs: {},
      error,
      completedSteps: 0,
      totalSteps,
      completedAt: new Date().toISOString(),
    };
  }

  private createQueueExecution(
    flowId: string,
    extraContext?: Record<string, string>,
    source: FlowExecutionSource = 'ui',
  ): { taskId: string; result: Promise<FlowExecutionResult> } {
    const flow = this.flows.find((f) => f.id === flowId);
    const taskId = createEntityId();
    if (!flow) {
      return { taskId, result: Promise.resolve(this.failureResult(flowId, 'Flow not found', 0)) };
    }

    const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
    const isBotOnly = triggers.length > 0 && triggers.every((tr) => tr.type === 'bot');
    if (isBotOnly && source !== 'bot') {
      sendLog(`🚫 [Flow] Flow "${flow.name}" requires a bot trigger — skipped (source: ${source})`);
      return {
        taskId,
        result: Promise.resolve(
          this.failureResult(flowId, 'Bot trigger flows must be invoked from Telegram or LINE', flow.steps.length),
        ),
      };
    }

    const missing = missingRequiredVariables(flow);
    if (missing.length > 0) {
      const names = missing.map((v) => v.label || v.key).join(', ');
      sendLog(`🚫 [Flow] Flow "${flow.name}" is missing required settings: ${names}`);
      return {
        taskId,
        result: Promise.resolve(this.failureResult(
          flowId,
          t(getLangCache(), 'flow.variables.missingRequired', { names }),
          flow.steps.length,
        )),
      };
    }

    const result = this.queue.enqueue(
      taskId,
      `[Flow] ${flow.name || flowId}`,
      () => this.execute(flowId, extraContext),
      (err) => this.failureResult(
        flowId,
        err instanceof Error ? err.message : String(err),
        flow.steps.length,
      ),
      flowId,
    );
    return { taskId, result };
  }

  async queueExecution(
    flowId: string,
    extraContext?: Record<string, string>,
    source: FlowExecutionSource = 'ui',
  ): Promise<FlowExecutionResult> {
    return this.createQueueExecution(flowId, extraContext, source).result;
  }

  queueExecutionWithId(
    flowId: string,
    extraContext?: Record<string, string>,
    source: FlowExecutionSource = 'ui',
  ): { taskId: string; result: Promise<FlowExecutionResult> } {
    return this.createQueueExecution(flowId, extraContext, source);
  }

  async saveGeneratedFlow(candidate: FlowDefinition): Promise<FlowDefinition> {
    const now = new Date().toISOString();
    const saved = await this.save({
      ...candidate,
      id: createEntityId(),
      enabled: false,
      steps: candidate.steps.map((step) => ({ ...step, id: createEntityId() })),
      createdAt: now,
      updatedAt: now,
    });
    sendToRenderer(IPC.FLOW_CREATED, saved);
    return saved;
  }

  async queueGeneration(description: string, queueLabel = 'AI Flow'): Promise<FlowGenerationResult> {
    const taskId = createEntityId();
    return this.queue.enqueue<FlowGenerationResult>(
      taskId,
      `[Flow] ${queueLabel}`,
      async () => {
        try {
          const outcome = await generateFlowDefinition(description, this.deps);
          if (!outcome.ok) return outcome;
          const saved = await this.saveGeneratedFlow(outcome.flow);
          return { ok: true, flow: saved };
        } finally {
          this.blankWorkerWhenIdle();
        }
      },
      (err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  }

  private blankWorkerWhenIdle(): void {
    void llmLane.runExclusive(async () => {
      if (this._running.size !== 0 || getWorkerAttention() !== 'idle') return;
      const workerWin = this.deps.getWorkerWin();
      if (workerWin && !workerWin.isDestroyed()) {
        void workerWin.webContents.loadURL('about:blank').catch(() => { });
      }
    });
  }

  abort(flowId: string): boolean {
    const removedFromQueue = this.queue.cancelQueuedForFlow(flowId);
    const controller = this._abortControllers.get(flowId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      sendLog(`⏹️ [Flow] Abort requested for running flow: ${flowId}`);
      return true;
    }
    if (removedFromQueue) {
      sendLog(`⏹️ [Flow] Removed queued flow (not yet running): ${flowId}`);
    }
    return removedFromQueue;
  }

  async execute(flowId: string, extraContext?: Record<string, string>): Promise<FlowExecutionResult> {
    const flow = this.flows.find((f) => f.id === flowId);
    if (!flow) {
      return this.failureResult(flowId, 'Flow not found', 0);
    }

    if (this._running.has(flowId)) {
      return this.failureResult(flowId, 'Flow is already running', flow.steps.length);
    }

    this._running.add(flowId);
    const controller = new AbortController();
    this._abortControllers.set(flowId, controller);
    const event: FlowExecutionEvent = { flowId, name: flow.name };
    sendToRenderer(IPC.FLOW_EXECUTION_STARTED, event);

    try {
      const onLog = (log: FlowExecutionLog): void => {
        sendToRenderer(IPC.FLOW_EXECUTION_LOG, log);
      };
      const result = await executeFlow(flow, this.deps, onLog, extraContext, controller.signal);
      this.recordRunMetrics(result);
      this.notifyRunOutcome(flow, result);
      return result;
    } finally {
      closeRunPages(flowId);
      this._abortControllers.delete(flowId);
      this._running.delete(flowId);
      sendToRenderer(IPC.FLOW_EXECUTION_ENDED, { flowId, name: flow.name } satisfies FlowExecutionEvent);
      this.blankWorkerWhenIdle();
    }
  }

  private recordRunMetrics(result: FlowExecutionResult): void {
    if (result.aborted) return;
    recordTaskOutcome('flow', result.success ? 'success' : classifyFailure(result.error));
  }

  private notifyRunOutcome(flow: FlowDefinition, result: FlowExecutionResult): void {
    if (result.aborted) return;
    const strings = getLangCache();
    if (result.success && config.notifyEvents.flowSuccess) {
      sendWebNotification(
        t(strings, 'notify.flow.success.title'),
        t(strings, 'notify.flow.success.body', { flow: flow.name }),
        'success',
      );
    } else if (!result.success && config.notifyEvents.flowFailure) {
      const compactError = (result.error ?? '').replace(/\s+/g, ' ').trim();
      const displayError = compactError.length > 90 ? `${compactError.slice(0, 90)}…` : compactError;
      sendWebNotification(
        t(strings, 'notify.flow.failure.title'),
        t(strings, 'notify.flow.failure.body', { flow: flow.name, error: displayError }),
        'error',
      );
    }
  }

  private normalizeFlow(flow: FlowDefinition): FlowDefinition {
    const triggerNeedsNorm = shouldNormalizeCronTrigger(flow.trigger);
    const extra = flow.extraTriggers;
    const extraNeedsNorm = Array.isArray(extra) && extra.some(shouldNormalizeCronTrigger);
    const rawVariables = flow.variables;
    const variables = sanitizeFlowVariables(rawVariables);
    const variablesNeedNorm = rawVariables !== undefined
      && JSON.stringify(variables) !== JSON.stringify(rawVariables);

    if (!triggerNeedsNorm && !extraNeedsNorm && !variablesNeedNorm) return flow;
    const next: FlowDefinition = { ...flow };
    if (triggerNeedsNorm) next.trigger = normalizeCronTrigger(flow.trigger);
    if (extra) {
      next.extraTriggers = extra.map((t) => (shouldNormalizeCronTrigger(t) ? normalizeCronTrigger(t) : t));
    }
    if (variablesNeedNorm) next.variables = variables;
    return next;
  }
}

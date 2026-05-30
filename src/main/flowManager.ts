// src/main/flowManager.ts — AgentFlow flow persistence and trigger management
//
// Loads/saves FlowDefinition[] to flows.json, registers hotkey/cron triggers,
// and delegates execution to flowExecutor.

import { app, globalShortcut } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type {
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  QueueTaskItem,
} from '../shared/types';
import { executeFlow } from './flowExecutor';
import type { FlowExecutorDeps } from './flowExecutor';
import { sendLog, sendToRenderer } from './helpers';
import { IPC } from '../shared/types';
import { normalizeCronTrigger, shouldExecuteCronTriggerNow, shouldNormalizeCronTrigger } from '../shared/flowSchedule';

export interface FlowBotCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
}

// ── Persistence ──────────────────────────────────────────────────────────────

function createEntityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getFlowsPath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
  return path.join(dir, 'flows.json');
}

async function loadFlowsFromDisk(): Promise<FlowDefinition[]> {
  try {
    const raw = await fs.readFile(getFlowsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as FlowDefinition[];
  } catch {
    // File doesn't exist or is invalid — start with empty list
  }
  return [];
}

async function saveFlowsToDisk(flows: FlowDefinition[]): Promise<void> {
  const dir = path.dirname(getFlowsPath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getFlowsPath(), JSON.stringify(flows, null, 2), 'utf-8');
}

// ── Flow Manager ─────────────────────────────────────────────────────────────

export class FlowManager {
  private flows: FlowDefinition[] = [];
  private cronJobs = new Map<string, ScheduledTask>();
  private flowHotkeys = new Map<string, string>();
  private deps: FlowExecutorDeps;
  private _running = new Set<string>();
  private _onBotCommandsChanged: (() => void) | null = null;

  // Serial execution queue — prevents concurrent flow executions from racing on shared resources
  private _execChain: Promise<void> = Promise.resolve();
  private _pendingQueue: Array<{ id: string; name: string; status: 'running' | 'queued' }> = [];
  private _onQueueChange: (() => void) | null = null;

  constructor(deps: FlowExecutorDeps) {
    this.deps = deps;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const loadedFlows = await loadFlowsFromDisk();
    this.flows = loadedFlows.map((flow) => this.normalizeFlow(flow));
    if (JSON.stringify(this.flows) !== JSON.stringify(loadedFlows)) {
      await saveFlowsToDisk(this.flows);
    }
    this.registerAllTriggers();
    sendLog(`📋 [AgentFlow] Loaded ${this.flows.length} flow(s)`);
  }

  shutdown(): void {
    this.unregisterAllTriggers();
    sendLog('🛑 [AgentFlow] Shut down — all triggers unregistered');
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  getAll(): FlowDefinition[] {
    return this.flows;
  }

  getBotCommands(): FlowBotCommandDef[] {
    return this.flows
      .filter((f) => f.enabled && f.trigger.type === 'bot' && f.trigger.botCommand?.trim())
      .map((f) => ({
        flowId: f.id,
        command: (f.trigger.botCommand ?? '').toLowerCase().trim(),
        description: f.trigger.botCommandDescription ?? '',
        inputVariable: f.trigger.botInputVariable?.trim() || 'input',
      }));
  }

  async save(flow: FlowDefinition): Promise<FlowDefinition> {
    const normalizedFlow = this.normalizeFlow(flow);
    const idx = this.flows.findIndex((f) => f.id === flow.id);
    normalizedFlow.updatedAt = new Date().toISOString();
    const oldTriggerType = idx >= 0 ? this.flows[idx].trigger.type : undefined;

    if (idx >= 0) {
      // Unregister old triggers before replacement
      this.unregisterTrigger(this.flows[idx]);
      this.flows[idx] = normalizedFlow;
    } else {
      normalizedFlow.createdAt = normalizedFlow.createdAt || new Date().toISOString();
      this.flows.push(normalizedFlow);
    }

    if (normalizedFlow.enabled) {
      this.registerTrigger(normalizedFlow);
    }

    await saveFlowsToDisk(this.flows);

    if (normalizedFlow.trigger.type === 'bot' || oldTriggerType === 'bot') {
      this._onBotCommandsChanged?.();
    }

    return normalizedFlow;
  }

  async delete(flowId: string): Promise<boolean> {
    const idx = this.flows.findIndex((f) => f.id === flowId);
    if (idx < 0) return false;
    const deletedTriggerType = this.flows[idx].trigger.type;
    this.unregisterTrigger(this.flows[idx]);
    this.flows.splice(idx, 1);
    await saveFlowsToDisk(this.flows);
    if (deletedTriggerType === 'bot') {
      this._onBotCommandsChanged?.();
    }
    return true;
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

  // ── Queue integration ─────────────────────────────────────────────────────

  setQueueChangeCallback(cb: () => void): void {
    this._onQueueChange = cb;
  }

  setOnBotCommandsChanged(cb: () => void): void {
    this._onBotCommandsChanged = cb;
  }

  getPendingQueueItems(): QueueTaskItem[] {
    return this._pendingQueue.map((item) => ({
      id: item.id,
      promptSummary: `[Flow] ${item.name}`,
      status: item.status,
    }));
  }

  private createQueueExecution(
    flowId: string,
    extraContext?: Record<string, string>,
    source: 'ui' | 'bot' | 'system' = 'ui',
  ): { taskId: string; result: Promise<FlowExecutionResult> } {
    const flow = this.flows.find((f) => f.id === flowId);
    const taskId = createEntityId();
    if (!flow) {
      return {
        taskId,
        result: Promise.resolve({
          flowId,
          success: false,
          outputs: {},
          error: 'Flow not found',
          completedSteps: 0,
          totalSteps: 0,
          completedAt: new Date().toISOString(),
        }),
      };
    }

    if (flow.trigger.type === 'bot' && source !== 'bot') {
      sendLog(`🚫 [AgentFlow] Flow "${flow.name}" requires a Telegram trigger — skipped (source: ${source})`);
      return {
        taskId,
        result: Promise.resolve({
          flowId,
          success: false,
          outputs: {},
          error: 'Bot trigger flows must be invoked from Telegram',
          completedSteps: 0,
          totalSteps: flow.steps.length,
          completedAt: new Date().toISOString(),
        }),
      };
    }

    const entry: { id: string; name: string; status: 'running' | 'queued' } = {
      id: taskId,
      name: flow.name || flowId,
      status: 'queued',
    };
    this._pendingQueue.push(entry);
    this._onQueueChange?.();

    let resolveResult!: (result: FlowExecutionResult) => void;
    const resultPromise = new Promise<FlowExecutionResult>((res) => { resolveResult = res; });

    this._execChain = this._execChain.then(async () => {
      const idx = this._pendingQueue.findIndex((e) => e.id === taskId);
      if (idx >= 0) {
        this._pendingQueue[idx] = { ...this._pendingQueue[idx], status: 'running' };
        this._onQueueChange?.();
      }
      try {
        const result = await this.execute(flowId, extraContext);
        resolveResult(result);
      } catch (err) {
        resolveResult({
          flowId,
          success: false,
          outputs: {},
          error: err instanceof Error ? err.message : String(err),
          completedSteps: 0,
          totalSteps: flow.steps.length,
          completedAt: new Date().toISOString(),
        });
      } finally {
        const removeIdx = this._pendingQueue.findIndex((e) => e.id === taskId);
        if (removeIdx >= 0) this._pendingQueue.splice(removeIdx, 1);
        this._onQueueChange?.();
        // Reset chain reference when queue is empty to allow GC of resolved closures
        if (this._pendingQueue.length === 0) {
          this._execChain = Promise.resolve();
        }
      }
    });

    return { taskId, result: resultPromise };
  }

  // Enqueues a flow execution onto the serial chain, returns the result when it runs.
  async queueExecution(
    flowId: string,
    extraContext?: Record<string, string>,
    source: 'ui' | 'bot' | 'system' = 'ui',
  ): Promise<FlowExecutionResult> {
    return this.createQueueExecution(flowId, extraContext, source).result;
  }

  queueExecutionWithId(
    flowId: string,
    extraContext?: Record<string, string>,
    source: 'ui' | 'bot' | 'system' = 'ui',
  ): { taskId: string; result: Promise<FlowExecutionResult> } {
    return this.createQueueExecution(flowId, extraContext, source);
  }

  // ── Execution ────────────────────────────────────────────────────────────

  async execute(flowId: string, extraContext?: Record<string, string>): Promise<FlowExecutionResult> {
    const flow = this.flows.find((f) => f.id === flowId);
    if (!flow) {
      return {
        flowId,
        success: false,
        outputs: {},
        error: 'Flow not found',
        completedSteps: 0,
        totalSteps: 0,
        completedAt: new Date().toISOString(),
      };
    }

    if (this._running.has(flowId)) {
      return {
        flowId,
        success: false,
        outputs: {},
        error: 'Flow is already running',
        completedSteps: 0,
        totalSteps: flow.steps.length,
        completedAt: new Date().toISOString(),
      };
    }

    this._running.add(flowId);
    const event: FlowExecutionEvent = { flowId, name: flow.name };
    sendToRenderer(IPC.FLOW_EXECUTION_STARTED, event);

    try {
      const onLog = (log: FlowExecutionLog): void => {
        sendToRenderer(IPC.FLOW_EXECUTION_LOG, log);
      };
      return await executeFlow(flow, this.deps, onLog, extraContext);
    } finally {
      this._running.delete(flowId);
      sendToRenderer(IPC.FLOW_EXECUTION_ENDED, { flowId, name: flow.name } satisfies FlowExecutionEvent);
    }
  }

  // ── Trigger management ───────────────────────────────────────────────────

  private registerAllTriggers(): void {
    for (const flow of this.flows) {
      if (flow.enabled) {
        this.registerTrigger(flow);
      }
    }
  }

  private registerTrigger(flow: FlowDefinition): void {
    const trigger = shouldNormalizeCronTrigger(flow.trigger)
      ? normalizeCronTrigger(flow.trigger)
      : flow.trigger;

    if (trigger.type === 'hotkey' && trigger.keys) {
      // Check if another flow already occupies this hotkey
      for (const [existingFlowId, existingKeys] of this.flowHotkeys) {
        if (existingKeys === trigger.keys && existingFlowId !== flow.id) {
          sendLog(`⚠️ [AgentFlow] Hotkey "${trigger.keys}" already used by another flow — skipping for "${flow.name}"`);
          return;
        }
      }
      try {
        const ok = globalShortcut.register(trigger.keys, () => {
          void this.queueExecution(flow.id);
        });
        if (ok) {
          this.flowHotkeys.set(flow.id, trigger.keys);
          sendLog(`⌨️ [AgentFlow] Hotkey "${trigger.keys}" registered for "${flow.name}"`);
        } else {
          sendLog(`❌ [AgentFlow] Failed to register hotkey "${trigger.keys}" for "${flow.name}"`);
        }
      } catch (err) {
        sendLog(`❌ [AgentFlow] Hotkey error for "${flow.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (trigger.type === 'cron' && trigger.cronExpression) {
      if (!cron.validate(trigger.cronExpression)) {
        sendLog(`❌ [AgentFlow] Invalid cron expression "${trigger.cronExpression}" for "${flow.name}"`);
        return;
      }
      const task = cron.schedule(trigger.cronExpression, () => {
        if (!shouldExecuteCronTriggerNow(trigger)) return;
        void this.queueExecution(flow.id);
      });
      this.cronJobs.set(flow.id, task);
      sendLog(`⏰ [AgentFlow] Cron "${trigger.cronExpression}" scheduled for "${flow.name}"`);
    }
  }

  private unregisterTrigger(flow: FlowDefinition): void {
    const hotkey = this.flowHotkeys.get(flow.id);
    if (hotkey) {
      try { globalShortcut.unregister(hotkey); } catch { /* ignore */ }
      this.flowHotkeys.delete(flow.id);
    }

    const cronJob = this.cronJobs.get(flow.id);
    if (cronJob) {
      cronJob.stop();
      cronJob.destroy();
      this.cronJobs.delete(flow.id);
    }
  }

  private unregisterAllTriggers(): void {
    for (const flow of this.flows) {
      this.unregisterTrigger(flow);
    }
  }

  private normalizeFlow(flow: FlowDefinition): FlowDefinition {
    if (!shouldNormalizeCronTrigger(flow.trigger)) return flow;
    return {
      ...flow,
      trigger: normalizeCronTrigger(flow.trigger),
    };
  }
}

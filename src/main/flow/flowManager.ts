import type {
  SystemEvent,
  FlowBuildEvent,
  FlowBuildOutcome,
  FlowDefinition,
  FlowExecutionEvent,
  FlowExecutionLog,
  FlowExecutionResult,
  QueueTaskItem,
} from '../../shared/types';
import { compactPreview } from '../../shared/textBudget';
import { BOT_RUN_KEY, INTERACTIVE_RUN_KEY, SIGNED_IN_RUN_KEY, executeFlow } from './executor';
import { signInUseForRun } from '../botPermissions/signedInReads';
import { closeRunPages } from './skills/browserPages';
import { runFlowBuild } from './flowBuild';
import { sendBuildEvent } from './flowBuildBroadcast';
import type { FlowClarification } from '../../shared/flowSkillSchema';
import type { FlowExecutorDeps } from './types';
import { getWorkerAttention, sendLog, sendToRenderer, sendWebNotification } from '../helpers';
import { config } from '../config';
import { getLangCache, localizeUserFacingError, t } from '../i18n';
import { classifyFailure, recordTaskOutcome } from '../metrics';
import { pruneFlowMetrics } from '../flowMetrics';
import { recordFlowRun } from '../flowMeter';
import { runInMetricDomain } from '../llmMeter';
import { publicWebOnlyIf } from '../net/publicWebScope';
import { IPC, BOT_COMMAND_RE } from '../../shared/types';
import { builtinById, isBuiltinFlowId } from '../../shared/builtinFlows';
import type { BuiltinBuildContext } from '../../shared/builtinFlows';
import { normalizeCronTrigger, shouldNormalizeCronTrigger } from '../../shared/flowSchedule';
import { cloneFlowVariables, missingRequiredVariables, sanitizeFlowVariables } from '../../shared/flowVariables';
import { createEntityId, loadFlowsFromDisk, saveFlowsToDisk } from './flowPersistence';
import { pruneOrphanCheckpoints } from './checkpoint';
import { deleteFlowMemory } from './flowMemory';
import {
  deleteFlowVersions,
  getFlowVersion,
  listFlowVersionRecords,
  recordFlowSave,
  resetFlowVersionCache,
  restoredFlowFrom,
  versionedStepIds,
  viewFlowVersions,
} from './flowVersions';
import type { FlowSaveOrigin, FlowVersionRestoreResult, FlowVersionView } from '../../shared/flowVersions';
import { FlowTriggerRegistry } from './flowTriggers';
import type { TriggerFire } from './flowTriggers';
import { shouldDeleteAfterRun } from '../../shared/flowDeleteAfterRun';
import { FILE_TRIGGER_NAME_VAR } from '../../shared/flowFileTrigger';
import { flushScheduleState, loadScheduleState, pruneScheduleState } from './scheduleState';
import { FlowQueue, QUEUE_CANCELLED } from './flowQueue';
import { llmLane } from './lanes';
import { launchedByRelaunch } from '../relaunchFlag';
import { botCommandAccessMode, normalizeAllowedUserIds, readsOwnerData } from '../../shared/botCommandAccess';
import type { BotCommandAccessMode } from '../../shared/botCommandAccess';
import type { StepProgress } from '../../shared/stepProgress';

/** A built-in is built on demand, in the app language and with the current settings. */
function builtinBuildContext(): BuiltinBuildContext {
  const strings = getLangCache();
  return {
    t: (key, vars) => t(strings, key, vars),
    locale: config.locale,
    // The summary uses the YouTube template from Settings, the app language's built-in one when empty.
    summaryTemplate: () => config.youtubePrompt.trim() || strings['youtube.prompt.default'] || '',
  };
}

/**
 * The run's context with the sign-in mark — `full` or `others` — decided as it starts (a bot's
 * from the memory file and grants as they are then); without one the steps read as a visitor.
 */
async function withSignedInMark(context: Record<string, string>, botRun: boolean): Promise<Record<string, string>> {
  const signIn = await signInUseForRun(botRun, context);
  return signIn === 'none' ? context : { ...context, [SIGNED_IN_RUN_KEY]: signIn };
}

export interface FlowBotCommandDef {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
  /**
   * 'all' = every paired account; 'users' = only allowedUserIds, where an empty list is nobody;
   * 'admins' = the owner and admin-grant holders in their own private chat. Already resolved.
   */
  access: BotCommandAccessMode;
  allowedUserIds: string[];
}

type FlowExecutionSource = 'ui' | 'bot' | 'system' | 'chat';

const ALREADY_RUNNING = 'Flow is already running';

export class FlowManager {
  private flows: FlowDefinition[] = [];
  private deps: FlowExecutorDeps;
  private _running = new Set<string>();
  /** Called once when the run under that key ends. */
  private _runEndWaiters = new Map<string, Array<() => void>>();
  private _abortControllers = new Map<string, AbortController>();
  private _onBotCommandsChanged: (() => void) | null = null;
  private triggers = new FlowTriggerRegistry((flowId, extraContext, fire) => {
    if (fire?.systemEvent && !this.admitSystemFire(flowId, fire.systemEvent)) return;
    if (fire?.file) return this.runForFile(flowId, extraContext, fire);
    return this.createQueueExecution(flowId, extraContext, 'ui', fire).result;
  }, (flowIds) => sendToRenderer(IPC.FLOW_WATCH_MISSING, flowIds));
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
    await loadScheduleState();
    pruneScheduleState(this.flows.map((flow) => flow.id));
    this.triggers.registerAll(this.flows);
    if (launchedByRelaunch()) sendLog('📋 [Flow] Yobi restarted itself — startup triggers skipped');
    else this.triggers.fireStartup();
    if (this.flows.length > 0) this.pruneFlowData();
    sendLog(`📋 [Flow] Loaded ${this.flows.length} flow(s)`);
  }

  shutdown(): void {
    this.triggers.unregisterAll(this.flows);
    flushScheduleState();
    sendLog('🛑 [Flow] Shut down — all triggers unregistered');
  }

  /**
   * Anything keyed by a flow or step that no longer exists: checkpoints and counters alike. A step
   * a kept version still has is not gone — restoring that version brings its read state back.
   */
  private pruneFlowData(): void {
    const activeStepIds = new Set<string>();
    for (const flow of this.flows) {
      for (const step of flow.steps) activeStepIds.add(step.id);
    }
    const flowIds = new Set(this.flows.map((flow) => flow.id));
    void versionedStepIds().then((kept) => {
      for (const id of kept) activeStepIds.add(id);
      void pruneOrphanCheckpoints(activeStepIds);
      pruneFlowMetrics(flowIds, activeStepIds);
    });
  }

  /**
   * Lets go of every trigger of the current flows (hotkeys, schedules, watchers) until `reload()`
   * registers the new ones; a restore uses it so a combo leaving a flow is free for the hotkeys.
   */
  releaseTriggers(): void {
    this.triggers.unregisterAll(this.flows);
  }

  async reload(): Promise<void> {
    resetFlowVersionCache();
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

  /** Flows whose watched folder is not there right now (a file trigger's issue). */
  getWatchMissing(): string[] {
    return this.triggers.watchMissingFlowIds();
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
          access: botCommandAccessMode(trigger.botAccess, trigger.botAllowedUserIds, readsOwnerData(f.steps)),
          allowedUserIds: normalizeAllowedUserIds(trigger.botAllowedUserIds),
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

  /** `origin` says who made the change, for the flow's version history. */
  async save(flow: FlowDefinition, origin: FlowSaveOrigin = { source: 'user' }): Promise<FlowDefinition> {
    const normalizedFlow = this.gateEnabled(this.normalizeFlow(flow));
    const idx = this.flows.findIndex((f) => f.id === flow.id);
    normalizedFlow.updatedAt = new Date().toISOString();
    const previous = idx >= 0 ? this.flows[idx] : undefined;
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
    await recordFlowSave(previous, normalizedFlow, origin);

    if (this.flowHasBotTrigger(normalizedFlow) || hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }

    this.pruneFlowData();
    return normalizedFlow;
  }

  /** The flow's versions, newest first, each against the flow as it is now. */
  async listVersions(flowId: string): Promise<FlowVersionView[] | null> {
    const current = this.flows.find((f) => f.id === flowId);
    if (!current) return null;
    return viewFlowVersions(await listFlowVersionRecords(flowId), current);
  }

  /**
   * Puts an earlier version back as a new save (the flow as it is now stays in the history). Its
   * steps keep their ids; the flow keeps its own id, creation time and switch (see restoredFlowFrom).
   */
  async restoreVersion(flowId: string, vid: string): Promise<FlowVersionRestoreResult> {
    const current = this.flows.find((f) => f.id === flowId);
    const version = current ? await getFlowVersion(flowId, vid) : null;
    if (!current || !version) return { ok: false, reason: 'missing' };
    const { flow, paused } = restoredFlowFrom(current, version.flow);
    const saved = await this.save(flow, { source: 'restore', restoredFrom: vid });
    sendToRenderer(IPC.FLOW_UPDATED, saved);
    sendLog(`🕘 [Flow] "${saved.name}" restored to an earlier version${paused ? ', switched off for review' : ''}`);
    return { ok: true, flow: saved, paused };
  }

  async delete(flowId: string): Promise<boolean> {
    const idx = this.flows.findIndex((f) => f.id === flowId);
    if (idx < 0) return false;
    const hadBotTrigger = this.flowHasBotTrigger(this.flows[idx]);
    this.triggers.unregister(this.flows[idx]);
    this.flows.splice(idx, 1);
    await saveFlowsToDisk(this.flows);
    await deleteFlowMemory([flowId], this.flows.map((f) => f.id));
    await deleteFlowVersions([flowId]);
    if (hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }
    this.pruneFlowData();
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
    await deleteFlowMemory(removed.map((f) => f.id), this.flows.map((f) => f.id));
    await deleteFlowVersions(removed.map((f) => f.id));
    if (hadBotTrigger) {
      this._onBotCommandsChanged?.();
    }
    this.pruneFlowData();
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
    return this.queue.enqueue(taskId, name, () => run(taskId), makeErrorResult, undefined, agentRunId, clientToken, 'external');
  }

  setQueueTaskProgress(taskId: string, progress: string): void {
    this.queue.setProgress(taskId, progress);
  }

  cancelQueuedTask(taskId: string): boolean {
    return this.queue.cancelQueued(taskId);
  }

  private failureResult(
    flowId: string,
    error: string,
    totalSteps: number,
    displayError?: string,
  ): FlowExecutionResult {
    return {
      flowId,
      success: false,
      outputs: {},
      error,
      ...(displayError ? { displayError } : {}),
      completedSteps: 0,
      totalSteps,
      completedAt: new Date().toISOString(),
    };
  }

  /** A saved flow, or one Yobi runs itself for a pasted link, named in the app language. */
  flowById(flowId: string): FlowDefinition | undefined {
    const saved = this.flows.find((f) => f.id === flowId);
    if (saved) return saved;
    return builtinById(flowId)?.build(builtinBuildContext());
  }

  private notFoundResult(flowId: string): FlowExecutionResult {
    return this.failureResult(flowId, 'Flow not found', 0, t(getLangCache(), 'flow.error.notFound'));
  }

  private createQueueExecution(
    flowId: string,
    extraContext?: Record<string, string>,
    source: FlowExecutionSource = 'ui',
    fire?: TriggerFire,
    onStepProgress?: (progress: StepProgress) => void,
  ): { taskId: string; result: Promise<FlowExecutionResult> } {
    const flow = this.flowById(flowId);
    const taskId = createEntityId();
    if (!flow) {
      return { taskId, result: Promise.resolve(this.notFoundResult(flowId)) };
    }

    const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
    const isBotOnly = triggers.length > 0 && triggers.every((tr) => tr.type === 'bot');
    if (isBotOnly && source !== 'bot') {
      sendLog(`🚫 [Flow] Flow "${flow.name}" requires a bot trigger — skipped (source: ${source})`);
      return {
        taskId,
        result: Promise.resolve(
          this.failureResult(
            flowId,
            'Bot trigger flows must be invoked from Telegram or LINE',
            flow.steps.length,
            t(getLangCache(), 'flow.error.botTriggerOnly'),
          ),
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

    // Only a run the person started in the desktop chat may show them a window (a site's
    // verification), only the owner's own may read with the site sign-ins, and a run a bot message
    // started is marked so a connector step will not change anything; whatever a caller put under
    // any of these keys is dropped.
    const {
      [INTERACTIVE_RUN_KEY]: _interactive,
      [SIGNED_IN_RUN_KEY]: _signedIn,
      [BOT_RUN_KEY]: _botRun,
      ...callerContext
    } = extraContext ?? {};
    const runContext = source === 'chat'
      ? { ...callerContext, [INTERACTIVE_RUN_KEY]: '1' }
      : source === 'bot' ? { ...callerContext, [BOT_RUN_KEY]: '1' } : callerContext;
    const result = this.queue.enqueue(
      taskId,
      `[Flow] ${flow.name || flowId}`,
      async () => this.execute(flowId, await withSignedInMark(runContext, source === 'bot'), fire, onStepProgress),
      (err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== QUEUE_CANCELLED) return this.failureResult(flowId, message, flow.steps.length);
        // Removed from the queue by the user: a stop, not a failure, for every caller that reports it.
        return {
          ...this.failureResult(flowId, message, flow.steps.length, localizeUserFacingError(message, getLangCache())),
          aborted: true,
        };
      },
      flowId,
      undefined,
      undefined,
      isBuiltinFlowId(flowId) ? 'builtin' : 'shared',
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

  /** `onStepProgress` hears where a long step is (a download's percentage) for this run only. */
  queueExecutionWithId(
    flowId: string,
    extraContext?: Record<string, string>,
    source: FlowExecutionSource = 'ui',
    onStepProgress?: (progress: StepProgress) => void,
  ): { taskId: string; result: Promise<FlowExecutionResult> } {
    return this.createQueueExecution(flowId, extraContext, source, undefined, onStepProgress);
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
    }, { source: 'ai-build' });
    sendToRenderer(IPC.FLOW_CREATED, saved);
    return saved;
  }

  /**
   * Switches on a flow an agent saved once its user approved it in a bot chat. Returns the flow as it
   * now is — still off when a required setting is missing — or null when it is gone.
   */
  async enableFlowFromAgent(flowId: string): Promise<FlowDefinition | null> {
    if (!this.flows.some((flow) => flow.id === flowId)) return null;
    await this.setEnabledMany([flowId], true);
    const flow = this.flows.find((candidate) => candidate.id === flowId) ?? null;
    if (flow) sendToRenderer(IPC.FLOW_UPDATED, flow);
    return flow;
  }

  /**
   * An agent's change to a saved flow, written over it. Refuses a flow that was deleted while the
   * change was being made rather than bringing it back. A change may switch a flow off (one that
   * adds a step acting on the computer does) but never on.
   */
  async replaceFlowFromAgent(candidate: FlowDefinition): Promise<FlowDefinition> {
    const current = this.flows.find((flow) => flow.id === candidate.id);
    if (!current) throw new Error('That flow no longer exists, so the change was not saved');
    const saved = await this.save({ ...candidate, enabled: current.enabled && candidate.enabled }, { source: 'ai-edit' });
    sendToRenderer(IPC.FLOW_UPDATED, saved);
    return saved;
  }

  /**
   * One build attempt, streamed to the renderer under `buildId`. Answers arriving on a second
   * call are what makes the ask gate one round deep: with any answer in hand the build no longer
   * stops to ask, so it cannot loop back to the user twice for the same request.
   */
  async queueBuild(
    description: string,
    options: {
      buildId: string;
      answers?: readonly FlowClarification[];
      queueLabel?: string;
      providerUrl?: string;
    },
  ): Promise<FlowBuildOutcome> {
    const taskId = createEntityId();
    const { buildId } = options;
    const answers = options.answers ?? [];
    const emit = (event: FlowBuildEvent): void => sendBuildEvent(buildId, event, getLangCache());
    return this.queue.enqueue<FlowBuildOutcome>(
      taskId,
      `[Flow] ${options.queueLabel ?? 'AI Flow'}`,
      async () => {
        try {
          return await runFlowBuild({
            goal: description,
            deps: this.deps,
            save: (flow) => this.saveGeneratedFlow(flow),
            answers,
            askUser: answers.length === 0,
            emit,
            ...(options.providerUrl ? { providerUrl: options.providerUrl } : {}),
          });
        } finally {
          this.blankWorkerWhenIdle();
        }
      },
      (err) => {
        const error = err instanceof Error ? err.message : String(err);
        emit({ kind: 'failed', phase: 'build', error });
        return { status: 'failed', phase: 'build', error };
      },
    );
  }

  private blankWorkerWhenIdle(): void {
    void llmLane.runExclusive(async () => {
      if (this._running.size !== 0 || getWorkerAttention() !== 'idle') return;
      const workerWin = this.deps.getWorkerWin();
      // A focusable worker is one the user revealed and is looking at (`revealWorkerWindow`):
      // blanking it would empty the window under them.
      if (workerWin && !workerWin.isDestroyed() && !workerWin.isFocusable()) {
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

  async execute(
    flowId: string,
    extraContext?: Record<string, string>,
    fire?: TriggerFire,
    onStepProgress?: (progress: StepProgress) => void,
  ): Promise<FlowExecutionResult> {
    const flow = this.flowById(flowId);
    if (!flow) {
      return this.notFoundResult(flowId);
    }

    // A built-in keeps no state between runs, so two pasted links run side by side.
    const runKey = isBuiltinFlowId(flowId) ? `${flowId}#${createEntityId()}` : flowId;
    if (this._running.has(runKey)) {
      return this.failureResult(
        flowId,
        ALREADY_RUNNING,
        flow.steps.length,
        t(getLangCache(), 'flow.error.alreadyRunning'),
      );
    }

    this._running.add(runKey);
    const controller = new AbortController();
    this._abortControllers.set(runKey, controller);
    const event: FlowExecutionEvent = { flowId, name: flow.name };
    sendToRenderer(IPC.FLOW_EXECUTION_STARTED, event);

    try {
      // A failed step arrives with both texts: the run panel shows `displayError`, while its copy
      // button and the run export keep the raw `error`.
      const onLog = (log: FlowExecutionLog): void => {
        sendToRenderer(IPC.FLOW_EXECUTION_LOG, log);
      };
      // A flow a non-owner bot admin made reads the public web only, however the run started.
      const result = await publicWebOnlyIf(flow.publicWebOnly === true, () => runInMetricDomain(
        'flow',
        () => executeFlow(
          flow,
          onStepProgress ? { ...this.deps, onStepProgress } : this.deps,
          onLog,
          extraContext,
          controller.signal,
        ),
      ));
      this.recordRunMetrics(result);
      const deleted = fire?.oneTimeSchedule === true && await this.deleteAfterOneTimeRun(flowId, result);
      this.notifyRunOutcome(flow, result, deleted);
      return result;
    } finally {
      closeRunPages(flowId);
      this._abortControllers.delete(runKey);
      this._running.delete(runKey);
      const waiters = this._runEndWaiters.get(runKey) ?? [];
      this._runEndWaiters.delete(runKey);
      for (const wake of waiters) wake();
      sendToRenderer(IPC.FLOW_EXECUTION_ENDED, { flowId, name: flow.name } satisfies FlowExecutionEvent);
      this.blankWorkerWhenIdle();
    }
  }

  /**
   * Lock and unlock can come seconds apart, and a lid can flap: a copy queued behind a run of the
   * same flow would only fail with "already running", so it is dropped here, and said so.
   */
  private admitSystemFire(flowId: string, event: SystemEvent): boolean {
    const name = this.flows.find((f) => f.id === flowId)?.name ?? flowId;
    if (this._running.has(flowId) || this.queue.hasFlow(flowId)) {
      sendLog(`🖥️ [Flow] "${name}" is still queued or running — skipped this ${event}`);
      return false;
    }
    sendLog(`🖥️ [Flow] "${name}" started by system event: ${event}`);
    return true;
  }

  /**
   * A new file has one chance to run: no later fire brings it back. While the same flow is running
   * (a Run, a schedule, a file run from before the flow was saved) it waits for that run to end
   * rather than failing as "already running", and runs only if the flow still watches a folder.
   */
  private async runForFile(
    flowId: string,
    extraContext: Record<string, string> | undefined,
    fire: TriggerFire,
  ): Promise<FlowExecutionResult | undefined> {
    const fileName = extraContext?.[FILE_TRIGGER_NAME_VAR] ?? '';
    let waited = false;
    for (;;) {
      if (this._running.has(flowId)) {
        if (!waited) sendLog(`📂 [Flow] "${fileName}" waits for the run of "${this.flowById(flowId)?.name ?? flowId}" in progress`);
        waited = true;
        await new Promise<void>((resolve) => {
          const list = this._runEndWaiters.get(flowId);
          if (list) list.push(resolve);
          else this._runEndWaiters.set(flowId, [resolve]);
        });
        continue;
      }
      // The watch itself, not the flow's settings: shutdown stops every watch but leaves the flow
      // enabled with its file trigger.
      if (waited && !this.triggers.watchesFiles(flowId)) {
        sendLog(`📂 [Flow] "${fileName}" waited for a flow that stopped watching — not run`);
        return undefined;
      }
      const result = await this.createQueueExecution(flowId, extraContext, 'ui', fire).result;
      if (result.error !== ALREADY_RUNNING) return result;
      waited = true;
    }
  }

  /**
   * A one-time flow set to delete itself, after its schedule's run. Judged against the flow as it
   * is now, not as it was when the run started: the option may have been switched off meanwhile.
   */
  private async deleteAfterOneTimeRun(flowId: string, result: FlowExecutionResult): Promise<boolean> {
    const current = this.flows.find((f) => f.id === flowId);
    if (!current || !shouldDeleteAfterRun(current, result)) return false;
    await this.delete(flowId);
    sendToRenderer(IPC.FLOW_REMOVED, flowId);
    sendLog(`🗑️ [Flow] One-time flow "${current.name}" ran and was deleted`);
    return true;
  }

  /**
   * Two tallies from one run: the domain-wide one the headline success rate reads, and the
   * per-flow one. `degraded` is the bridge between them — a run that lost steps to
   * `emitFailFlag` still counts as a success here, and would otherwise leave no trace at all.
   */
  private recordRunMetrics(result: FlowExecutionResult): void {
    if (result.aborted) return;
    const outcome = result.success ? 'success' : classifyFailure(result.error);
    recordTaskOutcome('flow', outcome);
    // Per-flow statistics are for the user's own flows; a built-in has no row to show them in.
    if (isBuiltinFlowId(result.flowId)) return;
    recordFlowRun({ flowId: result.flowId, outcome, degraded: (result.softFailures ?? 0) > 0 });
  }

  /**
   * A run that lost steps to `emitFailFlag` gets its own notice, not a silent success: the skipped
   * items are already marked as read.
   */
  private notifyRunOutcome(flow: FlowDefinition, result: FlowExecutionResult, deleted: boolean): void {
    if (result.aborted) return;
    const strings = getLangCache();
    // Told whatever the success setting says: a flow vanishing from the list is not routine news.
    if (deleted) {
      sendWebNotification(
        t(strings, 'notify.flow.deletedAfterRun.title'),
        t(strings, 'notify.flow.deletedAfterRun.body', { flow: flow.name }),
        'success',
      );
      return;
    }
    const softFailures = result.softFailures ?? 0;
    if (result.success && softFailures > 0) {
      if (!config.notifyEvents.flowFailure && !config.notifyEvents.flowSuccess) return;
      sendWebNotification(
        t(strings, 'notify.flow.partial.title'),
        t(strings, 'notify.flow.partial.body', {
          flow: flow.name,
          count: String(softFailures),
          error: compactPreview(result.softFailureError ?? '', 90),
        }),
        'warning',
      );
    } else if (result.success && config.notifyEvents.flowSuccess) {
      sendWebNotification(
        t(strings, 'notify.flow.success.title'),
        t(strings, 'notify.flow.success.body', { flow: flow.name }),
        'success',
      );
    } else if (!result.success && config.notifyEvents.flowFailure) {
      const displayError = compactPreview(
        result.displayError ?? localizeUserFacingError(result.error ?? '', strings),
        90,
      );
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

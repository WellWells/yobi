import { create } from 'zustand';
import { useI18nStore } from './i18nStore';
import type {
  FlowDefinition,
  FlowExecutionLog,
  FlowExecutionResult,
  FlowBuildOutcome,
  FlowClarification,
  SkillInstance,
  SkillType,
  TriggerConfig,
} from '../../../shared/types';
import { flowApi } from '../api/electronApi';
import type { FlowSaveSource } from '../../../shared/flowVersions';
import { useFlowBuildStore } from './useFlowBuildStore';
import {
  cloneFlow, copyStepBlock, createDefaultFlow, createDefaultStep, createId, findLoopSource, findMatchingMarker, freeLoopVarName, mergeSaveReply,
  nextFreeOutputKey, stepInsertIndex, stepRunKey, DEFAULT_OUTPUT_BASE,
} from './flowHelpers';
import { SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';
import { checkBlockStructure } from '../../../shared/flowBlockStructure';

/** Steps taken out of a flow with the places they had, ascending by place. */
export type RemovedSteps = ReadonlyArray<{ index: number; step: SkillInstance }>;

/** Why a step did not move: `edge` (first or last step) needs no message, the others do. */
export type MoveStepResult = { ok: true } | { ok: false; reason: 'edge' | 'block' | 'outsideLoop' };

export const MOVE_BLOCKED_MESSAGE = {
  block: 'flow.editor.moveBlocked.block',
  outsideLoop: 'flow.editor.moveBlocked.outsideLoop',
} as const;

interface ActionState {
  flows: FlowDefinition[];
  savedFlows: Record<string, FlowDefinition>;
  selectedFlowId: string | null;
  executionLogs: FlowExecutionLog[];
  executionResult: FlowExecutionResult | null;
  isExecuting: boolean;
  runningFlowIds: string[];
  /**
   * Each step as it ran (`stepRunKey`), per flow, taken from the saved flow when its run started:
   * the results say which steps were changed since. In memory only.
   */
  runSnapshots: Record<string, Record<string, string>>;

  loadFlows: () => Promise<void>;
  selectFlow: (flowId: string | null) => void;
  createFlow: () => Promise<void>;
  updateFlow: (flow: FlowDefinition) => void;
  saveFlow: (flow: FlowDefinition, source?: FlowSaveSource, reviewed?: boolean) => Promise<void>;
  deleteFlow: (flowId: string) => Promise<void>;
  deleteFlows: (flowIds: string[]) => Promise<void>;
  setFlowsEnabled: (flowIds: string[], enabled: boolean) => Promise<void>;
  duplicateFlow: (flowId: string) => Promise<FlowDefinition | null>;
  reorderFlows: (orderedIds: string[]) => Promise<void>;
  /** Main saved the flows in a new order (a reorder, or a move into a folder): unsaved edits stay. */
  adoptSavedOrder: (saved: FlowDefinition[]) => void;
  executeFlow: (flowId: string) => Promise<FlowExecutionResult | null>;
  abortFlow: (flowId: string) => Promise<void>;
  buildFlow: (
    description: string,
    buildId: string,
    answers?: FlowClarification[],
    providerUrl?: string,
  ) => Promise<FlowBuildOutcome>;
  adoptFlow: (flow: FlowDefinition) => void;
  /** A flow main saved over (an agent's confirmed change): both the editor copy and the saved copy take it. */
  replaceSavedFlow: (flow: FlowDefinition) => void;
  /** A flow main deleted on its own (a one-time flow after its run). */
  dropRemovedFlow: (flowId: string) => void;
  restoreFlow: (flowId: string) => void;
  /**
   * An edit like any other: it is saved with the flow, on Save. `at` is the index it goes in at (a
   * step card's "insert below"); without it, the end of the flow, inside a block left open at the end.
   * The new step's id, or null when the flow is not there.
   */
  addStep: (flowId: string, type?: SkillType, at?: number) => string | null;
  /** What it took out (a loop or condition takes its end marker too), for a way back; null when nothing. */
  removeStep: (flowId: string, stepId: string) => RemovedSteps | null;
  /** Puts removed steps back at the places they were taken from; ones already back are left alone. */
  restoreRemovedSteps: (flowId: string, removed: RemovedSteps) => void;
  /** A copy right under the step (a loop or condition: its whole block); the copy's id, or null. */
  duplicateStep: (flowId: string, stepId: string) => string | null;
  updateStep: (flowId: string, stepId: string, patch: Partial<SkillInstance>) => void;
  /** Swaps the step with its neighbour, unless that would leave the if/loop blocks unpaired. */
  moveStep: (flowId: string, stepId: string, direction: 'up' | 'down') => MoveStepResult;
  reorderSteps: (flowId: string, activeId: string, overId: string) => void;
  updateTrigger: (flowId: string, trigger: TriggerConfig) => void;
  addExtraTrigger: (flowId: string) => void;
  updateExtraTrigger: (flowId: string, index: number, trigger: TriggerConfig) => void;
  removeExtraTrigger: (flowId: string, index: number) => void;
  appendExecutionLog: (log: FlowExecutionLog) => void;
  markFlowRunning: (flowId: string) => void;
  markFlowDone: (flowId: string) => void;
  importFlows: (flows: FlowDefinition[]) => Promise<void>;
}

// Saves can overlap (Run saves first, then Ctrl+S). Each request gets a number; a reply older than
// one already applied to that flow is dropped so it cannot roll the saved copy back.
let saveRequestSeq = 0;
const appliedSaveSeq = new Map<string, number>();

export const useFlowStore = create<ActionState>((set, get) => ({
  flows: [],
  savedFlows: {},
  selectedFlowId: null,
  executionLogs: [],
  executionResult: null,
  isExecuting: false,
  runningFlowIds: [],
  runSnapshots: {},

  loadFlows: async () => {
    const flows = await flowApi.getAll();
    const savedFlows = Object.fromEntries(flows.map((flow) => [flow.id, cloneFlow(flow)]));
    set({ flows, savedFlows });
  },

  selectFlow: (flowId) => {
    set({ selectedFlowId: flowId, executionLogs: [], executionResult: null });
  },

  createFlow: async () => {
    const t = useI18nStore.getState().t;
    const flow = createDefaultFlow(t);
    set((state) => ({
      flows: [...state.flows, flow],
      selectedFlowId: flow.id,
      executionLogs: [],
      executionResult: null,
    }));
    await get().saveFlow(flow);
  },

  updateFlow: (flow) => {
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flow.id ? flow : f)),
    }));
  },

  saveFlow: async (flow, source, reviewed) => {
    const seq = ++saveRequestSeq;
    // The editor stays live while main writes flows.json: edits made meanwhile must survive the reply.
    const sent = cloneFlow(flow);
    const saved = await (reviewed ? flowApi.save(flow, source ?? 'user', true) : source ? flowApi.save(flow, source) : flowApi.save(flow));
    if (!saved) return;
    if ((appliedSaveSeq.get(saved.id) ?? 0) > seq) return;
    appliedSaveSeq.set(saved.id, seq);
    set((state) => ({
      flows: state.flows.map((f) => (f.id === saved.id ? mergeSaveReply(f, sent, saved) : f)),
      savedFlows: {
        ...state.savedFlows,
        [saved.id]: cloneFlow(saved),
      },
    }));
  },

  deleteFlow: async (flowId) => {
    await flowApi.deleteFlow(flowId);
    set((state) => ({
      flows: state.flows.filter((f) => f.id !== flowId),
      selectedFlowId: state.selectedFlowId === flowId ? null : state.selectedFlowId,
      savedFlows: Object.fromEntries(Object.entries(state.savedFlows).filter(([id]) => id !== flowId)),
    }));
  },

  deleteFlows: async (flowIds) => {
    if (flowIds.length === 0) return;
    const idSet = new Set(flowIds);
    await flowApi.deleteFlows(flowIds);
    set((state) => ({
      flows: state.flows.filter((f) => !idSet.has(f.id)),
      selectedFlowId: state.selectedFlowId && idSet.has(state.selectedFlowId) ? null : state.selectedFlowId,
      savedFlows: Object.fromEntries(Object.entries(state.savedFlows).filter(([id]) => !idSet.has(id))),
    }));
  },

  setFlowsEnabled: async (flowIds, enabled) => {
    if (flowIds.length === 0) return;
    const idSet = new Set(flowIds);
    set((state) => ({
      flows: state.flows.map((f) => (idSet.has(f.id) ? { ...f, enabled } : f)),
      savedFlows: Object.fromEntries(
        Object.entries(state.savedFlows).map(([id, f]) => (idSet.has(id) ? [id, { ...f, enabled }] : [id, f])),
      ),
    }));
    const persisted = await flowApi.setFlowsEnabled(flowIds, enabled);
    if (!persisted || persisted.length === 0) return;
    const enabledById = new Map(persisted.map((f) => [f.id, f.enabled]));
    const adopt = (flow: FlowDefinition): FlowDefinition => {
      const next = enabledById.get(flow.id);
      return next === undefined || next === flow.enabled ? flow : { ...flow, enabled: next };
    };
    set((state) => ({
      flows: state.flows.map(adopt),
      savedFlows: Object.fromEntries(
        Object.entries(state.savedFlows).map(([id, f]) => [id, adopt(f)]),
      ),
    }));
  },

  duplicateFlow: async (flowId) => {
    const duplicated = await flowApi.duplicateFlow(flowId);
    if (!duplicated) return null;
    set((state) => {
      const sourceIndex = state.flows.findIndex((f) => f.id === flowId);
      const nextFlows = [...state.flows];
      const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : nextFlows.length;
      nextFlows.splice(insertAt, 0, duplicated);
      return {
        flows: nextFlows,
        selectedFlowId: duplicated.id,
        savedFlows: {
          ...state.savedFlows,
          [duplicated.id]: cloneFlow(duplicated),
        },
        executionLogs: [],
        executionResult: null,
      };
    });
    return duplicated;
  },

  reorderFlows: async (orderedIds) => {
    set((state) => {
      const byId = new Map(state.flows.map((f) => [f.id, f]));
      const next = orderedIds
        .map((id) => byId.get(id))
        .filter((f): f is FlowDefinition => Boolean(f));
      for (const f of state.flows) {
        if (!orderedIds.includes(f.id)) next.push(f);
      }
      return { flows: next };
    });
    const reordered = await flowApi.reorderFlows(orderedIds);
    if (Array.isArray(reordered)) get().adoptSavedOrder(reordered);
  },

  adoptSavedOrder: (saved) => {
    if (saved.length === 0) return;
    const savedFlows = Object.fromEntries(saved.map((f) => [f.id, cloneFlow(f)]));
    set((state) => ({
      flows: saved.map((f) => state.flows.find((cur) => cur.id === f.id) ?? f),
      savedFlows,
    }));
  },

  executeFlow: async (flowId) => {
    set((state) => ({ isExecuting: true, executionLogs: [], executionResult: null, runningFlowIds: [...state.runningFlowIds.filter((id) => id !== flowId), flowId] }));
    try {
      const result = await flowApi.execute(flowId);
      set((state) => (state.selectedFlowId === flowId ? { executionResult: result } : state));
      return result;
    } finally {
      set((state) => ({ isExecuting: false, runningFlowIds: state.runningFlowIds.filter((id) => id !== flowId) }));
    }
  },

  abortFlow: async (flowId) => {
    await flowApi.abort(flowId);
  },

  buildFlow: async (description, buildId, answers, providerUrl) => {
    useFlowBuildStore.getState().startBuild(buildId);
    const result = await flowApi.build({
      description,
      buildId,
      ...(answers?.length ? { answers: [...answers] } : {}),
      ...(providerUrl ? { providerUrl } : {}),
    });
    if (result.status === 'created') {
      const { flow } = result;
      set((state) => ({
        flows: [...state.flows.filter((existing) => existing.id !== flow.id), flow],
        selectedFlowId: flow.id,
        savedFlows: { ...state.savedFlows, [flow.id]: cloneFlow(flow) },
        executionLogs: [],
        executionResult: null,
      }));
    }
    return result;
  },

  adoptFlow: (flow) => {
    set((state) => (state.flows.some((existing) => existing.id === flow.id)
      ? state
      : {
          ...state,
          flows: [...state.flows, flow],
          savedFlows: { ...state.savedFlows, [flow.id]: cloneFlow(flow) },
        }));
  },

  replaceSavedFlow: (flow) => {
    set((state) => (state.flows.some((existing) => existing.id === flow.id)
      ? {
          flows: state.flows.map((existing) => (existing.id === flow.id ? cloneFlow(flow) : existing)),
          savedFlows: { ...state.savedFlows, [flow.id]: cloneFlow(flow) },
        }
      : state));
  },

  // Unsaved edits to the open flow outlive it as an unsaved copy: saving brings the flow back.
  dropRemovedFlow: (flowId) => {
    set((state) => {
      const open = state.flows.find((f) => f.id === flowId);
      const saved = state.savedFlows[flowId];
      const keepEdits = open !== undefined && state.selectedFlowId === flowId
        && saved !== undefined && JSON.stringify(open) !== JSON.stringify(saved);
      const savedFlows = Object.fromEntries(Object.entries(state.savedFlows).filter(([id]) => id !== flowId));
      if (keepEdits) return { savedFlows };
      return {
        flows: state.flows.filter((f) => f.id !== flowId),
        selectedFlowId: state.selectedFlowId === flowId ? null : state.selectedFlowId,
        savedFlows,
      };
    });
  },

  restoreFlow: (flowId) => {
    const saved = get().savedFlows[flowId];
    if (!saved) return;
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flowId ? cloneFlow(saved) : f)),
    }));
  },

  addStep: (flowId, type = 'shell', at) => {
    const t = useI18nStore.getState().t;
    const flow = get().flows.find(f => f.id === flowId);
    if (!flow) return null;
    const insertAt = at === undefined ? stepInsertIndex(flow.steps) : Math.max(0, Math.min(at, flow.steps.length));
    const existing = flow.steps;
    const sameTypeCount = existing.filter(s => s.type === type).length;
    const base = DEFAULT_OUTPUT_BASE[type] ?? type;
    // Counting from sameTypeCount + 1 keeps the usual names and never re-binds a deleted step's key.
    const autoKey = SKILLS_WITHOUT_OUTPUT_KEY.includes(type) ? undefined : nextFreeOutputKey(base, existing, sameTypeCount + 1);
    const step = createDefaultStep(type, autoKey, t);
    if (type === 'loop') {
      const source = findLoopSource(existing, insertAt);
      if (source) step.config.input = `{{${source.outputKey.trim()}}}`;
      step.config.loopVar = freeLoopVarName(existing, insertAt);
    }
    const newSteps: SkillInstance[] = [step];
    if (type === 'loop') newSteps.push(createDefaultStep('end_loop', undefined, t));
    else if (type === 'if') newSteps.push(createDefaultStep('end_if', undefined, t));
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const steps = [...f.steps];
        steps.splice(insertAt, 0, ...newSteps);
        return { ...f, steps };
      }),
    }));
    return step.id;
  },

  removeStep: (flowId, stepId) => {
    const flow = get().flows.find((f) => f.id === flowId);
    const idx = flow ? flow.steps.findIndex((s) => s.id === stepId) : -1;
    if (!flow || idx === -1) return null;
    const matchIdx = findMatchingMarker(flow.steps, idx);
    const at = (matchIdx === -1 ? [idx] : [idx, matchIdx]).sort((a, b) => a - b);
    const removed: RemovedSteps = at.map((index) => ({ index, step: flow.steps[index] }));
    const removeIds = new Set(removed.map((entry) => entry.step.id));
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flowId ? { ...f, steps: f.steps.filter((s) => !removeIds.has(s.id)) } : f)),
    }));
    return removed;
  },

  restoreRemovedSteps: (flowId, removed) => {
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const steps = [...f.steps];
        // Ascending, so each lands where it was among the ones put back before it.
        for (const { index, step } of removed) {
          if (steps.some((s) => s.id === step.id)) continue;
          steps.splice(Math.min(index, steps.length), 0, step);
        }
        return { ...f, steps };
      }),
    }));
  },

  duplicateStep: (flowId, stepId) => {
    const flow = get().flows.find((f) => f.id === flowId);
    const idx = flow ? flow.steps.findIndex((s) => s.id === stepId) : -1;
    const copied = flow && idx >= 0 ? copyStepBlock(flow.steps, idx) : null;
    if (!copied) return null;
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const steps = [...f.steps];
        steps.splice(copied.insertAt, 0, ...copied.copies);
        return { ...f, steps };
      }),
    }));
    return copied.copies[0].id;
  },

  updateStep: (flowId, stepId, patch) => {
    set((state) => ({
      flows: state.flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              steps: f.steps.map((s) =>
                s.id === stepId ? { ...s, ...patch } : s,
              ),
            }
          : f,
      ),
    }));
  },

  moveStep: (flowId, stepId, direction) => {
    const flow = get().flows.find((f) => f.id === flowId);
    const idx = flow ? flow.steps.findIndex((s) => s.id === stepId) : -1;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (!flow || idx < 0 || targetIdx < 0 || targetIdx >= flow.steps.length) return { ok: false, reason: 'edge' };
    const steps = [...flow.steps];
    [steps[idx], steps[targetIdx]] = [steps[targetIdx], steps[idx]];
    // A flow that is already broken can still be moved, so the buttons remain a way to repair it.
    const issue = checkBlockStructure(flow.steps) ? null : checkBlockStructure(steps);
    if (issue) return { ok: false, reason: issue.kind === 'outsideLoop' ? 'outsideLoop' : 'block' };
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flowId ? { ...f, steps } : f)),
    }));
    return { ok: true };
  },

  reorderSteps: (flowId, activeId, overId) => {
    if (activeId === overId) return;
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const steps = f.steps;
        const from = steps.findIndex((s) => s.id === activeId);
        const to = steps.findIndex((s) => s.id === overId);
        if (from < 0 || to < 0) return f;
        const active = steps[from];
        let spanStart = from;
        let spanEnd = from;
        if (active.type === 'loop' || active.type === 'if') {
          const match = findMatchingMarker(steps, from);
          if (match >= 0) { spanStart = Math.min(from, match); spanEnd = Math.max(from, match); }
        }
        if (to >= spanStart && to <= spanEnd) return f;
        const block = steps.slice(spanStart, spanEnd + 1);
        const rest = [...steps.slice(0, spanStart), ...steps.slice(spanEnd + 1)];
        const overIdx = rest.findIndex((s) => s.id === overId);
        if (overIdx < 0) return f;
        const insertAt = from < to ? overIdx + 1 : overIdx;
        rest.splice(insertAt, 0, ...block);
        return { ...f, steps: rest };
      }),
    }));
  },

  updateTrigger: (flowId, trigger) => {
    set((state) => ({
      flows: state.flows.map((f) =>
        f.id === flowId ? { ...f, trigger } : f,
      ),
    }));
  },

  addExtraTrigger: (flowId) => {
    set((state) => ({
      flows: state.flows.map((f) =>
        f.id === flowId
          ? { ...f, extraTriggers: [...(f.extraTriggers ?? []), { type: 'cron' } as TriggerConfig] }
          : f,
      ),
    }));
  },

  updateExtraTrigger: (flowId, index, trigger) => {
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const extra = [...(f.extraTriggers ?? [])];
        if (index < 0 || index >= extra.length) return f;
        extra[index] = trigger;
        return { ...f, extraTriggers: extra };
      }),
    }));
  },

  removeExtraTrigger: (flowId, index) => {
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const extra = (f.extraTriggers ?? []).filter((_, i) => i !== index);
        return { ...f, extraTriggers: extra.length ? extra : undefined };
      }),
    }));
  },

  // Main broadcasts every flow's run, so only the open flow's logs are kept. The check reads the
  // selection inside set(): a listener closure would compare against a stale selection.
  appendExecutionLog: (log) => {
    set((state) => (log.flowId === state.selectedFlowId
      ? { executionLogs: [...state.executionLogs.slice(-499), log] }
      : state));
  },

  markFlowRunning: (flowId) => {
    set((state) => {
      const ran = state.savedFlows[flowId];
      return {
        runningFlowIds: state.runningFlowIds.includes(flowId)
          ? state.runningFlowIds
          : [...state.runningFlowIds, flowId],
        runSnapshots: ran
          ? { ...state.runSnapshots, [flowId]: Object.fromEntries(ran.steps.map((step) => [step.id, stepRunKey(step)])) }
          : state.runSnapshots,
      };
    });
  },

  markFlowDone: (flowId) => {
    set((state) => ({
      runningFlowIds: state.runningFlowIds.filter((id) => id !== flowId),
    }));
  },

  importFlows: async (incoming) => {
    const existingNames = new Set(get().flows.map((f) => f.name));
    const preparedFlows: FlowDefinition[] = [];

    for (const raw of incoming) {
      const id = createId();
      let name = raw.name ?? 'Imported Flow';
      if (existingNames.has(name)) {
        name = `${name} Copy`;
      }
      existingNames.add(name);
      preparedFlows.push({
        ...raw,
        id,
        name,
        // Read-state checkpoints are keyed by step id: a copy sharing ids with another flow would
        // share its seen items and on_change value. New copy, new ids — as duplicate() does.
        steps: (raw.steps ?? []).map((s) => ({ ...s, id: createId(), config: { ...s.config } })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const lastFlow = preparedFlows[preparedFlows.length - 1];
    set((state) => ({
      flows: [...state.flows, ...preparedFlows],
      selectedFlowId: lastFlow?.id ?? state.selectedFlowId,
      executionLogs: [],
      executionResult: null,
    }));

    await Promise.all(preparedFlows.map((flow) => get().saveFlow(flow, 'import')));
  },
}));

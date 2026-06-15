import { create } from 'zustand';
import { useI18nStore } from './i18nStore';
import type {
  FlowDefinition,
  FlowExecutionLog,
  FlowExecutionResult,
  FlowGenerationResult,
  SkillInstance,
  SkillType,
  TriggerConfig,
} from '../../../shared/types';
import { flowApi } from '../api/electronApi';
import { cloneFlow, createDefaultFlow, createDefaultStep, createId, findMatchingMarker, DEFAULT_OUTPUT_BASE } from './flowHelpers';
import { SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';

interface ActionState {
  flows: FlowDefinition[];
  savedFlows: Record<string, FlowDefinition>;
  selectedFlowId: string | null;
  executionLogs: FlowExecutionLog[];
  executionResult: FlowExecutionResult | null;
  isExecuting: boolean;
  runningFlowIds: string[];

  loadFlows: () => Promise<void>;
  selectFlow: (flowId: string | null) => void;
  createFlow: () => Promise<void>;
  updateFlow: (flow: FlowDefinition) => void;
  saveFlow: (flow: FlowDefinition) => Promise<void>;
  deleteFlow: (flowId: string) => Promise<void>;
  duplicateFlow: (flowId: string) => Promise<FlowDefinition | null>;
  moveFlow: (flowId: string, direction: 'up' | 'down') => Promise<boolean>;
  reorderFlows: (orderedIds: string[]) => Promise<void>;
  executeFlow: (flowId: string) => Promise<FlowExecutionResult | null>;
  abortFlow: (flowId: string) => Promise<void>;
  generateFlow: (description: string) => Promise<FlowGenerationResult>;
  restoreFlow: (flowId: string) => void;
  addStep: (flowId: string, type?: SkillType) => void;
  removeStep: (flowId: string, stepId: string) => void;
  updateStep: (flowId: string, stepId: string, patch: Partial<SkillInstance>) => void;
  moveStep: (flowId: string, stepId: string, direction: 'up' | 'down') => void;
  reorderSteps: (flowId: string, activeId: string, overId: string) => void;
  updateTrigger: (flowId: string, trigger: TriggerConfig) => void;
  addExtraTrigger: (flowId: string) => void;
  updateExtraTrigger: (flowId: string, index: number, trigger: TriggerConfig) => void;
  removeExtraTrigger: (flowId: string, index: number) => void;
  appendExecutionLog: (log: FlowExecutionLog) => void;
  clearExecutionLogs: () => void;
  markFlowRunning: (flowId: string) => void;
  markFlowDone: (flowId: string) => void;
  importFlows: (flows: FlowDefinition[]) => Promise<void>;
}

export const useAgentFlowStore = create<ActionState>((set, get) => ({
  flows: [],
  savedFlows: {},
  selectedFlowId: null,
  executionLogs: [],
  executionResult: null,
  isExecuting: false,
  runningFlowIds: [],

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
    }));
    const saved = await flowApi.save(flow);
    if (saved) {
      set((state) => ({
        flows: state.flows.map((f) => (f.id === saved.id ? saved : f)),
        savedFlows: {
          ...state.savedFlows,
          [saved.id]: cloneFlow(saved),
        },
      }));
    }
  },

  updateFlow: (flow) => {
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flow.id ? flow : f)),
    }));
  },

  saveFlow: async (flow) => {
    const saved = await flowApi.save(flow);
    if (saved) {
      set((state) => ({
        flows: state.flows.map((f) => (f.id === saved.id ? saved : f)),
        savedFlows: {
          ...state.savedFlows,
          [saved.id]: cloneFlow(saved),
        },
      }));
    }
  },

  deleteFlow: async (flowId) => {
    await flowApi.deleteFlow(flowId);
    set((state) => ({
      flows: state.flows.filter((f) => f.id !== flowId),
      selectedFlowId: state.selectedFlowId === flowId ? null : state.selectedFlowId,
      savedFlows: Object.fromEntries(Object.entries(state.savedFlows).filter(([id]) => id !== flowId)),
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
      };
    });
    return duplicated;
  },

  moveFlow: async (flowId, direction) => {
    const moved = await flowApi.moveFlow(flowId, direction);
    if (!Array.isArray(moved) || moved.length === 0) return false;
    const savedFlows = Object.fromEntries(moved.map((flow) => [flow.id, cloneFlow(flow)]));
    set((state) => ({
      // Adopt only the order from the main process — keep in-memory flow
      // objects so unsaved editor edits survive the resync.
      flows: moved.map((f) => state.flows.find((cur) => cur.id === f.id) ?? f),
      selectedFlowId: state.selectedFlowId,
      savedFlows,
    }));
    return true;
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
    if (Array.isArray(reordered) && reordered.length > 0) {
      const savedFlows = Object.fromEntries(reordered.map((f) => [f.id, cloneFlow(f)]));
      set((state) => ({
        flows: reordered.map((f) => state.flows.find((cur) => cur.id === f.id) ?? f),
        savedFlows,
      }));
    }
  },

  executeFlow: async (flowId) => {
    set((state) => ({ isExecuting: true, executionLogs: [], executionResult: null, runningFlowIds: [...state.runningFlowIds.filter((id) => id !== flowId), flowId] }));
    try {
      const result = await flowApi.execute(flowId);
      set({ executionResult: result });
      return result;
    } finally {
      set((state) => ({ isExecuting: false, runningFlowIds: state.runningFlowIds.filter((id) => id !== flowId) }));
    }
  },

  abortFlow: async (flowId) => {
    await flowApi.abort(flowId);
  },

  generateFlow: async (description) => {
    const result = await flowApi.generate(description);
    if (result.ok) {
      set((state) => ({
        flows: [...state.flows, result.flow],
        selectedFlowId: result.flow.id,
        savedFlows: { ...state.savedFlows, [result.flow.id]: cloneFlow(result.flow) },
        executionLogs: [],
        executionResult: null,
      }));
    }
    return result;
  },

  restoreFlow: (flowId) => {
    const saved = get().savedFlows[flowId];
    if (!saved) return;
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flowId ? cloneFlow(saved) : f)),
    }));
  },

  addStep: (flowId, type = 'shell') => {
    const t = useI18nStore.getState().t;
    const flow = get().flows.find(f => f.id === flowId);
    const sameTypeCount = flow?.steps.filter(s => s.type === type).length ?? 0;
    const base = DEFAULT_OUTPUT_BASE[type] ?? type;
    const autoKey = SKILLS_WITHOUT_OUTPUT_KEY.includes(type) ? undefined : `${base}_${sameTypeCount + 1}`;
    const step = createDefaultStep(type, autoKey, t);
    if (type === 'loop' && flow && flow.steps.length > 0) {
      const lastOutputStep = [...flow.steps].reverse().find(s => {
        if (s.type === 'clipboard' || s.type === 'bot' || s.type === 'comment' || s.type === 'loop' || s.type === 'delay' || s.type === 'notify') return false;
        return true;
      });
      if (lastOutputStep) {
        step.config.input = `{{${lastOutputStep.outputKey}}}`;
      }
    }
    const newSteps: SkillInstance[] = [step];
    if (type === 'loop') newSteps.push(createDefaultStep('end_loop', undefined, t));
    else if (type === 'if') newSteps.push(createDefaultStep('end_if', undefined, t));
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const steps = [...f.steps];
        const last = steps[steps.length - 1];
        const insertAt = last && (last.type === 'end_loop' || last.type === 'end_if') ? steps.length - 1 : steps.length;
        steps.splice(insertAt, 0, ...newSteps);
        return { ...f, steps };
      }),
    }));
    const updatedFlow = get().flows.find(f => f.id === flowId);
    if (updatedFlow) void get().saveFlow(updatedFlow);
  },

  removeStep: (flowId, stepId) => {
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const idx = f.steps.findIndex((s) => s.id === stepId);
        if (idx === -1) return f;
        const removeIds = new Set<string>([stepId]);
        const matchIdx = findMatchingMarker(f.steps, idx);
        if (matchIdx !== -1) removeIds.add(f.steps[matchIdx].id);
        return { ...f, steps: f.steps.filter((s) => !removeIds.has(s.id)) };
      }),
    }));
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
    set((state) => ({
      flows: state.flows.map((f) => {
        if (f.id !== flowId) return f;
        const idx = f.steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return f;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= f.steps.length) return f;
        const steps = [...f.steps];
        [steps[idx], steps[targetIdx]] = [steps[targetIdx], steps[idx]];
        return { ...f, steps };
      }),
    }));
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

  appendExecutionLog: (log) => {
    set((state) => ({
      executionLogs: [...state.executionLogs.slice(-499), log],
    }));
  },

  clearExecutionLogs: () => {
    set({ executionLogs: [] });
  },

  markFlowRunning: (flowId) => {
    set((state) => ({
      runningFlowIds: state.runningFlowIds.includes(flowId)
        ? state.runningFlowIds
        : [...state.runningFlowIds, flowId],
    }));
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const lastFlow = preparedFlows[preparedFlows.length - 1];
    set((state) => ({
      flows: [...state.flows, ...preparedFlows],
      selectedFlowId: lastFlow?.id ?? state.selectedFlowId,
      executionLogs: [],
    }));

    const savedResults = await Promise.all(
      preparedFlows.map((flow) => flowApi.save(flow)),
    );
    const savedMap: Record<string, FlowDefinition> = {};
    const savedFlowsById: Record<string, FlowDefinition> = {};
    for (const saved of savedResults) {
      if (saved) {
        savedMap[saved.id] = saved;
        savedFlowsById[saved.id] = cloneFlow(saved);
      }
    }
    set((state) => ({
      flows: state.flows.map((f) => savedMap[f.id] ?? f),
      savedFlows: { ...state.savedFlows, ...savedFlowsById },
    }));
  },
}));

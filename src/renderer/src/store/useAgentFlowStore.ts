// src/renderer/src/store/useAgentFlowStore.ts — AgentFlow Zustand store
import { create } from 'zustand';
import { useI18nStore } from './i18nStore';
import type {
  FlowDefinition,
  FlowExecutionLog,
  FlowExecutionResult,
  SkillInstance,
  SkillType,
  TriggerConfig,
} from '../../../shared/types';
import { flowApi } from '../api/electronApi';

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultStep(type: SkillType = 'shell', outputKey?: string, t: (key: string) => string = (k) => k): SkillInstance {
  const id = createId();
  const configMap: Record<SkillType, Record<string, string>> = {
    shell: { command: '', windowsShell: 'cmd' },
    browser: { url: '' },
    llm: {
      prompt: '',
      provider: '',
      saveToHistory: 'false',
      exportFormat: '',
      exportTitle: '',
      exportFileName: '',
      exportShowProvider: 'false',
      exportShowTimestamp: 'false',
    },
    clipboard: { action: 'read', text: '' },
    utility: { action: 'delay', delayMs: '1000', title: '', body: '', format: 'png', content: '' },
    bot: { chatId: '', message: '' },
    rss: { url: '', fetchContent: 'false', checkpoint: '', lastLinks: '' },
    stop: { value: '' },
    comment: { note: '' },
    scraper: { url: '', itemSelector: '', titleSelector: '', linkSelector: '', maxItems: '5' },
    loop: { input: '', loopVar: 'item', limitIterations: 'true', maxIterations: '5' },
    end_loop: {},
  };
  const labelMap: Record<SkillType, string> = {
    shell: t('agentflow.skill.shell'),
    browser: t('agentflow.skill.browser'),
    llm: t('agentflow.skill.llm'),
    clipboard: t('agentflow.skill.clipboard'),
    utility: t('agentflow.skill.utility'),
    bot: t('agentflow.skill.bot'),
    rss: t('agentflow.skill.rss'),
    stop: t('agentflow.skill.stop'),
    comment: t('agentflow.skill.comment'),
    scraper: t('agentflow.skill.scraper'),
    loop: t('agentflow.skill.loop'),
    end_loop: t('agentflow.skill.end_loop'),
  };
  return {
    id,
    type,
    label: labelMap[type],
    config: configMap[type],
    outputKey: outputKey ?? (type === 'comment' || type === 'end_loop' ? '' : `${type}_1`),
  };
}

function createDefaultFlow(t: (key: string) => string = (k) => k): FlowDefinition {
  return {
    id: createId(),
    name: t('agentflow.newFlow'),
    description: t('agentflow.newFlow.desc'),
    enabled: true,
    trigger: { type: 'manual' },
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function cloneFlow(flow: FlowDefinition): FlowDefinition {
  return JSON.parse(JSON.stringify(flow)) as FlowDefinition;
}

interface ActionState {
  flows: FlowDefinition[];
  savedFlows: Record<string, FlowDefinition>;
  selectedFlowId: string | null;
  executionLogs: FlowExecutionLog[];
  executionResult: FlowExecutionResult | null;
  isExecuting: boolean;
  runningFlowIds: string[];

  // Actions
  loadFlows: () => Promise<void>;
  selectFlow: (flowId: string | null) => void;
  createFlow: () => Promise<void>;
  updateFlow: (flow: FlowDefinition) => void;
  saveFlow: (flow: FlowDefinition) => Promise<void>;
  deleteFlow: (flowId: string) => Promise<void>;
  duplicateFlow: (flowId: string) => Promise<FlowDefinition | null>;
  moveFlow: (flowId: string, direction: 'up' | 'down') => Promise<boolean>;
  executeFlow: (flowId: string) => Promise<FlowExecutionResult | null>;
  restoreFlow: (flowId: string) => void;
  addStep: (flowId: string, type?: SkillType) => void;
  removeStep: (flowId: string, stepId: string) => void;
  updateStep: (flowId: string, stepId: string, patch: Partial<SkillInstance>) => void;
  moveStep: (flowId: string, stepId: string, direction: 'up' | 'down') => void;
  updateTrigger: (flowId: string, trigger: TriggerConfig) => void;
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
    // Optimistic update: show the flow immediately so the user sees it at once
    // and any concurrent operations (e.g. moveFlow) do not lose it.
    set((state) => ({
      flows: [...state.flows, flow],
      selectedFlowId: flow.id,
      executionLogs: [],
    }));
    // Persist to disk; update local entry with the server-confirmed copy.
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
      flows: moved,
      selectedFlowId: state.selectedFlowId,
      savedFlows,
    }));
    return true;
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
    const outputKey = `${type}_${sameTypeCount + 1}`;
    const step = createDefaultStep(type, outputKey, t);
    // Auto-populate previous array variable if type is 'loop'
    if (type === 'loop' && flow && flow.steps.length > 0) {
      const lastOutputStep = [...flow.steps].reverse().find(s => {
        if (s.type === 'clipboard' || s.type === 'bot' || s.type === 'comment' || s.type === 'loop') return false;
        if (s.type === 'utility') return s.config.action === 'export';
        return true;
      });
      if (lastOutputStep) {
        step.config.input = `{{${lastOutputStep.outputKey}}}`;
      }
    }
    set((state) => ({
      flows: state.flows.map((f) =>
        f.id === flowId ? { ...f, steps: [...f.steps, step] } : f,
      ),
    }));
    // Auto-save immediately so the new step persists if the flow is moved
    // before the user manually triggers a save.
    const updatedFlow = get().flows.find(f => f.id === flowId);
    if (updatedFlow) void get().saveFlow(updatedFlow);
  },

  removeStep: (flowId, stepId) => {
    set((state) => ({
      flows: state.flows.map((f) =>
        f.id === flowId ? { ...f, steps: f.steps.filter((s) => s.id !== stepId) } : f,
      ),
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

  updateTrigger: (flowId, trigger) => {
    set((state) => ({
      flows: state.flows.map((f) =>
        f.id === flowId ? { ...f, trigger } : f,
      ),
    }));
  },

  appendExecutionLog: (log) => {
    set((state) => ({
      // Cap at 500 entries to prevent unbounded memory growth in long-running sessions.
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

    // Single state update for all prepared flows (avoids N re-renders)
    const lastFlow = preparedFlows[preparedFlows.length - 1];
    set((state) => ({
      flows: [...state.flows, ...preparedFlows],
      selectedFlowId: lastFlow?.id ?? state.selectedFlowId,
      executionLogs: [],
    }));

    // Persist all flows in parallel, then batch-update saved snapshots
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

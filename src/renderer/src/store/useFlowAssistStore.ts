import { create } from 'zustand';
import type { AssistChangeList } from '../../../shared/flowAssist';
import type { FlowBuildIssue, FlowDefinition } from '../../../shared/types';

/*
 * The flow editor's AI assistant, per flow and only in memory: what is running and the last thing
 * it came back with. One request at a time per flow; a newer one replaces the last result.
 */

export type AssistJobKind = 'edit' | 'explain' | 'names';

export interface AssistNameRow {
  stepId: string;
  /** 1-based, at the time of the request. */
  index: number;
  /** The step's label when the names were asked for; a step renamed since keeps its own. */
  before: string;
  name: string;
}

export type AssistResult =
  /** `base`: the draft it was made from (`assistBaseKey`); applying needs the draft unchanged. */
  | { kind: 'proposal'; change: string; flow: FlowDefinition; issues: FlowBuildIssue[]; paused: boolean; changes: AssistChangeList; base: string }
  | { kind: 'questions'; change: string; questions: string[] }
  | { kind: 'unchanged'; change: string }
  | { kind: 'explain'; markdown: string }
  | { kind: 'names'; rows: AssistNameRow[]; skipped: number }
  | { kind: 'applied'; what: 'edit' | 'names'; count: number }
  | { kind: 'error'; message: string; retry: AssistRetry | null };

export type AssistRetry =
  | { kind: 'edit'; change: string }
  | { kind: 'explain' }
  | { kind: 'names' };

export interface AssistThread {
  job: { kind: AssistJobKind; id: string } | null;
  result: AssistResult | null;
}

export type OutlineTab = 'steps' | 'assist';

interface FlowAssistState {
  threads: Record<string, AssistThread | undefined>;
  /** Which of the right pane's two tabs is showing. */
  tab: OutlineTab;
  /** Bumped to put the cursor in the assistant's box. */
  focusInput: number;
  /** The model it asks: AI flow building's, read from main when the panel first opens. */
  modelUrl: string;
  setModelUrl: (url: string) => void;
  setTab: (tab: OutlineTab) => void;
  requestInputFocus: () => void;
  patch: (flowId: string, patch: Partial<AssistThread>) => void;
  clear: (flowId: string) => void;
}

export const EMPTY_THREAD: AssistThread = { job: null, result: null };

export function threadOf(threads: FlowAssistState['threads'], flowId: string): AssistThread {
  return threads[flowId] ?? EMPTY_THREAD;
}

export const useFlowAssistStore = create<FlowAssistState>((set) => ({
  threads: {},
  tab: 'steps',
  focusInput: 0,
  modelUrl: '',
  setModelUrl: (modelUrl) => set({ modelUrl }),
  setTab: (tab) => set({ tab }),
  requestInputFocus: () => set((state) => ({ focusInput: state.focusInput + 1 })),
  patch: (flowId, patch) => set((state) => ({
    threads: { ...state.threads, [flowId]: { ...threadOf(state.threads, flowId), ...patch } },
  })),
  clear: (flowId) => set((state) => {
    if (!state.threads[flowId]) return state;
    const threads = { ...state.threads };
    delete threads[flowId];
    return { threads };
  }),
}));

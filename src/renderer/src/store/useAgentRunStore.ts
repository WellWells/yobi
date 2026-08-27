import { create } from 'zustand';
import type { AgentRunSummary, AgentStageLabel, AgentTracePayload } from '../../../shared/types';

export interface AgentTraceTurn {
  turn: number;
  tool?: string;
  config?: Record<string, string>;
  status: 'thinking' | 'running' | 'ok' | 'error';
  preview?: string;
  thought?: string;
  provider?: string;
  stage?: { label: AgentStageLabel; detail?: string };
  read?: string[];
}

export interface AgentPendingQuestion {
  runId: string;
  conversationPath: string;
  question: string;
}

export function answeringRun(
  pending: AgentPendingQuestion | null,
  conversationPath: string,
): AgentPendingQuestion | null {
  if (!pending) return null;
  return pending.conversationPath === conversationPath ? pending : null;
}

interface AgentRunStore {
  resumable: AgentRunSummary[];
  traces: Record<string, AgentTraceTurn[]>;
  plans: Record<string, { steps: string[]; done: number[] }>;
  synthesizing: Record<string, true>;
  pendingQuestion: AgentPendingQuestion | null;
  setResumable: (list: AgentRunSummary[]) => void;
  removeResumable: (runId: string) => void;
  setPendingQuestion: (pending: AgentPendingQuestion | null) => void;
  applyTrace: (payload: AgentTracePayload) => void;
}

function stagePatch(
  previous: AgentTraceTurn | undefined,
  label: AgentStageLabel,
  detail?: string,
): Partial<AgentTraceTurn> {
  if (label !== 'read') return { stage: { label, ...(detail ? { detail } : {}) } };
  const host = (detail ?? '').trim();
  const read = previous?.read ?? [];
  return {
    stage: { label: 'read' },
    read: !host || read.includes(host) ? read : [...read, host],
  };
}

export const useAgentRunStore = create<AgentRunStore>((set) => ({
  resumable: [],
  traces: {},
  plans: {},
  synthesizing: {},
  pendingQuestion: null,

  setResumable: (list) => set({ resumable: list }),
  removeResumable: (runId) => set((state) => ({ resumable: state.resumable.filter((r) => r.runId !== runId) })),
  setPendingQuestion: (pending) => set({ pendingQuestion: pending }),

  applyTrace: ({ runId, event }) => set((state) => {
    if (event.kind === 'done' || event.kind === 'question' || event.kind === 'failed' || event.kind === 'cancelled') {
      if (!(runId in state.traces) && !(runId in state.synthesizing) && !(runId in state.plans)) return state;
      const traces = { ...state.traces };
      const synthesizing = { ...state.synthesizing };
      const plans = { ...state.plans };
      delete traces[runId];
      delete synthesizing[runId];
      delete plans[runId];
      return { traces, synthesizing, plans };
    }
    if (event.kind === 'synthesizing') {
      return { synthesizing: { ...state.synthesizing, [runId]: true } };
    }
    if (event.kind === 'plan') {
      return { plans: { ...state.plans, [runId]: { steps: event.steps, done: event.done } } };
    }
    const turns = (state.traces[runId] ?? []).slice();
    const idx = turns.findIndex((t) => t.turn === event.turn);
    const previous = idx >= 0 ? turns[idx] : undefined;
    const patch: Partial<AgentTraceTurn> =
      event.kind === 'thinking' ? { status: 'thinking', ...(event.provider ? { provider: event.provider } : {}) }
      : event.kind === 'tool'
        ? { tool: event.tool, config: event.config, status: 'running', ...(event.thought ? { thought: event.thought } : {}) }
      : event.kind === 'stage' ? stagePatch(previous, event.label, event.detail)
      : { tool: event.tool, status: event.status, preview: event.preview, stage: undefined };
    if (idx >= 0) turns[idx] = { ...turns[idx], ...patch };
    else turns.push({ turn: event.turn, status: 'thinking', ...patch });
    return { traces: { ...state.traces, [runId]: turns } };
  }),
}));

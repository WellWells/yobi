import { create } from 'zustand';
import type { AgentCommandResult, AgentRunSummary, AgentStageLabel, AgentTracePayload } from '../../../shared/types';
import type { ResearchProgress } from '../../../shared/researchProgress';

export interface AgentTraceTurn {
  turn: number;
  tool?: string;
  config?: Record<string, string>;
  status: 'thinking' | 'running' | 'ok' | 'error';
  preview?: string;
  thought?: string;
  provider?: string;
  stage?: { label: AgentStageLabel; detail?: string };
  research?: ResearchProgress;
}

export interface AgentPendingQuestion {
  runId: string;
  conversationPath: string;
  question: string;
  /** The connectors disclosed when the question was asked; only the same set may answer it. */
  mcpServerIds?: readonly string[];
}

/** Set equality, order-independent — the ids arrive in whatever order the composer built them. */
export function sameConnectorScope(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * The pending question a send answers: same conversation and the same disclosed connector set.
 * Equality, not subset: toggling a connector before answering starts a new run.
 */
export function answeringRun(
  pending: AgentPendingQuestion | null,
  conversationPath: string,
  mcpServerIds?: readonly string[],
): AgentPendingQuestion | null {
  if (!pending) return null;
  if (pending.conversationPath !== conversationPath) return null;
  return sameConnectorScope(pending.mcpServerIds, mcpServerIds) ? pending : null;
}

/**
 * The question a call leaves waiting, or null. The composer's scope wins when the call had one;
 * otherwise the run's own connectors as main reports them (a run resumed from the banner has none).
 */
export function pendingQuestionFrom(
  res: AgentCommandResult,
  runId: string,
  composerScope?: readonly string[],
): AgentPendingQuestion | null {
  if (!res.success || !res.question) return null;
  const mcpServerIds = composerScope?.length ? composerScope : res.mcpServerIds;
  return {
    runId,
    conversationPath: res.filePath ?? '',
    question: res.question,
    ...(mcpServerIds?.length ? { mcpServerIds } : {}),
  };
}

/** A choice button, addressed to the run whose question offered it. */
export interface AgentChoicePick {
  runId: string;
  text: string;
}

/** The question a picked choice answers, or null when that question is no longer the one waiting. */
export function choiceAnswer(
  pending: AgentPendingQuestion | null,
  pick: AgentChoicePick,
): AgentPendingQuestion | null {
  return pending?.runId === pick.runId ? pending : null;
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
    // The research checklist outlives the observation: once the step ends it is the summary line.
    const patch: Partial<AgentTraceTurn> =
      event.kind === 'thinking' ? { status: 'thinking', ...(event.provider ? { provider: event.provider } : {}) }
      : event.kind === 'tool'
        ? { tool: event.tool, config: event.config, status: 'running', ...(event.thought ? { thought: event.thought } : {}) }
      : event.kind === 'stage' ? { stage: { label: event.label, ...(event.detail ? { detail: event.detail } : {}) } }
      : event.kind === 'research' ? { research: event.progress }
      : { tool: event.tool, status: event.status, preview: event.preview, stage: undefined };
    if (idx >= 0) turns[idx] = { ...turns[idx], ...patch };
    else turns.push({ turn: event.turn, status: 'thinking', ...patch });
    return { traces: { ...state.traces, [runId]: turns } };
  }),
}));

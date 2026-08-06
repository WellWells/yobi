import { create } from 'zustand';
import type { AgentRunSummary, AgentStageLabel, AgentTracePayload } from '../../../shared/types';

export interface AgentTraceTurn {
  turn: number;
  tool?: string;
  config?: Record<string, string>;
  status: 'thinking' | 'running' | 'ok' | 'error';
  preview?: string;
  /** The model's own one-line reason for this step. */
  thought?: string;
  /** Who is being asked, while this turn is still being decided. */
  provider?: string;
  /** What the step is doing right now; cleared when it finishes. */
  stage?: { label: AgentStageLabel; detail?: string };
  /** Hosts this step actually read, kept after it finishes — the disclosure is the point. */
  read?: string[];
}

/**
 * A run that stopped to ask the user something. Its question is already sitting in the
 * conversation, so the next agent-mode message typed into that same conversation is the
 * answer: it resumes this run instead of starting a new one.
 */
export interface AgentPendingQuestion {
  runId: string;
  /** '' for a temporary chat, which has no file. */
  conversationPath: string;
  question: string;
}

/**
 * Whether an agent-mode message is the reply to a pending question rather than a new goal.
 * It has to match on the conversation: the question lives in one conversation's transcript,
 * so a message typed anywhere else is a new goal, not an answer to something invisible.
 */
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
  /** Each run's checklist, so the UI can show where it is and not only what it just did. */
  plans: Record<string, { steps: string[]; done: number[] }>;
  /** Runs whose loop is over and are writing the final answer. */
  synthesizing: Record<string, true>;
  pendingQuestion: AgentPendingQuestion | null;
  setResumable: (list: AgentRunSummary[]) => void;
  removeResumable: (runId: string) => void;
  setPendingQuestion: (pending: AgentPendingQuestion | null) => void;
  applyTrace: (payload: AgentTracePayload) => void;
}

/**
 * A `read` stage names one page, and they arrive one at a time — they accumulate into a list
 * rather than overwriting each other, so the row ends up naming every source it used.
 */
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
      // The step is over: drop the live stage, keep what it read.
      : { tool: event.tool, status: event.status, preview: event.preview, stage: undefined };
    if (idx >= 0) turns[idx] = { ...turns[idx], ...patch };
    else turns.push({ turn: event.turn, status: 'thinking', ...patch });
    return { traces: { ...state.traces, [runId]: turns } };
  }),
}));

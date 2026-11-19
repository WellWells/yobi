import { create } from 'zustand';
import type { AgentCommandResult, AgentHelperStep, AgentRunSummary, AgentStageLabel, AgentTracePayload } from '../../../shared/types';
import type { ResearchProgress } from '../../../shared/researchProgress';
import { conversationMoveKey } from '../../../shared/conversationMove';
import { readsAnyPage } from '../../../shared/builtinConnectors';

export interface AgentTraceTurn {
  turn: number;
  tool?: string;
  config?: Record<string, string>;
  status: 'thinking' | 'running' | 'ok' | 'error';
  preview?: string;
  thought?: string;
  /** The model's own title for the step. */
  doing?: string;
  /** A `delegate` step: what its helper has done so far. */
  helperSteps?: AgentHelperStep[];
  provider?: string;
  stage?: { label: AgentStageLabel; detail?: string };
  research?: ResearchProgress;
  /**
   * A `delegate` row: the helper step whose research `research` is, and whether that call has
   * ended. Absent when the engine named none (then any helper call's start ends the checklist).
   */
  researchOwner?: { helperStep: number; settled: boolean };
}

export interface AgentPlanState {
  steps: string[];
  done: number[];
}

/**
 * The run as it stood at `done` or `question`: those events clear the rows, and the bubble stays up
 * until the turn is written, so the line and whatever is expanded hold through that gap.
 */
export interface AgentRunEnding {
  steps: AgentTraceTurn[];
  plan?: AgentPlanState;
  synthesizing: boolean;
  stage?: AgentStageLabel;
}

/** One attempt of a desktop run as its one-line header shows it. */
export interface AgentRunView {
  startedAt: number;
  /** The newest title the model wrote. Program text never goes here: it would outlive its step. */
  title?: string;
  /** Whether the user expanded it; survives a resume and carries into the finished turn. */
  open?: boolean;
  ending?: AgentRunEnding;
}

/** Whether the user has this run's trace expanded right now. */
export function runHeldOpen(runId: string | undefined): boolean {
  return Boolean(runId && useAgentRunStore.getState().runViews[runId]?.open);
}

/** Views stay after a run ends, for the finished turn to read; only so many are worth keeping. */
const MAX_RUN_VIEWS = 32;

/** Sets a view as the newest one and lets the oldest go. */
function withRunView(views: Record<string, AgentRunView>, runId: string, view: AgentRunView): Record<string, AgentRunView> {
  const next = { ...views };
  delete next[runId];
  next[runId] = view;
  for (const oldest of Object.keys(next).slice(0, -MAX_RUN_VIEWS)) delete next[oldest];
  return next;
}

export interface AgentPendingQuestion {
  runId: string;
  conversationPath: string;
  question: string;
  /** The connectors disclosed when the question was asked; only the same set may answer it. */
  mcpServerIds?: readonly string[];
}

/** A connector that comes for one message says nothing about what the answer to a question is for. */
function connectorsThatStay(ids: readonly string[] | undefined): Set<string> {
  return new Set((ids ?? []).filter((id) => !readsAnyPage(id)));
}

/** Set equality, order-independent — the ids arrive in whatever order the composer built them. */
export function sameConnectorScope(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const left = connectorsThatStay(a);
  const right = connectorsThatStay(b);
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

/**
 * The pending question once the conversation list changed: let go when its conversation is no
 * longer listed (deleted — main cancels the run whose question waited in it), so a send in a
 * conversation that comes back starts a new run. A temporary chat's question has no file and stays.
 */
export function pendingQuestionAfterListChange(
  pending: AgentPendingQuestion | null,
  listedPaths: readonly string[],
): AgentPendingQuestion | null {
  if (!pending?.conversationPath) return pending;
  const key = conversationMoveKey(pending.conversationPath);
  return listedPaths.some((listed) => conversationMoveKey(listed) === key) ? pending : null;
}

/** Lets the pending question go when the new conversation list no longer has its conversation. */
export function dropQuestionOfRemovedConversation(listedPaths: readonly string[]): void {
  const { pendingQuestion, setPendingQuestion } = useAgentRunStore.getState();
  if (pendingQuestionAfterListChange(pendingQuestion, listedPaths) === null && pendingQuestion) setPendingQuestion(null);
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

/**
 * A helper's calls once `step` has come in. The engine sends each call twice — when it starts (no
 * status) and when it ends (with one), the second a copy of the first plus the status — and sends no
 * index, so the end settles the first unsettled call that matches it. Two identical calls running
 * side by side read the same, so which of them it settles does not show.
 */
export function withHelperStep(steps: readonly AgentHelperStep[] | undefined, step: AgentHelperStep): AgentHelperStep[] {
  const list = [...(steps ?? [])];
  if (!step.status) return [...list, step];
  const at = list.findIndex((entry) => !entry.status
    && entry.tool === step.tool && entry.param === step.param && entry.doing === step.doing);
  if (at < 0) return [...list, step];
  list[at] = step;
  return list;
}

/**
 * A `delegate` row once its helper reports a call. The helper's research checklist and stage come
 * onto this row too (the engine forwards them under the delegate's step), so a call that starts
 * ends whatever the helper was at before: the row then shows what the helper is doing now — unless
 * the research that owns the checklist is still running (a quick read beside it would otherwise
 * wipe a checklist that is still filling, and the line would jump). `helperStep` is the helper's own
 * step the event is; without it, as before, every start ends the checklist.
 */
function helperPatch(row: AgentTraceTurn | undefined, step: AgentHelperStep, helperStep?: number): Partial<AgentTraceTurn> {
  const helperSteps = withHelperStep(row?.helperSteps, step);
  const owner = row?.researchOwner;
  if (step.status) {
    return owner && !owner.settled && owner.helperStep === helperStep
      ? { helperSteps, researchOwner: { ...owner, settled: true } }
      : { helperSteps };
  }
  if (owner && !owner.settled) return { helperSteps };
  return { helperSteps, stage: undefined, research: undefined, researchOwner: undefined };
}

/** A research checklist onto its row, owned by the helper step that sent it (when one did). */
function researchPatch(progress: ResearchProgress, helperStep?: number): Partial<AgentTraceTurn> {
  return helperStep === undefined
    ? { research: progress, researchOwner: undefined }
    : { research: progress, researchOwner: { helperStep, settled: false } };
}

interface AgentRunStore {
  resumable: AgentRunSummary[];
  traces: Record<string, AgentTraceTurn[]>;
  plans: Record<string, AgentPlanState>;
  synthesizing: Record<string, true>;
  runViews: Record<string, AgentRunView>;
  pendingQuestion: AgentPendingQuestion | null;
  setResumable: (list: AgentRunSummary[]) => void;
  removeResumable: (runId: string) => void;
  setPendingQuestion: (pending: AgentPendingQuestion | null) => void;
  setRunOpen: (runId: string, open: boolean) => void;
  applyTrace: (payload: AgentTracePayload) => void;
}

export const useAgentRunStore = create<AgentRunStore>((set) => ({
  resumable: [],
  traces: {},
  plans: {},
  synthesizing: {},
  runViews: {},
  pendingQuestion: null,

  setResumable: (list) => set({ resumable: list }),
  removeResumable: (runId) => set((state) => ({ resumable: state.resumable.filter((r) => r.runId !== runId) })),
  setPendingQuestion: (pending) => set({ pendingQuestion: pending }),
  setRunOpen: (runId, open) => set((state) => {
    const view = state.runViews[runId];
    return view ? { runViews: { ...state.runViews, [runId]: { ...view, open } } } : state;
  }),

  applyTrace: ({ runId, event }) => set((state) => {
    if (event.kind === 'done' || event.kind === 'question' || event.kind === 'failed' || event.kind === 'cancelled') {
      const abandoned = event.kind === 'failed' || event.kind === 'cancelled';
      const view = state.runViews[runId];
      const live = runId in state.traces || runId in state.synthesizing || runId in state.plans;
      if (!live && !(abandoned && view)) return state;
      const runViews = { ...state.runViews };
      if (abandoned) delete runViews[runId];
      // Past the guard above and only once: `question` comes twice, the second time with no rows left.
      else if (view && !view.ending) {
        const plan = state.plans[runId];
        const stage = state.traces[runId]?.at(-1)?.stage?.label;
        runViews[runId] = {
          ...view,
          ending: {
            steps: state.traces[runId] ?? [],
            synthesizing: runId in state.synthesizing,
            ...(plan ? { plan } : {}),
            ...(stage ? { stage } : {}),
          },
        };
      }
      const traces = { ...state.traces };
      const synthesizing = { ...state.synthesizing };
      const plans = { ...state.plans };
      delete traces[runId];
      delete synthesizing[runId];
      delete plans[runId];
      return { traces, synthesizing, plans, runViews };
    }
    if (event.kind === 'started') {
      const open = state.runViews[runId]?.open;
      return { runViews: withRunView(state.runViews, runId, { startedAt: event.at, ...(open ? { open } : {}) }) };
    }
    if (event.kind === 'synthesizing') {
      return { synthesizing: { ...state.synthesizing, [runId]: true } };
    }
    if (event.kind === 'plan') {
      return { plans: { ...state.plans, [runId]: { steps: event.steps, done: event.done } } };
    }
    const turns = (state.traces[runId] ?? []).slice();
    const idx = turns.findIndex((t) => t.turn === event.turn);
    // A dialog can close after the run ended: that must not bring back an empty trace.
    if (event.kind === 'answered' && idx < 0) return state;
    // The research checklist outlives the observation: once the step ends it is the summary line.
    const patch: Partial<AgentTraceTurn> =
      event.kind === 'thinking' ? { status: 'thinking', ...(event.provider ? { provider: event.provider } : {}) }
      : event.kind === 'tool'
        ? {
          tool: event.tool,
          config: event.config,
          status: 'running',
          ...(event.thought ? { thought: event.thought } : {}),
          ...(event.doing ? { doing: event.doing } : {}),
        }
      : event.kind === 'stage' ? { stage: { label: event.label, ...(event.detail ? { detail: event.detail } : {}) } }
      : event.kind === 'answered' ? { stage: undefined }
      : event.kind === 'research' ? researchPatch(event.progress, event.helperStep)
      : event.kind === 'helper' ? helperPatch(turns[idx], event.step, event.helperStep)
      : {
        tool: event.tool,
        status: event.status,
        preview: event.preview,
        stage: undefined,
        // A delegate's checklist was its helper's, which its record does not keep: a reopened run has none.
        ...(event.tool === 'delegate' ? { research: undefined, researchOwner: undefined } : {}),
      };
    if (idx >= 0) turns[idx] = { ...turns[idx], ...patch };
    else turns.push({ turn: event.turn, status: 'thinking', ...patch });
    // Only a call's start brings a title: its end is the same title again, and in a batch of helpers
    // it would put back an older one over the newest.
    const title = event.kind === 'tool' ? event.doing
      : event.kind === 'helper' && !event.step.status ? event.step.doing
      : undefined;
    const view = state.runViews[runId];
    return {
      traces: { ...state.traces, [runId]: turns },
      ...(title && view ? { runViews: { ...state.runViews, [runId]: { ...view, title } } } : {}),
    };
  }),
}));

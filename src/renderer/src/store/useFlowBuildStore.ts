import { create } from 'zustand';
import type {
  FlowBuildBlocker, FlowBuildPayload, FlowBuildPhase, FlowBuildReport, SkillType,
} from '../../../shared/types';

export type PhaseStatus = 'active' | 'done' | 'failed';

/**
 * What one build looks like right now. Assembled from the events the main process broadcasts,
 * never from a timer: a phase is shown as running because the phase is running.
 */
export interface FlowBuildState {
  phases: Partial<Record<FlowBuildPhase, PhaseStatus>>;
  /** Extra wording for the phase in flight, e.g. the generator being asked to fix its output. */
  detail?: string;
  skills: SkillType[];
  blocked: FlowBuildBlocker[];
  outline: string[];
  questions: string[];
  report?: FlowBuildReport;
  flowName?: string;
  /** Whichever model the build actually reached; the panel names it so nobody has to guess. */
  provider?: string;
  error?: { phase: FlowBuildPhase; message: string };
}

export const EMPTY_BUILD: FlowBuildState = {
  phases: {},
  skills: [],
  blocked: [],
  outline: [],
  questions: [],
};

interface FlowBuildStore {
  builds: Record<string, FlowBuildState>;
  /** Opens a slot so the panel can render the checklist before the first event lands. */
  startBuild: (buildId: string) => void;
  clearBuild: (buildId: string) => void;
  applyBuild: (payload: FlowBuildPayload) => void;
}

export function reduceBuild(state: FlowBuildState, event: FlowBuildPayload['event']): FlowBuildState {
  if (event.kind === 'phase') {
    return {
      ...state,
      phases: { ...state.phases, [event.phase]: event.status },
      // The detail belongs to the phase that is running; a finished phase carries none.
      ...(event.status === 'active' ? { detail: event.detail } : { detail: undefined }),
    };
  }
  if (event.kind === 'provider') return { ...state, provider: event.label };
  if (event.kind === 'tools') return { ...state, skills: event.skills, blocked: event.blocked };
  if (event.kind === 'outline') return { ...state, outline: event.outline };
  if (event.kind === 'questions') return { ...state, questions: event.questions, detail: undefined };
  if (event.kind === 'done') {
    return { ...state, report: event.report, flowName: event.flowName, detail: undefined };
  }
  return {
    ...state,
    error: { phase: event.phase, message: event.error },
    ...(event.blocked ? { blocked: event.blocked } : {}),
    detail: undefined,
  };
}

export const useFlowBuildStore = create<FlowBuildStore>((set) => ({
  builds: {},

  startBuild: (buildId) => set((state) => ({ builds: { ...state.builds, [buildId]: EMPTY_BUILD } })),

  clearBuild: (buildId) => set((state) => {
    if (!(buildId in state.builds)) return state;
    const builds = { ...state.builds };
    delete builds[buildId];
    return { builds };
  }),

  // Events for a build nobody opened a slot for still land: an `/agent` run starts building
  // without the chat turn knowing it was going to.
  applyBuild: ({ buildId, event }) => set((state) => ({
    builds: { ...state.builds, [buildId]: reduceBuild(state.builds[buildId] ?? EMPTY_BUILD, event) },
  })),
}));

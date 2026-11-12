/**
 * A web research as the checklist the user watches: every phase this run will go through, which
 * are done, which failed, and how far the counted ones have got. Main builds it from the search
 * pipeline's events and sends a whole snapshot each time; the renderer only draws it.
 */
/** `analyze` and `review` belong to a deep research: findings per sub-question, then the gap check. */
export type ResearchPhaseId = 'plan' | 'search' | 'read' | 'summarize' | 'analyze' | 'review' | 'write';

export type ResearchPhaseStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ResearchPhase {
  id: ResearchPhaseId;
  status: ResearchPhaseStatus;
  /** plan: the queries it settled on (a deep research: its sub-questions). review: the gaps it researches. */
  queries?: string[];
  /** search: how many results came back. */
  hits?: number;
  /** read, summarize, analyze, review: how many are finished out of `total`. */
  done?: number;
  total?: number;
  /** read: pages that could not be read, and the hosts they were on. */
  failed?: number;
  failedHosts?: string[];
  /** summarize: pages that had nothing on the question. */
  dropped?: number;
}

/** read / could not be read / cited by the answer; none: the page was never opened. */
export type ResearchResultState = 'read' | 'unreadable' | 'used';

/** One result a search returned, shown whether or not it was read. */
export interface ResearchResult {
  title: string;
  url: string;
  date?: string;
  state?: ResearchResultState;
}

export interface ResearchSearch {
  query: string;
  results: ResearchResult[];
  /** Every engine refused or failed this query. */
  refused?: true;
}

export interface ResearchProgress {
  phases: ResearchPhase[];
  /** How many sources the written answer cites; set once it is written. */
  sources?: number;
  /** Each query sent, with every result it returned, in the order they came back. */
  searches?: ResearchSearch[];
}

export const RESEARCH_PHASE_ORDER: readonly ResearchPhaseId[] = ['plan', 'search', 'read', 'summarize', 'analyze', 'review', 'write'];

/*
 * Rough shares of a run's wall time, over the phases it has. Reading, summarizing and a deep
 * research's findings are counted one by one, so they carry the bar; planning, searching and
 * writing are one call each and cannot say how far along they are.
 */
const PHASE_WEIGHT: Record<ResearchPhaseId, number> = { plan: 5, search: 5, read: 35, summarize: 35, analyze: 35, review: 15, write: 20 };

export interface ResearchFraction {
  /** 0-100. */
  value: number;
  /**
   * The running phase has no count to show. The bar then holds where the finished phases put it
   * and moves instead of creeping toward 99% — a single model call gives no honest midpoint.
   */
  indeterminate: boolean;
}

export function researchFraction(progress: ResearchProgress): ResearchFraction {
  const total = progress.phases.reduce((sum, phase) => sum + PHASE_WEIGHT[phase.id], 0);
  if (total === 0) return { value: 0, indeterminate: true };
  let value = 0;
  let indeterminate = false;
  for (const phase of progress.phases) {
    const share = (PHASE_WEIGHT[phase.id] / total) * 100;
    if (phase.status === 'done' || phase.status === 'failed') {
      value += share;
    } else if (phase.status === 'running') {
      if (phase.total) value += share * Math.min(phase.done ?? 0, phase.total) / phase.total;
      else indeterminate = true;
    }
  }
  return { value: Math.round(value), indeterminate };
}

export function researchFailed(progress: ResearchProgress): boolean {
  return progress.phases.some((phase) => phase.status === 'failed');
}

export function researchPhase(progress: ResearchProgress, id: ResearchPhaseId): ResearchPhase | undefined {
  return progress.phases.find((phase) => phase.id === id);
}

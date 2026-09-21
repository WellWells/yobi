export type TemporalFilter = 'day' | 'week' | 'month' | 'none';

/** The most queries one plan may hold. They are sent together, so this also sizes the DDG gate. */
export const MAX_PLAN_QUERIES = 3;

export interface QueryPlan {
  temporal: TemporalFilter;
  queries: string[];
  /** A follow-up rewritten to stand on its own, once the planner had the conversation to resolve it. */
  resolved?: string;
}

export interface SerpHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface SourceDoc {
  id: number;
  title: string;
  url: string;
  text: string;
  publishedAt?: string;
}

export interface SearchOutcome {
  answer: string;
  sources: SourceDoc[];
}

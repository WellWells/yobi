export type TemporalFilter = 'day' | 'week' | 'month' | 'none';

export interface QueryPlan {
  temporal: TemporalFilter;
  queries: string[];
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

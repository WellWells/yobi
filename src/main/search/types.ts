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
  /**
   * `YYYY-MM-DD`, absent when the page published no machine-readable date. It reaches the
   * synthesis prompt, where it is the only way the model can tell a 2019 page from last
   * week's — the difference between answering "the latest X" and answering some earlier X.
   */
  publishedAt?: string;
}

export interface SearchOutcome {
  answer: string;
  sources: SourceDoc[];
}

export type TemporalFilter = 'day' | 'week' | 'month' | 'none';

/** The most queries one plan may hold. They are sent together, so this also sizes the DuckDuckGo gate. */
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
  /** `YYYY-MM-DD`: the page's date as the engine showed it beside the result. */
  date?: string;
  /** Other copies of the same page (mirrors of one Reddit post), read in turn if this one fails. */
  alternates?: string[];
}

export interface SourceDoc {
  id: number;
  title: string;
  url: string;
  text: string;
  publishedAt?: string;
  /** Not read: the text is the engine's summary of the result (quick mode's breadth). */
  summaryOnly?: true;
}

/**
 * Who a search is for, when its query is not their words: an agent searches with keywords it wrote,
 * often in the place's own language, but answers the person's question in the person's language.
 */
export interface SearchAsker {
  /** Their own words. */
  words: string;
  /** The conversation those words continue, so a follow-up ("so it goes round in a loop?") reads. */
  history: string;
  /**
   * The "reply in the UI language" switch is on: the answer is in the UI language unless the words
   * ask for another, never in the language of whatever they quote or paste (`answerLanguageFor`).
   */
  uiLanguage?: boolean;
}

export interface SearchOutcome {
  answer: string;
  sources: SourceDoc[];
  /** Every engine refused some of the plan's queries; the rest answered. */
  partiallyBlocked?: boolean;
}

import { SEARCH_BLOCKED_KEY } from './blocked';

/** A search that ended without an answer, with the i18n key the user's message is built from. */
export class SearchPipelineError extends Error {
  readonly i18nKey: string;

  constructor(i18nKey: string, fallback: string) {
    super(fallback);
    this.i18nKey = i18nKey;
  }
}

/** Every engine refused every query: the caller turns this into `SearchBlockedError`. */
export function enginesBlockedError(): SearchPipelineError {
  return new SearchPipelineError(
    SEARCH_BLOCKED_KEY,
    'Every search engine is temporarily refusing requests (human verification or rate limit) — try again in a few minutes',
  );
}

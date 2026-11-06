/*
 * Dependency-free on purpose: `agentCall` imports this without pulling in the search pipeline
 * (page loader, Electron).
 */

/** The i18n key of the pipeline error raised when every engine refuses every query of a search. */
export const SEARCH_BLOCKED_KEY = 'search.error.enginesBlocked';

/**
 * What `/agent` reads instead of the user's localized "try again in a few minutes", which a model
 * takes as permission to retry at once against an engine that can only refuse again.
 */
export const SEARCH_BLOCKED_OBSERVATION =
  'Web search is temporarily blocked — do not call research or search again in this run; answer from what you know and say so.';

/** Appended to a research result when some of its queries were refused and the rest answered. */
export const SEARCH_PARTIAL_BLOCK_NOTE = 'some searches were blocked; fewer sources than usual.';

/**
 * Appended to an agent's research when the answer is not in the language it should be in. Not a
 * search block, but read by `agentCall` the same way: a field beside the answer, never inside it.
 */
export const RESEARCH_FOREIGN_LANGUAGE_NOTE =
  'this answer is not in the ANSWER LANGUAGE — do not deliver it as is; write the answer yourself, in it.';

/**
 * A research that failed because the engine is refusing us. The message stays the user's
 * localized text (a flow's run panel and notifications read it); the agent reads `agentObservation`.
 */
export class SearchBlockedError extends Error {
  readonly agentObservation = SEARCH_BLOCKED_OBSERVATION;

  constructor(localizedMessage: string) {
    super(localizedMessage);
    this.name = 'SearchBlockedError';
  }
}

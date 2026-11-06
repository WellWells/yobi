import { unwrapMarkdownLink } from '../../../shared/markdownLinkUnwrap';
import { agodaCanonicalUrl, isAgodaHotelUrl } from '../../agodaReviews';
import { isAgodaPromptFailure, readAgodaPrompt } from '../../agodaUrlPrompt';
import { sendLog } from '../../helpers';
import { getLangCache } from '../../i18n';
import { FlowAbortError, resolveStepTimeoutMs } from '../runtime';
import { execLlm } from '../skills/actions';
import type { FlowExecutorDeps } from '../types';

/*
 * A hotel's reputation from its Agoda reviews, for `/agent`.
 * This is the desktop chat's pasted-link read (`readAgodaPrompt`: newest + lowest-rated, fitted to
 * the model) followed by one analysis request, so the observation is the analysis — 100 reviews
 * would not fit any observation limit. Finding the link is the agent's own step: the search
 * engines return the hotel's Agoda reviews page, which the read takes like the hotel page.
 */

export const AGODA_REVIEWS_TOOL = 'agoda_reviews';

/** Tier 1: when to reach for it — before research, and how to get a link it does not have. */
export const AGODA_REVIEWS_BRIEF = '- "agoda_reviews": A hotel\'s Agoda + Booking.com guest reviews, analysed for "question" (user\'s words; blank = overview). For lodging reviews use it or gmap_reviews before research; no link: search "<hotel> agoda". config: "url" (REQUIRED).';

export const AGODA_REVIEWS_LINE = '- "agoda_reviews": A hotel\'s reputation from its Agoda guest reviews (Booking.com\'s for the same hotel come with them), read and analysed for the question. For lodging reviews use it and "gmap_reviews" before research. It needs the hotel\'s agoda.com page: without one, "search" "<hotel name> agoda" and pass the agoda.com/…/hotel/… or …/reviews/… link it returns. config keys: "url" (REQUIRED), "question" (the user\'s question in their words; blank = an overall report) → returns: an analysis of up to 100 sampled reviews (newest and lowest-rated), with the hotel\'s Agoda score and the sample\'s size and dates.';

export interface AgodaToolContext {
  deps: FlowExecutorDeps;
  providerUrl: string;
  signal?: AbortSignal;
}

export interface AgodaToolOutcome {
  observation: string;
  status: 'ok' | 'error';
}

const SEARCH_HINT = 'search "<hotel name> agoda" and pass the agoda.com hotel or reviews link it returns';

/** One `agoda_reviews` call: the analysis as the observation, or why there is none. */
export async function runAgodaReviews(config: Record<string, string>, ctx: AgodaToolContext): Promise<AgodaToolOutcome> {
  if (ctx.signal?.aborted) throw new FlowAbortError();
  const url = unwrapMarkdownLink(config.url ?? '');
  if (!url) return { observation: `ERROR: "url" is required: the hotel's agoda.com page. Without one, ${SEARCH_HINT}.`, status: 'error' };
  if (!isAgodaHotelUrl(url)) {
    return { observation: `ERROR: ${url} is not an Agoda hotel page. To find it, ${SEARCH_HINT}; or read the reviews with "research".`, status: 'error' };
  }
  const page = agodaCanonicalUrl(url);
  const question = (config.question ?? '').trim();
  const read = await readAgodaPrompt(page, question, {
    langData: getLangCache(),
    targetUrl: ctx.providerUrl,
    onLog: sendLog,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  }).catch((err: unknown) => {
    // Stop rejects with the signal's reason, whatever that is; the run expects its own abort.
    throw ctx.signal?.aborted ? new FlowAbortError() : err;
  });
  if (ctx.signal?.aborted) throw new FlowAbortError();
  if (isAgodaPromptFailure(read)) {
    sendLog(`🏨 [Agent] agoda_reviews: ${read.detail}`);
    if (read.failed === 'no-reviews') return { observation: `Agoda has no written guest review for ${page}.`, status: 'ok' };
    return { observation: `ERROR: Could not read the Agoda reviews of ${page}: ${read.detail}. Read the hotel's reviews with "research" instead.`, status: 'error' };
  }
  const deps: FlowExecutorDeps = { ...ctx.deps, getTargetUrl: () => ctx.providerUrl };
  const analysis = (await execLlm({ prompt: read.prompt, provider: ctx.providerUrl }, deps, resolveStepTimeoutMs('llm', deps), ctx.signal)).trim();
  if (!analysis) return { observation: `ERROR: The review analysis of ${page} came back empty.`, status: 'error' };
  return {
    observation: `Analysis of the Agoda guest reviews of ${page} — a sample of the newest and lowest-rated, not every review; keep its counts and dates as given:\n${analysis}`,
    status: 'ok',
  };
}

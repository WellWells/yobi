import { agodaReviewsPrompt, agodaSamplingLines, type AgodaPromptRefs, type AgodaSamplingFacts } from '../shared/agodaReviewsPrompt';
import { fillTemplate } from '../shared/fillTemplate';
import { isAgodaHotelUrl, loadAgodaReviews, type AgodaHotelReviews, type AgodaReview } from './agodaReviews';
import { measureFor } from './chat/conversationContext';
import { config } from './config';
import { splitUrlQuestion, type MapsQuestion } from './mapQuestion';
import { fitReviews } from './mapReviewsFit';
import { firstTurnLimit, type MapsPromptContext } from './mapUrlPrompt';

export interface AgodaPrompt {
  prompt: string;
  displayPrompt: string;
  title?: string;
}

/** One Agoda hotel link with a question around it. */
export function splitAgodaQuestion(text: string): MapsQuestion | null {
  return splitUrlQuestion(text, isAgodaHotelUrl);
}

type SampledReview = AgodaReview & { sample: 'newest' | 'lowest' };

/** A review as the model sees it: empty fields left out (the prompt says a missing field is unknown). */
function forModel({ sample: _sample, ...review }: SampledReview): Record<string, string | number> {
  return Object.fromEntries(Object.entries(review).filter(([, value]) => value !== '' && value !== 0));
}

function samplingFacts(kept: readonly SampledReview[], read: number, incomplete: string): AgodaSamplingFacts {
  const dates = kept.map((review) => review.date).filter(Boolean).sort();
  const bySource: Record<string, number> = {};
  for (const review of kept) bySource[review.source] = (bySource[review.source] ?? 0) + 1;
  return {
    newest: kept.filter((review) => review.sample === 'newest').length,
    lowest: kept.filter((review) => review.sample === 'lowest').length,
    dropped: read - kept.length,
    from: dates[0] ?? '',
    to: dates.at(-1) ?? '',
    bySource,
    incomplete,
  };
}

function promptFor(data: AgodaHotelReviews, facts: AgodaSamplingFacts, reviewsJson: string, question: string): string {
  const refs: AgodaPromptRefs = {
    hotel: data.hotel || data.url,
    score: data.score,
    scoreMax: data.scoreMax,
    total: data.total,
    sampling: agodaSamplingLines(facts),
    reviews: reviewsJson,
  };
  return agodaReviewsPrompt(refs, config.locale, question);
}

/** Why no analysis prompt came out, in English: for the log and for `/agent`'s observation. */
export interface AgodaPromptFailure {
  failed: 'no-reviews' | 'no-room' | 'read';
  detail: string;
}

export interface AgodaReadContext extends MapsPromptContext {
  /** Stop: the read rejects with the signal's reason instead of reporting a failure. */
  signal?: AbortSignal;
}

/**
 * The analysis prompt for an Agoda hotel link (and the question asked around it), with as many
 * whole reviews as fit the first turn on `ctx.targetUrl`, or why there is none.
 */
export async function readAgodaPrompt(url: string, question: string, ctx: AgodaReadContext): Promise<AgodaPrompt | AgodaPromptFailure> {
  const { langData } = ctx;
  ctx.onLog(langData['agodaReviews.log.fetching'] ?? '🏨 Agoda hotel detected — reading its reviews...');
  let data: AgodaHotelReviews;
  try {
    data = await loadAgodaReviews(url, { onLog: (message) => ctx.onLog(`🏨 ${message}`), ...(ctx.signal ? { signal: ctx.signal } : {}) });
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    return { failed: 'read', detail: err instanceof Error ? err.message : String(err) };
  }
  const reviews: SampledReview[] = data.samples.flatMap((sample) => sample.reviews.map((review) => ({ ...review, sample: sample.sort })));
  if (reviews.length === 0) return { failed: 'no-reviews', detail: 'Agoda returned no review with text' };
  const incomplete = data.samples.map((sample) => sample.error).filter(Boolean).join('; ');
  const measure = measureFor(ctx.targetUrl);
  // Fitted against the longest the sampling lines can read (every review kept, as many again
  // dropped), so the real lines written after the fit never push the prompt past the limit.
  const skeleton = promptFor(data, samplingFacts(reviews, reviews.length * 2, incomplete), '[]', question);
  const room = firstTurnLimit(ctx.targetUrl, measure) - measure(skeleton) + measure('[]');
  const entries = reviews.map((review) => ({ ...forModel(review), rating: review.rating }));
  const fitted = new Set(fitReviews(entries, room, measure));
  const kept = reviews.filter((_review, index) => fitted.has(entries[index]));
  if (kept.length === 0) return { failed: 'no-room', detail: 'Not a single review fits this model\'s input limit' };
  if (kept.length < reviews.length) ctx.onLog(`🏨 ${kept.length} of ${reviews.length} reviews fit this model's input limit`);
  ctx.onLog(fillTemplate(langData['agodaReviews.log.done'] ?? '🏨 {{count}} reviews read — wrapping analysis prompt...', { count: String(kept.length) }));

  const hotel = data.hotel || data.url;
  const displayPrompt = question
    ? fillTemplate(langData['agodaReviews.displayQuestion'] ?? '{{hotel}}: {{question}}', { hotel, question })
    : fillTemplate(langData['agodaReviews.displayPrompt'] ?? 'Agoda review analysis: {{hotel}}', { hotel });
  const title = data.hotel ? fillTemplate(langData['agodaReviews.title'] ?? 'Reviews: {{hotel}}', { hotel: data.hotel }) : undefined;
  const facts = samplingFacts(kept, reviews.length, incomplete);
  const reviewsJson = JSON.stringify(entries.filter((entry) => fitted.has(entry)));
  return { prompt: promptFor(data, facts, reviewsJson, question), displayPrompt, title };
}

export function isAgodaPromptFailure(result: AgodaPrompt | AgodaPromptFailure): result is AgodaPromptFailure {
  return 'failed' in result;
}

/**
 * `readAgodaPrompt` for a pasted link: null when there is no prompt, so the caller falls back to
 * what it does with any other link. The reason only reaches the log.
 */
export async function resolveAgodaPrompt(url: string, question: string, ctx: MapsPromptContext): Promise<AgodaPrompt | null> {
  const result = await readAgodaPrompt(url, question, ctx);
  if (!isAgodaPromptFailure(result)) return result;
  const fallback = question || result.failed === 'no-room' ? 'sending the message as typed' : 'falling back to page fetch';
  ctx.onLog(result.failed === 'read'
    ? `🏨 Agoda reviews read failed: ${result.detail} — ${fallback}`
    : `🏨 ${result.detail} — ${fallback}`);
  return null;
}

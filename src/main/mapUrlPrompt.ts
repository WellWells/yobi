import { isByokTargetUrl } from '../shared/types';
import { MEMORY_TOTAL_MAX_CHARS } from '../shared/userMemory';
import type { MapPlaceRef } from '../shared/conversationDoc';
import { mapPlaceReference, mapReviewsPrompt, type MapReviewsRefs } from '../shared/mapReviewsPrompt';
import { measureFor, promptCapFor } from './chat/conversationContext';
import { config } from './config';
import { sendLog } from './helpers';
import { getLangCache } from './i18n';
import { loadPlaceData, type PlaceData } from './mapPlaceCache';
import { localizedVerdict } from './mapPlaceStats';
import { fitReviews } from './mapReviewsFit';

/** Rule lines, tone/length/nickname, reply-language and title lines around the memory entries. */
const INSTRUCTION_SLACK = 2_000;

/**
 * An upper bound on the instruction the task prepends once this prompt is built: a full memory in
 * CJK (the costliest script under a byte cap) plus the user's custom instructions, which are uncapped.
 */
export function instructionReserve(measure: (text: string) => number): number {
  const customInstructions = config.promptPreferences.customInstructions ?? '';
  return measure('字'.repeat(MEMORY_TOTAL_MAX_CHARS)) + measure(customInstructions) + INSTRUCTION_SLACK;
}

export interface MapsPromptContext {
  langData: Record<string, string>;
  targetUrl: string;
  onLog: (message: string) => void;
}

export interface MapsPrompt {
  prompt: string;
  displayPrompt: string;
  title?: string;
  map: MapPlaceRef;
}

interface FittedPrompt {
  text: string;
  kept: number;
}

function fitPlacePrompt(
  data: PlaceData,
  place: string,
  langData: Record<string, string>,
  build: (refs: MapReviewsRefs) => string,
  limit: number,
  measure: (text: string) => number,
): FittedPrompt {
  const { verdict } = localizedVerdict(data.stats?.rating ?? '', data.stats?.total ?? '', langData);
  const refsWith = (reviews: string): MapReviewsRefs => ({
    place,
    reviews,
    rating: data.stats?.rating ?? '',
    total: data.stats?.total ?? '',
    positive: data.stats?.positive ?? '',
    distribution: data.stats?.distribution ?? '',
    verdict,
  });
  const room = limit - measure(build(refsWith('[]'))) + measure('[]');
  const reviews = fitReviews(data.reviews, room, measure);
  return { text: build(refsWith(JSON.stringify(reviews))), kept: reviews.length };
}

function firstTurnLimit(targetUrl: string, measure: (text: string) => number): number {
  const cap = isByokTargetUrl(targetUrl) ? config.byokContextBudgetChars : promptCapFor(targetUrl);
  return cap - instructionReserve(measure);
}

export async function resolveMapsPrompt(url: string, question: string, ctx: MapsPromptContext): Promise<MapsPrompt | null> {
  const { langData } = ctx;
  ctx.onLog(langData['mapReviews.log.fetching'] ?? '🗺️ Google Maps place detected — fetching reviews...');

  try {
    const data = await loadPlaceData(url, { hl: config.locale, onLog: (message) => ctx.onLog(`🗺️ ${message}`) });
    if (data.reviews.length === 0) return null;

    const place = data.place || url;
    const measure = measureFor(ctx.targetUrl);
    const { text: prompt, kept } = fitPlacePrompt(
      data,
      place,
      langData,
      (refs) => mapReviewsPrompt(refs, config.locale, question),
      firstTurnLimit(ctx.targetUrl, measure),
      measure,
    );
    if (kept === 0) {
      ctx.onLog('🗺️ Not a single review fits this model\'s input limit — sending the message as typed');
      return null;
    }
    if (kept < data.reviews.length) {
      ctx.onLog(`🗺️ ${kept} of ${data.reviews.length} reviews fit this model's input limit`);
    }
    ctx.onLog((langData['mapReviews.log.done'] ?? '🗺️ {{count}} reviews fetched — wrapping analysis prompt...')
      .replace('{{count}}', String(kept)));

    const displayPrompt = question
      ? (langData['mapReviews.displayQuestion'] ?? '{{place}}: {{question}}')
        .replace('{{place}}', () => place)
        .replace('{{question}}', () => question)
      : (langData['mapReviews.displayPrompt'] ?? 'Google Maps review analysis: {{place}}')
        .replace('{{place}}', () => place);
    const title = data.place
      ? (langData['mapReviews.title'] ?? 'Reviews: {{place}}').replace('{{place}}', () => data.place)
      : undefined;
    return { prompt, displayPrompt, title, map: { url: data.placeUrl, place: data.place } };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const fallback = question ? 'sending the message as typed' : 'falling back to page fetch';
    ctx.onLog(`🗺️ Maps reviews fetch failed: ${errMsg} — ${fallback}`);
    return null;
  }
}

/** The place data a replayed follow-up re-attaches; '' when it cannot be rebuilt. */
export async function buildPlaceContext(
  ref: MapPlaceRef,
  limit: number,
  measure: (text: string) => number,
): Promise<string> {
  try {
    const data = await loadPlaceData(ref.url, { hl: config.locale, onLog: (message) => sendLog(`🗺️ ${message}`) });
    const place = data.place || ref.place || ref.url;
    if (data.reviews.length === 0) return '';
    const { text, kept } = fitPlacePrompt(data, place, getLangCache(), mapPlaceReference, limit, measure);
    if (kept === 0) return '';
    sendLog(`🗺️ Re-attached ${kept} review(s) of "${place}" to this follow-up`);
    return text;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    sendLog(`🗺️ Could not re-attach the reviews of "${ref.place || ref.url}": ${errMsg} — sending the message without them`);
    return '';
  }
}

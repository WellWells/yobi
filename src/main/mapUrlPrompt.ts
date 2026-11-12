import { isByokTargetUrl } from '../shared/types';
import { MEMORY_TOTAL_MAX_CHARS } from '../shared/userMemory';
import type { MapPlaceRef } from '../shared/conversationDoc';
import { MAP_REPORT_PROMPT_TOO_LONG, mapPlaceReference, mapReviewsPrompt, type MapReviewsRefs } from '../shared/mapReviewsPrompt';
import { measureFor, promptCapFor } from './chat/conversationContext';
import { config } from './config';
import { sendLog } from './helpers';
import { getLangCache } from './i18n';
import { loadPlaceData, type PlaceData } from './mapPlaceCache';
import { localizedVerdict } from './mapPlaceStats';
import { fitReviews } from './mapReviewsFit';
import { fillTemplate } from '../shared/fillTemplate';
import { resolveAnalysisTarget } from './linkAnalysis';

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
  /** A provider command names the model for this request, overriding the function setting. */
  preserveTarget?: boolean;
}

export interface MapsPrompt {
  prompt: string;
  displayPrompt: string;
  title?: string;
  map: MapPlaceRef;
  forceProviderUrl?: string;
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
  let reviews = fitReviews(data.reviews, room, measure);
  let text = build(refsWith(JSON.stringify(reviews)));
  // Repeated placeholders and fenced data can cost more than one raw JSON array. Search the
  // review budget against the finished prompt, preserving whole reviews and the final question.
  if (reviews.length > 0 && measure(text) > limit) {
    let lower = 0;
    let upper = measure(JSON.stringify(reviews)) - 1;
    reviews = [];
    text = build(refsWith('[]'));
    while (lower <= upper) {
      const budget = Math.floor((lower + upper) / 2);
      const candidate = fitReviews(data.reviews, budget, measure);
      const prompt = build(refsWith(JSON.stringify(candidate)));
      if (measure(prompt) > limit) {
        upper = budget - 1;
        continue;
      }
      reviews = candidate;
      text = prompt;
      lower = budget + 1;
    }
  }
  return { text, kept: reviews.length };
}

/** What a first turn's prompt may take on `targetUrl`, after the instruction the task prepends. */
export function firstTurnLimit(targetUrl: string, measure: (text: string) => number): number {
  const cap = isByokTargetUrl(targetUrl) ? config.byokContextBudgetChars : promptCapFor(targetUrl);
  return cap - instructionReserve(measure);
}

export async function resolveMapsPrompt(url: string, question: string, ctx: MapsPromptContext): Promise<MapsPrompt | null> {
  const { langData } = ctx;
  const targetUrl = ctx.preserveTarget ? ctx.targetUrl : resolveAnalysisTarget('maps', ctx.targetUrl);
  ctx.onLog(langData['mapReviews.log.fetching'] ?? '🗺️ Google Maps place detected — fetching reviews...');

  try {
    const data = await loadPlaceData(url, { hl: config.locale, onLog: (message) => ctx.onLog(`🗺️ ${message}`) });
    if (data.reviews.length === 0) return null;

    const place = data.place || url;
    const measure = measureFor(targetUrl);
    const { text: prompt, kept } = fitPlacePrompt(
      data,
      place,
      langData,
      (refs) => mapReviewsPrompt(refs, config.locale, question, config.linkAnalysis?.mapsPrompt),
      firstTurnLimit(targetUrl, measure),
      measure,
    );
    if (kept === 0) {
      if (config.linkAnalysis?.mapsPrompt.trim()) throw new Error(MAP_REPORT_PROMPT_TOO_LONG);
      ctx.onLog('🗺️ Not a single review fits this model\'s input limit — sending the message as typed');
      return null;
    }
    if (kept < data.reviews.length) {
      ctx.onLog(`🗺️ ${kept} of ${data.reviews.length} reviews fit this model's input limit`);
    }
    ctx.onLog(fillTemplate(langData['mapReviews.log.done'] ?? '🗺️ {{count}} reviews fetched — wrapping analysis prompt...', { count: String(kept) }));

    const displayPrompt = question
      ? fillTemplate(langData['mapReviews.displayQuestion'] ?? '{{place}}: {{question}}', { place, question })
      : fillTemplate(langData['mapReviews.displayPrompt'] ?? 'Google Maps review analysis: {{place}}', { place });
    const title = data.place
      ? fillTemplate(langData['mapReviews.title'] ?? 'Reviews: {{place}}', { place: data.place })
      : undefined;
    return {
      prompt, displayPrompt, title, map: { url: data.placeUrl, place: data.place },
      ...(targetUrl !== ctx.targetUrl ? { forceProviderUrl: targetUrl } : {}),
    };
  } catch (err) {
    if (err instanceof Error && err.message === MAP_REPORT_PROMPT_TOO_LONG) throw err;
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

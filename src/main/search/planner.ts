import { runByokCompletion } from '../providers/byokClient';
import { fenceUntrusted } from '../../shared/promptFencing';
import { extractJsonFromLlmResponse } from '../../shared/llmJsonExtract';
import { sendLog } from '../helpers';
import { planQuery } from './router';
import { MAX_PLAN_QUERIES } from './types';
import { languageForLocale, runWorkerCompletion } from './synthesize';
import type { QueryPlan, TemporalFilter } from './types';

const PLANNER_TIMEOUT_MS = 20_000;
/*
 * A browser provider answers on its own schedule and the whole search waits behind it, so the
 * planner gets a fraction of the answer's 300 s: past this the follow-up is better searched
 * verbatim than not at all.
 */
const WEB_PLANNER_TIMEOUT_MS = 90_000;

/**
 * The planner never fails a search: a plan that could not be read, or a call that never came
 * back, falls through to the regex plan the pipeline used before there was a planner at all.
 */
async function runPlanner(
  query: string,
  locale: string,
  history: string,
  complete: (prompt: string) => Promise<string>,
): Promise<QueryPlan> {
  const heuristic = planQuery(query);
  try {
    const response = await complete(buildPlannerPrompt(query, locale, history));
    const parsed = parsePlan(response);
    if (parsed) {
      // A browser model keeps to the schema only most of the time, and the half it drops is the
      // silent one: the queries improve, the question everything downstream reads does not.
      if (history && !parsed.resolved) {
        sendLog('🔎 [Search] planner returned no rewrite — ranking against the sentence as typed');
      }
      return {
        temporal: parsed.temporal ?? heuristic.temporal,
        queries: parsed.queries,
        // Only asked for, and only trusted, when there was a conversation to resolve against —
        // otherwise a volunteered rewrite would silently replace a question nothing was wrong with.
        ...(history && parsed.resolved ? { resolved: parsed.resolved } : {}),
      };
    }
    sendLog('🔎 [Search] planner response unparseable — using heuristic plan');
  } catch (err) {
    sendLog(`🔎 [Search] planner failed (${err instanceof Error ? err.message : String(err)}) — using heuristic plan`);
  }
  return heuristic;
}

export function planQueryLlm(
  query: string,
  targetUrl: string,
  locale: string,
  history = '',
): Promise<QueryPlan> {
  return runPlanner(query, locale, history, async (prompt) => {
    const { response } = await runByokCompletion(targetUrl, prompt, PLANNER_TIMEOUT_MS);
    return response;
  });
}

/**
 * The same plan, asked for through the only channel a browser provider has: the worker window.
 * The prompt is identical — what differs is the price (a whole extra round trip on the lane the
 * answer also needs) and the answer's cleanliness, which `parsePlan` absorbs.
 */
export function planQueryWeb(
  query: string,
  targetUrl: string,
  locale: string,
  history: string,
): Promise<QueryPlan> {
  return runPlanner(query, locale, history, (prompt) =>
    runWorkerCompletion(prompt, targetUrl, WEB_PLANNER_TIMEOUT_MS, 'planner'));
}

/*
 * The conversation is what turns a bare follow-up back into a searchable question, so the
 * planner gets it and answers with both halves: the queries an engine can match, and the
 * request rewritten to name its own subject for everything downstream.
 */
function historySection(history: string): string[] {
  if (!history) return [];
  return [
    '',
    'EARLIER CONVERSATION IN THIS CHAT:',
    fenceUntrusted('conversation', history),
    'The request below is the user\'s NEXT message in that conversation. It may be a follow-up',
    'that never names its own subject — resolve any pronoun, "the second one" or unsaid topic',
    'from the conversation above. A search engine sees only the queries you write, nothing else.',
  ];
}

function buildPlannerPrompt(query: string, locale: string, history: string): string {
  const language = languageForLocale(locale);
  return [
    'You plan web searches. Read the user request and return ONLY a JSON object, no prose, no code fence:',
    history
      ? '{"temporal":"day"|"week"|"month"|"none","queries":["...","..."],"resolved":"..."}'
      : '{"temporal":"day"|"week"|"month"|"none","queries":["...","..."]}',
    '- temporal: how recent results must be; "none" if timing does not matter.',
    `- queries: 2-3 concrete search-engine queries. Include one refined in the user's language (${language}),`,
    '  one English variant, and optionally one from a different angle. Strip filler words; keep proper nouns.',
    ...(history
      ? [
          `- resolved: the request rewritten as ONE self-contained question in ${language}, with every`,
          '  pronoun and unsaid subject replaced by what it refers to. Someone who never saw the',
          '  conversation must be able to answer it. Keep the user\'s own question — do not widen it.',
        ]
      : []),
    ...historySection(history),
    '',
    'THE REQUEST TO PLAN FOR:',
    fenceUntrusted('request', query),
  ].join('\n');
}

interface ParsedPlan {
  temporal?: TemporalFilter;
  queries: string[];
  resolved?: string;
}

/*
 * A browser provider's reply is read back as Markdown, and its renderer turns every bare URL
 * into `[url](url)` on the way out. A search query is not Markdown, so a link that points at
 * its own label is undone; anything else is left alone, being text the user may have written.
 */
function stripAutoLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((\S+?)\)/g, (match, label: string, href: string) =>
    (label === href || label === href.replace(/\/$/, '') ? href : match));
}

function cleanField(text: string): string {
  return stripAutoLinks(text).trim();
}

function parsePlan(raw: string): ParsedPlan | null {
  const parsed = extractJsonFromLlmResponse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const queries = Array.isArray(obj.queries)
    ? obj.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map(cleanField)
        .filter((q) => q.length > 0)
        .slice(0, MAX_PLAN_QUERIES)
    : [];
  if (queries.length === 0) return null;

  const temporal: TemporalFilter | undefined =
    obj.temporal === 'day' || obj.temporal === 'week' || obj.temporal === 'month' || obj.temporal === 'none'
      ? obj.temporal
      : undefined;
  const resolved = typeof obj.resolved === 'string' ? cleanField(obj.resolved) : '';
  return { temporal, queries, ...(resolved ? { resolved } : {}) };
}

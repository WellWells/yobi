import { runByokCompletion } from '../providers/byokClient';
import { sendLog } from '../helpers';
import { planQuery } from './router';
import { languageForLocale } from './synthesize';
import type { QueryPlan, TemporalFilter } from './types';

const PLANNER_TIMEOUT_MS = 20_000;
const MAX_QUERIES = 3;

export async function planQueryLlm(query: string, targetUrl: string, locale: string): Promise<QueryPlan> {
  const heuristic = planQuery(query);
  try {
    const { response } = await runByokCompletion(targetUrl, buildPlannerPrompt(query, locale), PLANNER_TIMEOUT_MS);
    const parsed = parsePlan(response);
    if (parsed) {
      return {
        temporal: parsed.temporal ?? heuristic.temporal,
        queries: parsed.queries,
      };
    }
    sendLog('🔎 [Search] planner response unparseable — using heuristic plan');
  } catch (err) {
    sendLog(`🔎 [Search] planner failed (${err instanceof Error ? err.message : String(err)}) — using heuristic plan`);
  }
  return heuristic;
}

function buildPlannerPrompt(query: string, locale: string): string {
  const language = languageForLocale(locale);
  return [
    'You plan web searches. Read the user request and return ONLY a JSON object, no prose, no code fence:',
    '{"temporal":"day"|"week"|"month"|"none","queries":["...","..."]}',
    '- temporal: how recent results must be; "none" if timing does not matter.',
    `- queries: 2-3 concrete search-engine queries. Include one refined in the user's language (${language}),`,
    '  one English variant, and optionally one from a different angle. Strip filler words; keep proper nouns.',
    '',
    `User request: ${query}`,
  ].join('\n');
}

interface ParsedPlan {
  temporal?: TemporalFilter;
  queries: string[];
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function parsePlan(raw: string): ParsedPlan | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const queries = Array.isArray(obj.queries)
    ? obj.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim())
        .slice(0, MAX_QUERIES)
    : [];
  if (queries.length === 0) return null;

  const temporal: TemporalFilter | undefined =
    obj.temporal === 'day' || obj.temporal === 'week' || obj.temporal === 'month' || obj.temporal === 'none'
      ? obj.temporal
      : undefined;
  return { temporal, queries };
}

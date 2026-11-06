import { isByokTargetUrl } from '../../shared/types';
import { citationHost } from '../../shared/citations';
import { truncateToCharsPlusBreaks } from '../../shared/textBudget';
import { answerLanguageFor } from '../../shared/answerLanguage';
import { languageForLocale } from '../../shared/localeLanguage';
import { Semaphore } from '../flow/lanes';
import { sendLog } from '../helpers';
import { runByokCompletion } from '../providers/byokClient';
import { resendIfGeminiCapFell } from '../providers/geminiPromptTooLong';
import { reserveForHistory, synthesisBudget, UNBOUNDED } from './budgets';
import {
  buildDeepPlanPrompt, buildDeepReportPrompt, buildFindingsPrompt, buildReviewPrompt, MISSING_MARKER,
  parseDeepPlan, parseFollowups,
} from './deepPrompts';
import type { DeepPlan, Finding, SubQuestion } from './deepPrompts';
import { extractRelevant } from './extract';
import { fuseRankings, hitKey } from './fuse';
import { harvest, HARVEST_SPARE_TARGETS, selectTargets } from './harvest';
import { mapConcurrency } from './mapReduce';
import { enginesBlockedError, SearchPipelineError } from './pipelineError';
import { distinctQueries } from './queryNormalize';
import { rankHits } from './rank';
import { planQuery } from './router';
import { searchWeb, SerpChallengeError } from './serp';
import { linkifyCitations, runWorkerCompletion, synthesize } from './synthesize';
import type { SearchProgress } from './index';
import type { SearchAsker, SearchOutcome, SerpHit, SourceDoc, TemporalFilter } from './types';

const WEB_CALL_TIMEOUT_MS = 300_000;
const BYOK_CALL_TIMEOUT_MS = 120_000;
/** Pages read per sub-question: a web provider's prompt holds fewer. */
const WEB_SOURCES_PER_QUESTION = 3;
const BYOK_SOURCES_PER_QUESTION = 4;

type Report = ((progress: SearchProgress) => void) | undefined;

function complete(prompt: string, targetUrl: string, label: string): Promise<string> {
  if (isByokTargetUrl(targetUrl)) {
    return runByokCompletion(targetUrl, prompt, BYOK_CALL_TIMEOUT_MS).then(({ response }) => response);
  }
  return runWorkerCompletion(prompt, targetUrl, WEB_CALL_TIMEOUT_MS, label);
}

/** The lead's plan; a plan that could not be read becomes one sub-question, i.e. a standard research. */
async function planDeep(query: string, targetUrl: string, locale: string, history: string): Promise<DeepPlan> {
  try {
    const plan = parseDeepPlan(await complete(buildDeepPlanPrompt(query, locale, history), targetUrl, 'deep plan'), Boolean(history));
    if (plan) return plan;
    sendLog('🔬 [Deep] plan unparseable — researching the request as one question');
  } catch (err) {
    sendLog(`🔬 [Deep] plan failed (${err instanceof Error ? err.message : String(err)}) — researching the request as one question`);
  }
  const heuristic = planQuery(query);
  return { temporal: heuristic.temporal, subquestions: [{ question: query, queries: heuristic.queries }] };
}

/** Across the whole research: the next query's place (see `searchWeb`), and how many were refused. */
interface SearchTally {
  slot: number;
  asked: number;
  refused: number;
  queries: string[];
}

async function searchQuestion(question: SubQuestion, temporal: TemporalFilter, locale: string, tally: SearchTally): Promise<SerpHit[]> {
  const run = async (filter: TemporalFilter): Promise<SerpHit[]> => {
    const queries = distinctQueries(question.queries);
    const lists = await Promise.all(queries.map((query) => {
      const slot = tally.slot++;
      tally.asked += 1;
      tally.queries.push(query);
      return searchWeb(query, filter, locale, slot).catch((err: unknown) => {
        if (err instanceof SerpChallengeError) tally.refused += 1;
        sendLog(`🔬 [Deep] "${query}" — ${err instanceof Error ? err.message : String(err)}`);
        return [] as SerpHit[];
      });
    }));
    return fuseRankings(lists);
  };
  const hits = await run(temporal);
  return hits.length > 0 || temporal === 'none' ? hits : run('none');
}

/** Each question's pages to read, best first; a page goes to the first question that ranked it. */
function claimTargets(questions: readonly SubQuestion[], hits: readonly SerpHit[][], perQuestion: number, claimed: Set<string>): SerpHit[][] {
  return questions.map((question, index) => {
    const ranked = rankHits(hits[index], [question.question, ...question.queries].join('\n'));
    const targets = selectTargets(ranked.filter((hit) => !claimed.has(hitKey(hit.url))), perQuestion + HARVEST_SPARE_TARGETS, true);
    for (const target of targets) claimed.add(hitKey(target.url));
    return targets;
  });
}

/** Gives every page the number it keeps for the whole research, and adds it to the pool. */
function numberDocs(docs: readonly SourceDoc[], pool: SourceDoc[]): SourceDoc[] {
  return docs.map((doc) => {
    const numbered = { ...doc, id: pool.length + 1 };
    pool.push(numbered);
    return numbered;
  });
}

async function readQuestions(
  questions: readonly SubQuestion[],
  hits: readonly SerpHit[][],
  perQuestion: number,
  claimed: Set<string>,
  pool: SourceDoc[],
  onProgress: Report,
  more: boolean,
): Promise<SourceDoc[][]> {
  const targets = claimTargets(questions, hits, perQuestion, claimed);
  const count = targets.reduce((sum, list) => sum + Math.min(list.length, perQuestion), 0);
  onProgress?.(more ? { stage: 'fetchingMore', count } : { stage: 'fetching', count });
  const read = await Promise.all(targets.map((list) => harvest(
    list,
    perQuestion,
    (url) => onProgress?.({ stage: 'read', host: citationHost(url) }),
    undefined,
    (url) => onProgress?.({ stage: 'readFailed', host: citationHost(url) }),
  )));
  return read.map((docs) => numberDocs(docs, pool));
}

/** One researcher's report: its pages packed to the prompt, under their research-wide numbers. */
async function findingFor(question: SubQuestion, docs: readonly SourceDoc[], targetUrl: string, locale: string): Promise<Finding> {
  if (docs.length === 0) return { question: question.question, text: '' };
  const idByUrl = new Map(docs.map((doc) => [doc.url, doc.id]));
  const packed = extractRelevant([...docs], [question.question, ...question.queries].join('\n'), synthesisBudget(targetUrl))
    .map((doc) => ({ ...doc, id: idByUrl.get(doc.url) ?? doc.id }));
  try {
    const text = (await complete(buildFindingsPrompt(question.question, packed, locale), targetUrl, 'deep findings')).trim();
    sendLog(`🔬 [Deep] findings for "${question.question}" — ${text.length} chars from ${packed.length} source(s)`);
    return { question: question.question, text };
  } catch (err) {
    sendLog(`🔬 [Deep] findings for "${question.question}" failed — ${err instanceof Error ? err.message : String(err)}`);
    return { question: question.question, text: '' };
  }
}

async function findingsFor(
  questions: readonly SubQuestion[],
  docs: readonly SourceDoc[][],
  targetUrl: string,
  locale: string,
  onEach: () => void,
): Promise<Finding[]> {
  // BYOK researchers run side by side, one per free key; a web provider has one window, so one at a time.
  const lane = new Semaphore(mapConcurrency(targetUrl));
  return Promise.all(questions.map((question, index) => lane.runExclusive(async () => {
    const finding = await findingFor(question, docs[index], targetUrl, locale);
    onEach();
    return finding;
  })));
}

/** Whether a gap check can change anything: a question came back empty or said what is missing. */
export function needsReview(findings: readonly Finding[]): boolean {
  return findings.some((finding) => !finding.text || finding.text.includes(MISSING_MARKER));
}

async function reviewFindings(question: string, findings: readonly Finding[], usedQueries: readonly string[], targetUrl: string, locale: string): Promise<SubQuestion[]> {
  try {
    return parseFollowups(await complete(buildReviewPrompt(question, findings, usedQueries, locale), targetUrl, 'deep review'));
  } catch (err) {
    sendLog(`🔬 [Deep] gap check failed (${err instanceof Error ? err.message : String(err)}) — writing from what was found`);
    return [];
  }
}

/** Each finding cut to its share of what the report prompt can hold now. */
function reportPrompt(question: string, findings: readonly Finding[], pool: readonly SourceDoc[], targetUrl: string, locale: string, history: string, language: string): string {
  const budget = reserveForHistory(synthesisBudget(targetUrl), history).charsPlusBreaks;
  const share = budget === UNBOUNDED ? UNBOUNDED : Math.floor(budget / Math.max(1, findings.length));
  const fitted = share === UNBOUNDED
    ? findings
    : findings.map((finding) => ({ ...finding, text: truncateToCharsPlusBreaks(finding.text, share) }));
  return buildDeepReportPrompt(question, fitted, pool, locale, history, new Date(), language);
}

/**
 * Deep research: the lead plans sub-questions; each is searched, read and reported on by a researcher
 * with research-wide source numbers; the lead checks the findings for gaps and researches at most
 * `MAX_FOLLOWUPS` of them once; the report is written from the findings, which already carry their
 * citations. On a web provider every model call is serial, so this is ~6-9 calls; on BYOK the
 * researchers run in parallel.
 */
export async function runDeepResearch(
  query: string,
  targetUrl: string,
  locale: string,
  onProgress: Report,
  history = '',
  asker?: SearchAsker,
): Promise<SearchOutcome> {
  const language = asker ? answerLanguageFor(asker.words, locale, asker.uiLanguage === true) : languageForLocale(locale);
  onProgress?.({ stage: 'outline', phases: ['plan', 'search', 'read', 'analyze', 'review', 'write'] });
  onProgress?.({ stage: 'planning', queries: [] });
  const plan = await planDeep(query, targetUrl, locale, history);
  const question = plan.resolved?.trim() || query;
  const questions = plan.subquestions;
  sendLog(`🔬 [Deep] ${questions.length} sub-question(s), temporal=${plan.temporal}: ${JSON.stringify(questions.map((q) => q.question))}`);
  onProgress?.({ stage: 'planning', queries: questions.map((q) => q.question) });

  const tally: SearchTally = { slot: 0, asked: 0, refused: 0, queries: [] };
  // One question after another: the engines see a research's queries trickle, not burst.
  const hits: SerpHit[][] = [];
  for (const sub of questions) hits.push(await searchQuestion(sub, plan.temporal, locale, tally));
  const found = hits.reduce((sum, list) => sum + list.length, 0);
  if (found === 0) {
    if (tally.asked > 0 && tally.refused === tally.asked) throw enginesBlockedError();
    throw new SearchPipelineError('search.error.noResults', 'No search results found');
  }
  onProgress?.({ stage: 'searched', hits: found });

  const perQuestion = isByokTargetUrl(targetUrl) ? BYOK_SOURCES_PER_QUESTION : WEB_SOURCES_PER_QUESTION;
  const pool: SourceDoc[] = [];
  const claimed = new Set<string>();
  const docs = await readQuestions(questions, hits, perQuestion, claimed, pool, onProgress, false);
  if (pool.length === 0) throw new SearchPipelineError('search.error.noSources', 'No source pages could be read');
  onProgress?.({ stage: 'analyzing' });

  onProgress?.({ stage: 'finding', total: questions.length });
  const findings = await findingsFor(questions, docs, targetUrl, locale, () => onProgress?.({ stage: 'found' }));

  onProgress?.({ stage: 'reviewing' });
  const followups = needsReview(findings) ? await reviewFindings(question, findings, tally.queries, targetUrl, locale) : [];
  sendLog(`🔬 [Deep] gap check: ${followups.length === 0 ? 'the findings are enough' : JSON.stringify(followups.map((q) => q.question))}`);
  onProgress?.({ stage: 'followups', questions: followups.map((q) => q.question) });
  const extra: Finding[] = [];
  if (followups.length > 0) {
    const moreHits: SerpHit[][] = [];
    for (const sub of followups) moreHits.push(await searchQuestion(sub, 'none', locale, tally));
    const moreDocs = await readQuestions(followups, moreHits, perQuestion, claimed, pool, onProgress, true);
    extra.push(...await findingsFor(followups, moreDocs, targetUrl, locale, () => onProgress?.({ stage: 'followedUp' })));
  }

  const all = [...findings, ...extra];
  if (all.every((finding) => !finding.text)) {
    throw new SearchPipelineError('search.error.noRelevant', 'No sources were relevant to the query');
  }
  onProgress?.({ stage: 'synthesizing' });
  sendLog(`🔬 [Deep] writing the report from ${all.length} finding(s) over ${pool.length} source(s)`);
  let prompt = reportPrompt(question, all, pool, targetUrl, locale, history, language);
  const raw = await resendIfGeminiCapFell(
    () => synthesize(prompt, targetUrl),
    (cap) => {
      sendLog(`🔬 [Deep] Gemini takes only ${cap} characters now — fitting the findings again`);
      prompt = reportPrompt(question, all, pool, targetUrl, locale, history, language);
    },
  );
  const partiallyBlocked = tally.refused > 0;
  return { answer: linkifyCitations(raw, pool), sources: pool, ...(partiallyBlocked ? { partiallyBlocked } : {}) };
}

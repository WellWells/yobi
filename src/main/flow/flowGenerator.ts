import type { BrowserWindow } from 'electron';
import type {
  FlowAssessResult, FlowAssessment, FlowBuildFailureReason, FlowDefinition, FlowGenerationResult, TriggerType,
} from '../../shared/types';
import { PROVIDER_URLS, TRIGGER_TYPES, isByokTargetUrl } from '../../shared/types';
import {
  ALWAYS_INCLUDED_SKILLS,
  MAX_ASSESS_QUESTIONS,
  buildFlowAssessPrompt,
  buildFlowAssessRepairPrompt,
  buildFlowEditPrompt,
  buildFlowEditRepairPrompt,
  buildFlowGenerationPrompt,
  buildFlowRepairPrompt,
  resolveSelectedSkills,
} from '../../shared/flowSkillSchema';
import { extractJsonFromLlmResponse, validateFlowCandidate } from '../../shared/flowValidation';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../providers';
import { runByokCompletion } from '../providers/byokClient';
import { sendLog } from '../helpers';
import { WORKER_WINDOW_UNAVAILABLE, workerWindowUnavailable } from '../workerWindowError';
import { llmLane } from './lanes';
import type { FlowExecutorDeps } from './types';

const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

/**
 * How many times a phase may ask before giving up, counting the first try. Browser-UI models often
 * wrap JSON in chatter, so one rejected reply is not proof the model cannot do it; but each attempt
 * is a full round trip, and a model shown its rejected output twice rarely recovers on a fourth.
 */
export const MAX_ATTEMPTS = 3;

const FALLBACK_PROVIDER_URL = PROVIDER_URLS.gemini;

/** Shared by both phases: which model to ask, and how each attempt reports itself. */
export interface FlowPhaseOptions {
  providerUrl?: string;
  /**
   * The model the request actually went to, once per phase. `pickProvider` may substitute one that
   * can hold the prompt, and the panel must show the substitution.
   */
  onProvider?: (resolvedUrl: string) => void;
  onAttempt?: (attempt: number, lastError?: string) => void;
}

export interface FlowGenerationOptions extends FlowPhaseOptions {
  preselected?: readonly string[];
  triggerHint?: TriggerType;
}

function pickProvider(prompt: string, preferred: string | undefined): { url: string; error?: string } {
  const candidate = preferred?.trim() ? preferred : FALLBACK_PROVIDER_URL;
  if (isByokTargetUrl(candidate)) return { url: candidate };

  if (!preparePromptForProvider(prompt, candidate).truncated) return { url: candidate };

  const fallback = preparePromptForProvider(prompt, FALLBACK_PROVIDER_URL);
  if (!fallback.truncated) {
    sendLog(`↩️ [Flow] ${getProviderLabel(candidate)} cannot hold the prompt — generating with ${getProviderLabel(FALLBACK_PROVIDER_URL)}`);
    return { url: FALLBACK_PROVIDER_URL };
  }
  return {
    url: FALLBACK_PROVIDER_URL,
    error: `The flow prompt (${prompt.length} chars) exceeds the ${getProviderLabel(FALLBACK_PROVIDER_URL)} input limit (${fallback.capLabel})`,
  };
}

async function resolveWorker(deps: FlowExecutorDeps): Promise<BrowserWindow | null> {
  const existing = deps.getWorkerWin();
  if (existing && !existing.isDestroyed()) return existing;
  return deps.ensureWorkerWin ? deps.ensureWorkerWin() : null;
}

async function ensureProviderReady(providerUrl: string, deps: FlowExecutorDeps): Promise<string | null> {
  if (isByokTargetUrl(providerUrl)) return null;
  const worker = await resolveWorker(deps);
  return worker && !worker.isDestroyed() ? null : WORKER_WINDOW_UNAVAILABLE;
}

async function askProvider(
  prompt: string,
  providerUrl: string,
  deps: FlowExecutorDeps,
  timeoutMs: number,
): Promise<string> {
  if (isByokTargetUrl(providerUrl)) {
    const { response } = await runByokCompletion(providerUrl, prompt, timeoutMs);
    return response;
  }
  const prepared = preparePromptForProvider(prompt, providerUrl);
  return llmLane.runExclusive(async () => {
    const win = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
    if (!win || win.isDestroyed()) throw workerWindowUnavailable();
    const result = await runAutomation(win, prepared.prompt, timeoutMs, providerUrl);
    return result.response;
  });
}

const VERDICTS = new Set<FlowAssessment['verdict']>(['full', 'partial', 'none']);
const TRIGGERS = new Set<TriggerType>(TRIGGER_TYPES);

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, limit);
}

export function validateAssessment(json: unknown): FlowAssessResult {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'The assessment must be a single JSON object' };
  }
  const obj = json as Record<string, unknown>;
  const requested = readStringArray(obj.skills, 40);
  if (requested.length === 0) {
    return { ok: false, error: 'The assessment needs a non-empty "skills" array' };
  }
  const skills = resolveSelectedSkills(requested);
  if (!skills.some((type) => !ALWAYS_INCLUDED_SKILLS.includes(type))) {
    return { ok: false, error: 'None of the named skills exist' };
  }
  const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict.trim().toLowerCase() : '';
  const verdict = VERDICTS.has(verdictRaw as FlowAssessment['verdict'])
    ? (verdictRaw as FlowAssessment['verdict'])
    : 'partial';
  const triggerRaw = typeof obj.trigger === 'string' ? obj.trigger.trim().toLowerCase() : '';
  const trigger = TRIGGERS.has(triggerRaw as TriggerType) ? (triggerRaw as TriggerType) : 'manual';
  return {
    ok: true,
    assessment: {
      skills,
      trigger,
      outline: readStringArray(obj.outline, 10),
      gaps: readStringArray(obj.gaps, 6),
      questions: readStringArray(obj.questions, MAX_ASSESS_QUESTIONS),
      verdict,
    },
  };
}

export async function assessFlowSupport(
  goal: string,
  deps: FlowExecutorDeps,
  options: FlowPhaseOptions = {},
): Promise<FlowAssessResult> {
  const { providerUrl, onAttempt } = options;
  const trimmed = goal.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;
  let lastError = 'The assessment must be a single JSON object';
  let lastResponse = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = attempt === 1
      ? buildFlowAssessPrompt(trimmed)
      : buildFlowAssessRepairPrompt(trimmed, lastResponse, lastError);

    const picked = pickProvider(prompt, providerUrl);
    if (picked.error) {
      // On a retry the original prompt already fitted, so stop with the reason the reply was
      // rejected rather than with a size complaint about the prompt that was never sent.
      if (attempt > 1) return { ok: false, error: lastError, reason: 'invalid_output' };
      sendLog(`❌ [Flow] ${picked.error}`);
      return { ok: false, error: picked.error };
    }
    const notReady = await ensureProviderReady(picked.url, deps);
    if (notReady) return { ok: false, error: notReady };

    if (attempt === 1) options.onProvider?.(picked.url);
    onAttempt?.(attempt, attempt > 1 ? lastError : undefined);
    sendLog(attempt === 1
      ? `🔎 [Flow] Assessing skill coverage via ${getProviderLabel(picked.url)}…`
      : `🔁 [Flow] Assessment attempt ${attempt}/${MAX_ATTEMPTS} — asking ${getProviderLabel(picked.url)} to fix: ${lastError}`);

    try {
      lastResponse = await askProvider(prompt, picked.url, deps, timeoutMs);
    } catch (err) {
      // A request that never came back is not a model that answered badly. Retrying it would
      // spend another full timeout on the same broken worker, so it ends the phase.
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`❌ [Flow] Assessment failed: ${message}`);
      return { ok: false, error: message };
    }

    const result = validateAssessment(extractJsonFromLlmResponse(lastResponse));
    if (result.ok) {
      const suffix = attempt > 1 ? ` (attempt ${attempt})` : '';
      sendLog(`✅ [Flow] Assessment: ${result.assessment.verdict}, ${result.assessment.skills.length} skills${suffix}`);
      return result;
    }

    lastError = result.error;
    const willRetry = attempt < MAX_ATTEMPTS;
    sendLog(`❌ [Flow] Assessment rejected: ${lastError}${willRetry ? ' — asking again' : ` (gave up after ${MAX_ATTEMPTS} attempts)`}`);
  }

  // `lastError` is the validator talking to the model; `reason` is what the user is told.
  return { ok: false, error: lastError, reason: 'invalid_output' };
}

export async function generateFlowDefinition(
  description: string,
  deps: FlowExecutorDeps,
  options: FlowGenerationOptions = {},
): Promise<FlowGenerationResult> {
  const trimmed = description.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  let skills = options.preselected ? [...options.preselected] : [];
  let triggerHint = options.triggerHint;
  if (skills.length === 0) {
    const assessed = await assessFlowSupport(trimmed, deps, { ...(options.providerUrl ? { providerUrl: options.providerUrl } : {}) });
    if (!assessed.ok) return assessed;
    if (assessed.assessment.verdict === 'none') {
      return {
        ok: false,
        error: assessed.assessment.gaps[0] ?? 'No Yobi skill can carry out this request',
      };
    }
    skills = assessed.assessment.skills;
    triggerHint = assessed.assessment.trigger;
  }

  const compiled = await compileFlow(
    (attempt, lastResponse, lastError) => (attempt === 1
      ? buildFlowGenerationPrompt(trimmed, skills, triggerHint)
      : buildFlowRepairPrompt(trimmed, skills, lastResponse, lastError, triggerHint)),
    deps,
    options,
    { verb: 'Generating', disclosed: skills.length },
  );
  return compiled.ok ? { ok: true, flow: compiled.flow } : compiled;
}

export type FlowRevisionResult =
  | {
    ok: true;
    flow: FlowDefinition;
    /** The "id" the reply gave each step, in step order: an existing step's id, or nothing for a new one. */
    stepIds: Array<string | undefined>;
  }
  | { ok: false; error: string; reason?: FlowBuildFailureReason };

function unwrapCandidate(json: unknown): Record<string, unknown> | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  return obj.flow && typeof obj.flow === 'object' && !Array.isArray(obj.flow) ? obj.flow as Record<string, unknown> : obj;
}

/**
 * The whole flow again with one change made. The variables are put back into the reply before it
 * is validated rather than shown to the model: steps may reference `{{var.x}}`, the check rejects
 * a reference to an undeclared variable, and the declarations carry the values the user filled in.
 */
export async function reviseFlowDefinition(
  flow: FlowDefinition,
  change: string,
  skills: readonly string[],
  deps: FlowExecutorDeps,
  options: FlowPhaseOptions = {},
): Promise<FlowRevisionResult> {
  if (!change.trim()) return { ok: false, error: 'Empty change request' };
  let stepIds: Array<string | undefined> = [];
  const compiled = await compileFlow(
    (attempt, lastResponse, lastError) => (attempt === 1
      ? buildFlowEditPrompt(flow, change, skills)
      : buildFlowEditRepairPrompt(flow, change, skills, lastResponse, lastError)),
    deps,
    options,
    { verb: 'Revising', disclosed: skills.length },
    (json) => {
      const inner = unwrapCandidate(json);
      if (!inner) return json;
      stepIds = Array.isArray(inner.steps)
        ? inner.steps.map((step) => {
          const id = (step as Record<string, unknown> | null)?.id;
          return typeof id === 'string' && id.trim() ? id.trim() : undefined;
        })
        : [];
      return flow.variables?.length ? { ...inner, variables: flow.variables } : inner;
    },
  );
  return compiled.ok ? { ok: true, flow: compiled.flow, stepIds } : compiled;
}

/**
 * The attempt loop both a new flow and a revision go through: pick a provider that holds the
 * prompt, ask, validate, and on a rejected reply ask again with the rejection quoted back.
 */
async function compileFlow(
  promptAt: (attempt: number, lastResponse: string, lastError: string) => string,
  deps: FlowExecutorDeps,
  options: FlowPhaseOptions,
  label: { verb: string; disclosed: number },
  prepare: (json: unknown) => unknown = (json) => json,
): Promise<FlowGenerationResult> {
  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;
  let lastError = 'Could not generate a valid flow';
  let lastResponse = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    options.onAttempt?.(attempt, attempt > 1 ? lastError : undefined);
    const promptText = promptAt(attempt, lastResponse, lastError);

    const picked = pickProvider(promptText, options.providerUrl);
    if (picked.error) {
      if (attempt > 1) {
        sendLog(`⚠️ [Flow] Repair prompt exceeds the input limit — skipping the retry`);
        return { ok: false, error: lastError, reason: 'invalid_output' };
      }
      sendLog(`❌ [Flow] ${picked.error}`);
      return { ok: false, error: picked.error };
    }
    const notReady = await ensureProviderReady(picked.url, deps);
    if (notReady) return { ok: false, error: notReady };

    if (attempt === 1) options.onProvider?.(picked.url);
    sendLog(attempt === 1
      ? `🤖 [Flow] ${label.verb} flow via ${getProviderLabel(picked.url)} (${label.disclosed} skills disclosed)…`
      : `🔁 [Flow] ${label.verb} attempt ${attempt}/${MAX_ATTEMPTS} — asking ${getProviderLabel(picked.url)} to fix: ${lastError}`);

    try {
      lastResponse = await askProvider(promptText, picked.url, deps, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`❌ [Flow] Flow generation request failed: ${message}`);
      return { ok: false, error: message };
    }

    const json = extractJsonFromLlmResponse(lastResponse);
    if (json === null) {
      lastError = 'No JSON found in the AI response';
    } else {
      const validation = validateFlowCandidate(prepare(json));
      if (validation.ok) {
        const suffix = attempt > 1 ? ' (after retry)' : '';
        sendLog(`✅ [Flow] ${label.verb} done: "${validation.flow.name}" (${validation.flow.steps.length} steps)${suffix}`);
        return validation;
      }
      lastError = validation.error;
    }

    const willRetry = attempt < MAX_ATTEMPTS;
    sendLog(`❌ [Flow] Invalid generated flow: ${lastError}${willRetry ? ' — asking again' : ` (gave up after ${MAX_ATTEMPTS} attempts)`}`);
  }

  return { ok: false, error: lastError, reason: 'invalid_output' };
}

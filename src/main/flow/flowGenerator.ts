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
  /** The skills the assessment picked; generation never assesses on its own. */
  preselected: readonly string[];
  triggerHint: TriggerType;
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
  const trimmed = goal.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  const asked = await askUntilValid(
    (attempt, lastResponse, lastError) => (attempt === 1
      ? buildFlowAssessPrompt(trimmed)
      : buildFlowAssessRepairPrompt(trimmed, lastResponse, lastError)),
    deps,
    options,
    {
      name: 'Assessment',
      start: (provider) => `🔎 [Flow] Assessing skill coverage via ${provider}…`,
      // A reply with no JSON reaches the validator as null, and its own wording is what the
      // repair prompt quotes back.
      validate: (json) => {
        const result = validateAssessment(json);
        return result.ok
          ? { ok: true, value: result.assessment, summary: `${result.assessment.verdict}, ${result.assessment.skills.length} skills` }
          : result;
      },
    },
  );
  return asked.ok ? { ok: true, assessment: asked.value } : asked;
}

/** Judges a reply as a flow; `prepare` reshapes the JSON before the check (a revision's unwrapping). */
function judgeFlow(prepare: (json: unknown) => unknown = (json) => json): AttemptPhase<FlowDefinition>['validate'] {
  return (json) => {
    if (json === null) return { ok: false, error: 'No JSON found in the AI response' };
    const validation = validateFlowCandidate(prepare(json));
    return validation.ok
      ? { ok: true, value: validation.flow, summary: `"${validation.flow.name}" (${validation.flow.steps.length} steps)` }
      : validation;
  };
}

export async function generateFlowDefinition(
  description: string,
  deps: FlowExecutorDeps,
  options: FlowGenerationOptions,
): Promise<FlowGenerationResult> {
  const trimmed = description.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  const skills = [...options.preselected];
  const { triggerHint } = options;

  const compiled = await askUntilValid(
    (attempt, lastResponse, lastError) => (attempt === 1
      ? buildFlowGenerationPrompt(trimmed, skills, triggerHint)
      : buildFlowRepairPrompt(trimmed, skills, lastResponse, lastError, triggerHint)),
    deps,
    options,
    {
      name: 'Generation',
      start: (provider) => `🤖 [Flow] Generating flow via ${provider} (${skills.length} skills disclosed)…`,
      validate: judgeFlow(),
    },
  );
  return compiled.ok ? { ok: true, flow: compiled.value } : compiled;
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
  const compiled = await askUntilValid(
    (attempt, lastResponse, lastError) => (attempt === 1
      ? buildFlowEditPrompt(flow, change, skills)
      : buildFlowEditRepairPrompt(flow, change, skills, lastResponse, lastError)),
    deps,
    options,
    {
      name: 'Revision',
      start: (provider) => `🤖 [Flow] Revising flow via ${provider} (${skills.length} skills disclosed)…`,
      validate: judgeFlow((json) => {
        const inner = unwrapCandidate(json);
        if (!inner) return json;
        stepIds = Array.isArray(inner.steps)
          ? inner.steps.map((step) => {
            const id = (step as Record<string, unknown> | null)?.id;
            return typeof id === 'string' && id.trim() ? id.trim() : undefined;
          })
          : [];
        return flow.variables?.length ? { ...inner, variables: flow.variables } : inner;
      }),
    },
  );
  return compiled.ok ? { ok: true, flow: compiled.value, stepIds } : compiled;
}

/** What differs between the phases that share `askUntilValid`. */
interface AttemptPhase<T> {
  /** Names the phase in the log lines after the first. */
  name: string;
  /** The first attempt's log line, given the label of the model it goes to. */
  start: (provider: string) => string;
  /** Judges one reply's JSON (null when it held none); `summary` is for the success log line. */
  validate: (json: unknown) => { ok: true; value: T; summary: string } | { ok: false; error: string };
}

type AttemptResult<T> = { ok: true; value: T } | { ok: false; error: string; reason?: FlowBuildFailureReason };

/**
 * The attempt loop the assessment, a new flow and a revision all go through: pick a provider that
 * holds the prompt, ask, validate, and on a rejected reply ask again with the rejection quoted back.
 */
async function askUntilValid<T>(
  promptAt: (attempt: number, lastResponse: string, lastError: string) => string,
  deps: FlowExecutorDeps,
  options: FlowPhaseOptions,
  phase: AttemptPhase<T>,
): Promise<AttemptResult<T>> {
  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;
  let lastError = '';
  let lastResponse = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptText = promptAt(attempt, lastResponse, lastError);

    const picked = pickProvider(promptText, options.providerUrl);
    if (picked.error) {
      // On a retry the original prompt already fitted, so stop with the reason the reply was
      // rejected rather than with a size complaint about the prompt that was never sent.
      if (attempt > 1) {
        sendLog(`⚠️ [Flow] Repair prompt exceeds the input limit — skipping the retry`);
        return { ok: false, error: lastError, reason: 'invalid_output' };
      }
      sendLog(`❌ [Flow] ${picked.error}`);
      return { ok: false, error: picked.error };
    }
    const notReady = await ensureProviderReady(picked.url, deps);
    if (notReady) return { ok: false, error: notReady };

    // Reported only once the attempt is really going out: a retry that stops above is no retry,
    // and the panel must not say it is asking again just before it says the build failed.
    if (attempt === 1) options.onProvider?.(picked.url);
    options.onAttempt?.(attempt, attempt > 1 ? lastError : undefined);
    sendLog(attempt === 1
      ? phase.start(getProviderLabel(picked.url))
      : `🔁 [Flow] ${phase.name} attempt ${attempt}/${MAX_ATTEMPTS} — asking ${getProviderLabel(picked.url)} to fix: ${lastError}`);

    try {
      lastResponse = await askProvider(promptText, picked.url, deps, timeoutMs);
    } catch (err) {
      // A request that never came back is not a model that answered badly. Retrying it would
      // spend another full timeout on the same broken worker, so it ends the phase.
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`❌ [Flow] ${phase.name} request failed: ${message}`);
      return { ok: false, error: message };
    }

    const verdict = phase.validate(extractJsonFromLlmResponse(lastResponse));
    if (verdict.ok) {
      const suffix = attempt > 1 ? ` (attempt ${attempt})` : '';
      sendLog(`✅ [Flow] ${phase.name}: ${verdict.summary}${suffix}`);
      return { ok: true, value: verdict.value };
    }

    lastError = verdict.error;
    const willRetry = attempt < MAX_ATTEMPTS;
    sendLog(`❌ [Flow] ${phase.name} rejected: ${lastError}${willRetry ? ' — asking again' : ` (gave up after ${MAX_ATTEMPTS} attempts)`}`);
  }

  // `lastError` is the validator talking to the model; `reason` is what the user is told.
  return { ok: false, error: lastError, reason: 'invalid_output' };
}

import type { BrowserWindow } from 'electron';
import type { FlowAssessResult, FlowAssessment, FlowGenerationResult, TriggerType } from '../../shared/types';
import { PROVIDER_URLS, isByokTargetUrl } from '../../shared/types';
import {
  ALWAYS_INCLUDED_SKILLS,
  buildFlowAssessPrompt,
  buildFlowGenerationPrompt,
  buildFlowRepairPrompt,
  resolveSelectedSkills,
} from '../../shared/flowSkillSchema';
import { extractJsonFromLlmResponse, validateFlowCandidate } from '../../shared/flowValidation';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../providers';
/*
 * Statically imported, like every other caller. A `await import()` here added a second dynamic
 * boundary to the main bundle, which made Rollup hoist the shared graph — windows.ts with it —
 * into out/main/assets/. From there `path.join(__dirname, '../preload/index.js')` resolves to
 * out/main/preload/index.js, the preload fails to load, and the whole renderer comes up blank.
 */
import { runByokCompletion } from '../providers/byokClient';
import { sendLog } from '../helpers';
import { llmLane } from './lanes';
import type { FlowExecutorDeps } from './types';

const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;

/**
 * The provider used when the caller has no opinion, and the fallback for one whose input cap
 * the prompt does not fit (Duck.ai's 12,000 bytes cannot hold either stage). Gemini is the
 * only browser provider that works without being logged in, so it is the safe floor.
 */
const FALLBACK_PROVIDER_URL = PROVIDER_URLS.gemini;

export interface FlowGenerationOptions {
  /** Provider to generate with — the agent passes its own so a run stays on one model. */
  providerUrl?: string;
  /** Stage A result reused from an earlier `assessFlowSupport`, so it is not paid for twice. */
  preselected?: readonly string[];
  /** The trigger stage A chose. Carried so stage B cannot contradict what the user approved. */
  triggerHint?: TriggerType;
}

/**
 * Picks the provider that can actually hold this prompt. BYOK endpoints have no cap we can
 * measure, so they are taken as-is; a browser provider that would truncate falls back rather
 * than failing, because a prompt the provider silently cuts produces a flow built from half a
 * contract — the failure mode this whole module was rewritten to remove.
 */
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

/** A BYOK endpoint needs no worker window and no lane; only a browser provider does. */
async function ensureProviderReady(providerUrl: string, deps: FlowExecutorDeps): Promise<string | null> {
  if (isByokTargetUrl(providerUrl)) return null;
  const worker = await resolveWorker(deps);
  return worker && !worker.isDestroyed() ? null : 'Worker window not available';
}

async function askProvider(
  prompt: string,
  providerUrl: string,
  deps: FlowExecutorDeps,
  timeoutMs: number,
): Promise<string> {
  // Same split as summarizer.ts and execLlm: BYOK is a plain HTTPS call with no shared mutable
  // resource, so it deliberately skips both the worker window and llmLane serialization.
  if (isByokTargetUrl(providerUrl)) {
    const { response } = await runByokCompletion(providerUrl, prompt, timeoutMs);
    return response;
  }
  const prepared = preparePromptForProvider(prompt, providerUrl);
  return llmLane.runExclusive(async () => {
    const win = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
    if (!win || win.isDestroyed()) throw new Error('Worker window not available');
    const result = await runAutomation(win, prepared.prompt, timeoutMs, providerUrl);
    return result.response;
  });
}

const VERDICTS = new Set<FlowAssessment['verdict']>(['full', 'partial', 'none']);
const TRIGGERS = new Set<TriggerType>(['hotkey', 'cron', 'manual', 'bot', 'chat']);

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, limit);
}

/**
 * Exported for the test suite. Total by design: a malformed field is dropped, never fatal.
 * Only an empty skill selection fails, because that is the one thing stage B cannot work
 * around — everything else is commentary the user reads, not input the compiler depends on.
 */
export function validateAssessment(json: unknown): FlowAssessResult {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'The assessment must be a single JSON object' };
  }
  const obj = json as Record<string, unknown>;
  const requested = readStringArray(obj.skills, 40);
  if (requested.length === 0) {
    return { ok: false, error: 'The assessment needs a non-empty "skills" array' };
  }
  // Unknown names are dropped here rather than rejected: one hallucinated skill must not cost
  // the whole assessment, and control flow is appended whether or not the model asked for it.
  // What cannot be salvaged is a selection with no real work in it — control flow alone
  // compiles to a flow that does nothing.
  const skills = resolveSelectedSkills(requested);
  if (!skills.some((type) => !ALWAYS_INCLUDED_SKILLS.includes(type))) {
    return { ok: false, error: 'None of the named skills exist' };
  }
  const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict.trim().toLowerCase() : '';
  const verdict = VERDICTS.has(verdictRaw as FlowAssessment['verdict'])
    ? (verdictRaw as FlowAssessment['verdict'])
    : 'partial';
  // Degrades to "manual" rather than guessing a schedule: a flow that only runs when asked is
  // the harmless wrong answer, whereas inventing a cron would have it firing on its own.
  const triggerRaw = typeof obj.trigger === 'string' ? obj.trigger.trim().toLowerCase() : '';
  const trigger = TRIGGERS.has(triggerRaw as TriggerType) ? (triggerRaw as TriggerType) : 'manual';
  return {
    ok: true,
    assessment: {
      skills,
      trigger,
      outline: readStringArray(obj.outline, 10),
      gaps: readStringArray(obj.gaps, 6),
      verdict,
    },
  };
}

/**
 * Stage A — which skills does this request need, and do they cover it? Reads only the tier-1
 * index, so it costs a fraction of the generation prompt and can be shown to the user before
 * anything is written to disk.
 */
export async function assessFlowSupport(
  goal: string,
  deps: FlowExecutorDeps,
  providerUrl?: string,
): Promise<FlowAssessResult> {
  const trimmed = goal.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  const prompt = buildFlowAssessPrompt(trimmed);
  const picked = pickProvider(prompt, providerUrl);
  if (picked.error) {
    sendLog(`❌ [Flow] ${picked.error}`);
    return { ok: false, error: picked.error };
  }
  const notReady = await ensureProviderReady(picked.url, deps);
  if (notReady) return { ok: false, error: notReady };

  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;
  sendLog(`🔎 [Flow] Assessing skill coverage via ${getProviderLabel(picked.url)}…`);
  try {
    const response = await askProvider(prompt, picked.url, deps, timeoutMs);
    const result = validateAssessment(extractJsonFromLlmResponse(response));
    if (result.ok) {
      sendLog(`✅ [Flow] Assessment: ${result.assessment.verdict}, ${result.assessment.skills.length} skills`);
    } else {
      sendLog(`❌ [Flow] Assessment rejected: ${result.error}`);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`❌ [Flow] Assessment failed: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * Stages A + B. `preselected` skips stage A when the caller already ran it — the agent does,
 * because it showed the assessment to the user before asking to build.
 */
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
    const assessed = await assessFlowSupport(trimmed, deps, options.providerUrl);
    if (!assessed.ok) return { ok: false, error: assessed.error };
    if (assessed.assessment.verdict === 'none') {
      return {
        ok: false,
        error: assessed.assessment.gaps[0] ?? 'No Yobi skill can carry out this request',
      };
    }
    skills = assessed.assessment.skills;
    triggerHint = assessed.assessment.trigger;
  }

  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;
  let lastError = 'Could not generate a valid flow';
  let lastResponse = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptText = attempt === 1
      ? buildFlowGenerationPrompt(trimmed, skills, triggerHint)
      : buildFlowRepairPrompt(trimmed, skills, lastResponse, lastError, triggerHint);

    const picked = pickProvider(promptText, options.providerUrl);
    if (picked.error) {
      // A repair prompt carries the previous output on top of the generation prompt, so it can
      // outgrow a cap the first attempt cleared. Returning the original validation error is
      // more useful than reporting a size problem the user cannot act on.
      if (attempt > 1) {
        sendLog(`⚠️ [Flow] Repair prompt exceeds the input limit — skipping the retry`);
        return { ok: false, error: lastError };
      }
      sendLog(`❌ [Flow] ${picked.error}`);
      return { ok: false, error: picked.error };
    }
    const notReady = await ensureProviderReady(picked.url, deps);
    if (notReady) return { ok: false, error: notReady };

    sendLog(attempt === 1
      ? `🤖 [Flow] Generating flow via ${getProviderLabel(picked.url)} (${skills.length} skills disclosed)…`
      : `🔁 [Flow] Retrying — asking ${getProviderLabel(picked.url)} to fix: ${lastError}`);

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
      const validation = validateFlowCandidate(json);
      if (validation.ok) {
        const suffix = attempt > 1 ? ' (after retry)' : '';
        sendLog(`✅ [Flow] Generated flow "${validation.flow.name}" (${validation.flow.steps.length} steps)${suffix}`);
        return validation;
      }
      lastError = validation.error;
    }

    const willRetry = attempt < MAX_ATTEMPTS;
    sendLog(`❌ [Flow] Invalid generated flow: ${lastError}${willRetry ? ' — retrying once' : ''}`);
  }

  return { ok: false, error: lastError };
}

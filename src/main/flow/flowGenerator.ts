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
import { runByokCompletion } from '../providers/byokClient';
import { sendLog } from '../helpers';
import { llmLane } from './lanes';
import type { FlowExecutorDeps } from './types';

const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;

const FALLBACK_PROVIDER_URL = PROVIDER_URLS.gemini;

export interface FlowGenerationOptions {
  providerUrl?: string;
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
  return worker && !worker.isDestroyed() ? null : 'Worker window not available';
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
      verdict,
    },
  };
}

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

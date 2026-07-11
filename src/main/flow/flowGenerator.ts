import type { FlowGenerationResult } from '../../shared/types';
import { PROVIDER_URLS } from '../../shared/types';
import { buildFlowGenerationPrompt, buildFlowRepairPrompt } from '../../shared/flowSkillSchema';
import { extractJsonFromLlmResponse, validateFlowCandidate } from '../../shared/flowValidation';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../providers';
import { sendLog } from '../helpers';
import { llmLane } from './lanes';
import type { FlowExecutorDeps } from './types';

const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;

const GENERATION_PROVIDER_URL = PROVIDER_URLS.gemini;

export async function generateFlowDefinition(
  description: string,
  deps: FlowExecutorDeps,
): Promise<FlowGenerationResult> {
  const trimmed = description.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  const providerUrl = GENERATION_PROVIDER_URL;

  let workerWin = deps.getWorkerWin();
  if ((!workerWin || workerWin.isDestroyed()) && deps.ensureWorkerWin) {
    workerWin = await deps.ensureWorkerWin();
  }
  if (!workerWin || workerWin.isDestroyed()) {
    return { ok: false, error: 'Worker window not available' };
  }

  const providerLabel = getProviderLabel(providerUrl);
  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;

  let lastError = 'Could not generate a valid flow';
  let lastResponse = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptText = attempt === 1
      ? buildFlowGenerationPrompt(trimmed)
      : buildFlowRepairPrompt(trimmed, lastResponse, lastError);

    sendLog(attempt === 1
      ? `🤖 [AgentFlow] Generating flow via ${providerLabel}…`
      : `🔁 [AgentFlow] Retrying — asking ${providerLabel} to fix: ${lastError}`);

    try {
      const prepared = preparePromptForProvider(promptText, providerUrl);
      if (prepared.truncated) {
        if (attempt > 1) {
          sendLog(`⚠️ [AgentFlow] Repair prompt exceeds the ${providerLabel} input limit — skipping the retry`);
          return { ok: false, error: lastError };
        }
        const message = `Flow-generation prompt (${prepared.originalLength} chars) exceeds the ${providerLabel} input limit (${prepared.maxChars}) — shorten the description`;
        sendLog(`❌ [AgentFlow] ${message}`);
        return { ok: false, error: message };
      }
      const result = await llmLane.runExclusive(async () => {
        // Resolve inside the lane via ensureWorkerWin (forces automation mode) so a
        // worker left interactive after a login is reclaimed rather than degrading
        // this generation run.
        const win = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
        if (!win || win.isDestroyed()) throw new Error('Worker window not available');
        return runAutomation(win, prepared.prompt, timeoutMs, providerUrl);
      });
      lastResponse = result.response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`❌ [AgentFlow] Flow generation request failed: ${message}`);
      return { ok: false, error: message };
    }

    const json = extractJsonFromLlmResponse(lastResponse);
    if (json === null) {
      lastError = 'No JSON found in the AI response';
    } else {
      const validation = validateFlowCandidate(json);
      if (validation.ok) {
        const suffix = attempt > 1 ? ' (after retry)' : '';
        sendLog(`✅ [AgentFlow] Generated flow "${validation.flow.name}" (${validation.flow.steps.length} steps)${suffix}`);
        return validation;
      }
      lastError = validation.error;
    }

    const willRetry = attempt < MAX_ATTEMPTS;
    sendLog(`❌ [AgentFlow] Invalid generated flow: ${lastError}${willRetry ? ' — retrying once' : ''}`);
  }

  return { ok: false, error: lastError };
}

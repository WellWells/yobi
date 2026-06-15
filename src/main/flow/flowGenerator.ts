import type { FlowGenerationResult } from '../../shared/types';
import { buildFlowGenerationPrompt, buildFlowRepairPrompt } from '../../shared/flowSkillSchema';
import { extractJsonFromLlmResponse, validateFlowCandidate } from '../../shared/flowValidation';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../providers';
import { sendLog } from '../helpers';
import { llmLane } from './lanes';
import type { FlowExecutorDeps } from './types';

const DEFAULT_GENERATION_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;

export async function generateFlowDefinition(
  description: string,
  deps: FlowExecutorDeps,
): Promise<FlowGenerationResult> {
  const trimmed = description.trim();
  if (!trimmed) return { ok: false, error: 'Empty description' };

  let workerWin = deps.getWorkerWin();
  if ((!workerWin || workerWin.isDestroyed()) && deps.ensureWorkerWin) {
    workerWin = await deps.ensureWorkerWin();
  }
  if (!workerWin || workerWin.isDestroyed()) {
    return { ok: false, error: 'Worker window not available' };
  }

  const providerUrl = deps.getTargetUrl();
  const providerLabel = getProviderLabel(providerUrl);
  const timeoutMs = deps.getResponseTimeoutMs?.() ?? DEFAULT_GENERATION_TIMEOUT_MS;

  let lastError = 'Could not generate a valid flow';
  let lastResponse = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptText = attempt === 1
      ? buildFlowGenerationPrompt(trimmed)
      : buildFlowRepairPrompt(trimmed, lastResponse, lastError);
    const prepared = preparePromptForProvider(promptText, providerUrl);

    sendLog(attempt === 1
      ? `🤖 [AgentFlow] Generating flow via ${providerLabel}…`
      : `🔁 [AgentFlow] Retrying — asking ${providerLabel} to fix: ${lastError}`);

    try {
      // Generation drives the shared worker window, so it must hold llmLane like
      // every other automation; the window is re-resolved once the lane is ours.
      const result = await llmLane.runExclusive(async () => {
        let win = deps.getWorkerWin();
        if ((!win || win.isDestroyed()) && deps.ensureWorkerWin) {
          win = await deps.ensureWorkerWin();
        }
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
